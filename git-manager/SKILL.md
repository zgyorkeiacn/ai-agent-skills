---
name: git-manager
description: 'Manage multiple git identities on one machine and watch their tokens for expiry. Registers each account with the repositories it owns, routes both credentials and commit author name/email to the right account per repo owner so several GitHub accounts stop overwriting one credential slot and no repo needs a manual "git config user.email", stores PATs in the OS keychain, and installs a daily probe that warns before a token expires. Invoke with no args for a status summary, "onboard" for first-time setup, "identity <id>" to set an account commit email, "probe" to check tokens now, "doctor" for a health check, or "whoami" to see which account owns a repo.'
argument-hint: 'Optional: "onboard" | "probe" | "status" | "doctor" | "whoami [path]" | "add <id>" | "identity <id>" | "schedule"'
user-invocable: true
---

# git-manager Skill (`/git-manager`)

Three problems that look unrelated and share one cause: the machine has several git identities and
nothing writes down which is which.

1. **Identity collision.** Several accounts on one host overwrite each other's credential,
   because git has no way to know which username a given repo wants. Symptom: a clone or push
   that worked yesterday suddenly asks for credentials, or authenticates as the wrong user.
2. **Silent token expiry.** A PAT expires and nothing says so until a script fails with a
   confusing 401 that looks like a permissions problem.
3. **Wrong commit author.** Authentication and authorship are separate settings, so a repo can
   push to the right account under the wrong `user.email`. Symptom: commits that do not attribute
   to you, or a work address on a personal repo. Worse than the first two because it is silent and
   retroactive: nothing fails, and correcting it later rewrites every SHA from that commit on.

This skill keeps one registry of `account -> username, email, host, repositories[]`, routes both
credentials and commit identity to the right account per repo, stores tokens in the OS keychain,
and probes them daily.

## Storage model

| What | Where | Why there |
|---|---|---|
| Account metadata: id, username, `email`, host, `repositories[]` | `~/.claude/credentials/accounts.json`, plaintext | Not secret. An agent can answer "whose repo is this" without unlocking anything. |
| Tokens (PATs) | OS keychain, written via `git credential approve` | Git's own helper reads them natively, so push and fetch work unattended with no wrapper. |
| Commit identity | `~/.claude/credentials/identity-<id>.gitconfig`, pulled in by `includeIf` | `includeIf` takes a path, not a block, and one file per account makes removal a delete rather than surgery on the user's own gitconfig. |
| Probe results | `~/.claude/credentials/pat-status.json` | Read by `status` with no network call, so a session banner stays instant. |

`accounts.json` must never contain a secret. `doctor` scans it for token-shaped strings and fails
if it finds one.

Writing tokens through `git credential` rather than a platform keychain API is what makes this
portable: `manager` on Windows, `osxkeychain` on macOS and `libsecret` on Linux all speak the
same protocol.

**No passwords are stored.** An account password enables nothing here (GitHub has not accepted
one for git since 2021) so keeping one is pure liability.

## Mode detection

| Argument | Mode |
|----------|------|
| *(none)* | **Status** - show the last probe result and flag anything needing attention |
| `onboard` | **First run** - scan for clones, define accounts, configure routing, take tokens |
| `probe` | **Probe now** - check every token against its provider, refresh the status file |
| `status` | Same as no argument; `--quiet` prints only when action is needed |
| `doctor` | **Health check** - routing, tokens, and whether the daily probe is still running |
| `whoami [path]` | Which account owns a repo, and who it commits as (defaults to the current directory) |
| `add <id>` | Register another account and route it |
| `identity <id>` | Set or change that account's commit name and email |
| `prune <id>` | Drop registry entries whose repository the provider no longer has |
| `schedule` | Print the command that installs or removes the daily check |

All modes run `scripts/creds.mjs`. Requires Node 18+ (uses built-in `fetch`) and `git` on PATH.

---

## Step 0 - Is this a first run?

If `~/.claude/credentials/accounts.json` does not exist, or contains no accounts, run onboarding
regardless of the argument given, then continue.

```
node scripts/creds.mjs onboard
```

Onboarding is interactive and does four things in order:

1. **Scans** the given roots one level deep for git work trees and reads each `origin` remote.
2. **Groups** the results by `host/owner`. Each group is a candidate identity boundary, which is
   usually right: repos under one GitHub org are normally accessed by one account.
3. **Asks** for an account id, username and commit email per group. Blank skips the group;
   `merge:<id>` attaches the group to an account already defined, which is how one identity
   covering several orgs is expressed. The email is asked here, not left for later, because a
   missing one has no symptom until a commit is already authored under the wrong address.
4. **Configures routing and commit identity, then takes tokens.** Routing first is deliberate: a
   token is useless until git knows which repo should use it.

Azure DevOps groups are detected and marked `interactive-aad` automatically. See the ADO section.

---

## Step 1 - Routing, the part that is easy to get wrong

Git matches `credential.<url>.username` by **path prefix**, so one line per repo owner routes
every repo under it:

```
credential.https://github.com/<owner>.username = <account-username>
```

**`useHttpPath` must stay OFF.** Turning it on keys credential storage per repo path, which
orphans every existing token and forces re-entry of all of them. It also buys nothing: the
username route alone disambiguates, and storage stays keyed by host and username where the
tokens already are. This was measured, not assumed.

A route is only needed where **two or more accounts share a host**. With a single account on a
host, git has nothing to disambiguate and `doctor` must not report a missing route as a problem.

`repair` re-applies every route from the registry, which is the fix when gitconfig and the
registry have drifted.

---

## Step 1b - Commit identity, routed the same way

An account carries an `email` (and optional `commitName`, defaulting to the login). It is applied
by writing `~/.claude/credentials/identity-<id>.gitconfig` and selecting it from the global
gitconfig by **remote URL**:

```
[includeIf "hasconfig:remote.*.url:https://github.com/<owner>/**"]
    path = ~/.claude/credentials/identity-<id>.gitconfig
```

```
node scripts/creds.mjs set-identity --id <account> --email <address> [--name <name>]
```

**Match on the remote, not on `gitdir:`.** A directory rule binds authorship to where a clone
happens to sit, so it fails exactly when the registry is already wrong: a repo moved, a clone
outside the scanned roots, a remote repointed at a different account. The remote is the same axis
the credential route uses, so credential and authorship cannot disagree about who owns a repo.
Repointing a remote switches both at once, with nothing to remember.

**Not gated on `contestedHosts`, unlike credential routing.** That gate is sound for credentials -
with one account on a host git has nothing to disambiguate - and does not transfer here: git
cannot guess an email from the number of accounts, so a sole account needs its identity written
just as much as a contested one. Nor is it gated on `authMode`: an `interactive-aad` account
authenticates through Azure AD and still authors commits.

**Four patterns per owner, because the match is literal and case-sensitive** (measured):

| Pattern | Covers |
|---|---|
| `https://<host>/<owner>/**` | ordinary HTTPS remote |
| `https://*@<host>/<owner>/**` | HTTPS remote carrying a username, which Azure DevOps hands out by default |
| `ssh://git@<host>/<owner>/**` | SSH URL form |
| `git@<host>:<owner>/**` | SCP-like SSH form |

Each is emitted for the owner as declared and lowercased. A mixed-case owner written in some
third casing is not covered; declare the owner as it appears in the remote.

**Requires Git 2.36+**, which is where `includeIf "hasconfig:"` landed. Older git ignores the
directive **silently**, so the version is checked rather than assumed: below 2.36 `set-identity`
stores the value, reports that it was not applied, and exits non-zero. A silent no-op here would
be indistinguishable from a working setup until a commit landed under the wrong address.

**A repo-local `user.email` still wins.** That is git's normal precedence and is left alone
deliberately, so a deliberate per-repo override survives. It does mean a stale local override
silently defeats the account identity, so `doctor` compares every registered repo's resolved
`user.email` against its account and prints the `--unset` command for each mismatch. `whoami`
shows declared identity and resolved identity side by side for the same reason.

---

## Step 1c - Pruning deleted repositories

`sync-repos` only ever adds. A repo deleted on the provider stays in the registry forever, where
it inflates `doctor`'s counts and keeps a dead route alive.

```
node scripts/creds.mjs prune-repos --id <account> [--dry-run]
```

**A 404 alone does not mean deleted.** GitHub answers 404, not 403, for a private repo a token
cannot read, so that it does not leak existence. Taking 404 at face value deletes every private
repo the moment a token is under-scoped, and the output is indistinguishable from a real mass
deletion. So the token's visibility is established FIRST, from `x-oauth-scopes` on `/user`:

| Token | Verdict on a 404 |
|---|---|
| classic PAT with `repo` | `gone` - it could have seen a private repo and did not |
| classic PAT without `repo` | `inconclusive` - private repos are invisible to it |
| fine-grained PAT (no `x-oauth-scopes` header) | `gone`, with a printed caveat: its repository grant cannot be enumerated, so a 404 can also mean "never granted to this token" |

Three outcomes, never two. Only `gone` is acted on; `inconclusive` entries are KEPT and counted
separately, and the summary prints the size of the set scanned next to the hits so "checked 0,
removed 0" cannot pass for "checked 30, removed 0".

**The local clone is never touched.** It may hold unpushed work, and deleting a remote says
nothing about the working copy. Prune reports the path it left behind, because a clone whose
remote is gone can no longer push and that is worth knowing.

Sanity-check the COUNT before accepting the result. An implausible proportion is the cheapest
available signal that the detector, not the registry, is what is wrong.

---

## Step 2 - Probing

`probe` checks each account's token against its provider and classifies it. There are **three**
healthy-looking states, not two:

| State | How it is detected | Meaning |
|---|---|---|
| `valid` | 200, expiry header present and far off | fine |
| `expiring` | 200, expiry within 14 days | act soon |
| `dead` | 401 (ADO also answers 203) | revoked, expired or invalid |
| `no-expiry` | 200, **no** expiry header | valid but never expires |
| `absent` | no token stored | nothing to check |
| `unreachable` | network error or 5xx | inconclusive, not a failure |

`no-expiry` matters. GitHub omits `github-authentication-token-expiration` entirely for a token
with no expiration date, so the absence of the header is the signal. Reporting that as `valid`
hides a non-expiring credential; reporting it as a failure cries wolf. It is shown as its own
state and does not trigger a warning.

`unreachable` is never treated as expiry. A probe that cannot reach the network must not tell
somebody their working token is dead.

`probe` exits non-zero when anything is `dead` or `expiring`, so a scheduler or CI step can gate
on it.

---

## Step 3 - The daily check

`schedule` prints the platform-appropriate command. **Print it; do not run it.** Registering a
scheduled task or editing a crontab is a persistent system change and belongs to the user.

Windows:
```
powershell -NoProfile -File scripts/install-schedule.ps1 -Time 09:00
powershell -NoProfile -File scripts/install-schedule.ps1 -Uninstall
```

macOS and Linux:
```
bash scripts/install-schedule.sh --time 09:00
bash scripts/install-schedule.sh --uninstall
```

Both run `node creds.mjs probe` once a day and nothing else.

The Windows task runs **only when the user is logged on**, deliberately: the credential store is
unlocked by the logon session, so a run-whether-logged-on-or-not task would find no tokens and
report every one as missing. The cron entry resolves `node` to an absolute path at install time,
because cron's minimal PATH is the usual reason a working command fails only under cron.

### Surfacing the result

`status --quiet` prints **nothing** when everything is healthy, and a short block when it is not.
That makes it safe to call at the start of a session:

```
node scripts/creds.mjs status --quiet
```

When this skill runs for any reason, call that first and surface the output if non-empty, before
doing whatever else was asked. If the status file is more than 48 hours old, say so: it means the
scheduled probe has stopped running, which otherwise looks identical to "no problems".

---

## Step 4 - Automatic credential context

A `UserPromptSubmit` hook (`hooks/credential-context.ps1`, `.sh`) fires when a request concerns
GitHub or Azure DevOps and injects a short context block naming the account that owns the current
repo, any dead or expiring token, and the command that uses a token without printing it.

**The hook never injects a token, and neither should you.** A live credential placed in
conversation context is copied into every transcript, log and context window that request
touches, which is the exposure this store exists to prevent.

To let a command use a token, run it under `exec`:

```
node scripts/creds.mjs exec --id <account> -- <command>
```

The token is set in that child process's environment only. Variable names per host:

| Host | Variables set |
|---|---|
| `github.com` | `GITHUB_TOKEN`, `GH_TOKEN` |
| Azure DevOps | the account's `apiToken.envVar`, normally `AZURE_DEVOPS_PAT` |

**Never use `get-token --reveal` to feed a command.** That writes the credential into the
transcript. `--reveal` exists for a human copying a token into a browser, nothing else.

`exec` runs with `shell: false`. For a shell builtin or a Windows `.cmd` such as npm, wrap it
explicitly: `exec --id X -- cmd /c npm view foo`.

### Trigger scope

The hook triggers on what the request is **about**, not where it runs. An earlier version also
fired whenever the working directory was a clone, which matched nearly every prompt in any
checkout including plain refactors. A hook that fires on everything gets switched off, and is
then absent on the day it matters. The verbs implying remote work (push, clone, merge, commit,
PR) are in the pattern already; the current directory is used only to say which account applies.

---

## Azure DevOps is different, on purpose

ADO git authentication is owned by Git Credential Manager's Azure AD flow. There is no stored PAT
for git to find, and writing one does not stick. ADO accounts are therefore marked
`"authMode": "interactive-aad"`, and `doctor` skips the git-token check for them rather than
reporting a false failure.

An ADO account's **PAT is a REST API credential**, used by skills that call the ADO API, not by
git. It is resolved from three sources, most authoritative first:

1. the OS keychain, under the synthetic host `api-token.invalid`
2. the env var named in `apiToken.envVar` (conventionally `AZURE_DEVOPS_PAT`)
3. a `.env` file listed in `apiToken.envFile` (string or array of paths)

Source 3 is not a convenience. A scheduled task runs with a minimal environment: cron sets almost
nothing and a Windows task inherits no interactive session. A token reachable only through source
2 is therefore **invisible to the daily probe**, which reports it `absent` and silently checks
nothing, which is the blind spot the watchdog exists to remove. `probe` prints the resolved
source for any token that did not come from the keychain.

ADO exposes no expiry date to an unprivileged token, so its probe is a validity check only.

**The ADO probe tries the account's own org and project first.** ADO returns 401 for insufficient
scope exactly as it does for a revoked token, so probing a broad endpoint marks a correctly
scoped PAT as dead. A Work-Items PAT gets 401 from the profile endpoint and 200 from
`<org>/<project>/_apis/wit/fields`. The endpoint ladder is built from the account's `owners`, and
the token is declared dead only if every endpoint rejects it. Owner shape differs by host:
`dev.azure.com` owners are `<org>/<project>`, while `<org>.visualstudio.com` carries the org in
the host and the owner is just the project.

Note that `dev.azure.com` and `<org>.visualstudio.com` are the same organisation but **different
credential hosts** to git, so they are two account entries.

---

## Rules

- **Never accept a secret on argv.** argv is visible to every process on the machine and lands in
  shell history. Use `--from-env VAR` or pipe on stdin.
- **Never write a token into `accounts.json`**, or into any file in a repo.
- **Never print a token** unless `--reveal` was explicitly passed. Default output is masked.
- **Never run a scheduler installer autonomously.** Print the command and let the user run it.
- **Never set `user.email` in a single repo to fix an identity.** That is the manual step this
  replaces, and it hides the real gap: the account has no email, so every other repo under it is
  still wrong. Fix it once with `set-identity`.
- **Never guess a commit email.** Ask. An address is wrong silently, and unwinding it means
  rewriting history.
- **Never conclude a repo is deleted from a 404 alone.** Establish what the token can see first;
  a private repo answers 404 to a token that cannot read it. Keep anything unproven.
- **Never delete a local clone.** `prune-repos` touches the registry only.
- **An API token must never share `(host, username)` with a git token.** Scoping by `path=` does
  not work: with `useHttpPath` off the credential helper normalises the path away, so the second
  write silently overwrites the first and breaks git auth. `storeToken` verifies this after every
  API-token write and refuses rather than leaving auth broken.
- **Do not treat `unreachable` as expiry**, and do not treat `no-expiry` as a failure.

See `references/design.md` for the measurements behind these.

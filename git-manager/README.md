# git-manager

Keeps several git identities straight on one machine, and tells you before a token expires
instead of after.

## The problems it solves

**Your accounts overwrite each other.** With two or three GitHub accounts on one machine, a push
that worked yesterday suddenly asks for credentials, or authenticates as the wrong user. Git has
no way to know which username a given repo wants, so it falls back to one shared entry and the
last account to authenticate wins.

**Tokens die quietly.** A PAT expires and nothing says so. The first sign is a script failing
with a 401 that looks like a permissions problem, usually in the middle of something else.

## Install

Requires **Node 18+** (uses built-in `fetch`) and **git** on PATH.

Drop the `git-manager` folder into your skills directory, then:

```
/git-manager onboard
```

Onboarding scans your checkout roots, groups what it finds by `host/owner`, and asks you to name
an account per group. It then configures routing and takes your tokens. Nothing is guessed
silently: every group is shown and every account is confirmed.

Finally, install the daily check. The skill prints this rather than running it, because a
scheduled task is a persistent change to your machine:

```
# Windows
powershell -NoProfile -File scripts/install-schedule.ps1 -Time 09:00

# macOS / Linux
bash scripts/install-schedule.sh --time 09:00
```

## Daily use

Mostly none. The scheduled probe runs once a day and writes a status file; the skill reads it and
stays silent unless something needs attention.

```
/git-manager              # status summary
/git-manager probe        # check every token right now
/git-manager doctor       # routing, identity, tokens, and whether the daily check is still running
/git-manager whoami       # which account owns the repo you are standing in, and who it commits as
```

## Commit identity follows the remote

Authenticating as the right account and committing as the right person are separate settings, so
a repo can push correctly and still author under the wrong address. Nothing fails, which is why
it is usually noticed late, and correcting it afterwards rewrites every SHA from that commit on.

Each account carries a commit email. It is bound by **remote URL**, so a repo picks up the right
authorship the moment its remote points at that account, including a brand new clone and
including a repo whose remote you just repointed:

```
node scripts/creds.mjs set-identity --id github-work --email you@company.com
```

Set once per account, never per repo. `git config user.email` in a single repo is the manual step
this replaces, and it masks the real gap: if the account has no email, every other repo under it
is still wrong.

A repo-local `user.email` you set yourself still wins, as git normally defines precedence.
`doctor` reports every registered repo whose resolved address disagrees with its account, with
the command to clear it.

Needs Git 2.36+ (`includeIf "hasconfig:"`). Below that, `set-identity` stores the address, tells
you it could not apply it, and exits non-zero rather than reporting a success that did nothing.

## Credentials where you need them

A `UserPromptSubmit` hook notices when a request concerns GitHub or Azure DevOps and quietly adds
the relevant context: which account owns the repo you are in, and whether any token is dead or
expiring. It stays silent otherwise.

It adds **context, not credentials**. A token pasted into conversation context ends up in every
transcript and log that request touches, so tokens are handed to commands instead:

```
node scripts/creds.mjs exec --id github-personal -- gh pr list
node scripts/creds.mjs exec --id ado-myorg -- node fetch-work-items.js
```

`exec` sets the token in that child process only. GitHub accounts get `GITHUB_TOKEN` and
`GH_TOKEN`; Azure DevOps accounts get `AZURE_DEVOPS_PAT` (or whatever `apiToken.envVar` names).
Nothing is written to a file and nothing appears in your shell history.

Enable it by adding this to `.claude/settings.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      { "hooks": [ { "type": "command",
        "command": "pwsh -NonInteractive -File \"<skill>/hooks/credential-context.ps1\"",
        "timeout": 10 } ] }
    ]
  }
}
```

On macOS or Linux use `bash "<skill>/hooks/credential-context.sh"` instead.

## What it stores, and where

| What | Where |
|---|---|
| Account metadata: id, username, email, host, repositories | `~/.claude/credentials/accounts.json`, plaintext |
| Tokens | Your OS keychain, via git's own credential helper |
| Commit identity | `~/.claude/credentials/identity-<id>.gitconfig`, included by remote URL |
| Last probe result | `~/.claude/credentials/pat-status.json` |

Tokens go through `git credential`, not a platform-specific keychain API. That is what makes it
portable: Windows Credential Manager, macOS Keychain and libsecret all speak the same protocol,
and git reads them natively, so push and fetch work with no wrapper and no prompt.

`accounts.json` holds no secrets, by design and by check: `doctor` fails if it finds anything
token-shaped in there.

**Passwords are not stored at all.** GitHub has not accepted one for git since 2021 and the API
takes tokens, so an account password enables nothing and is pure liability.

## Token states

`probe` reports six states. Three of them look like success and mean different things:

| State | Meaning |
|---|---|
| `valid` | has an expiry, comfortably far off |
| `expiring` | expires within 14 days |
| `dead` | revoked, expired or invalid |
| `no-expiry` | works, but has **no expiration date set** |
| `absent` | no token stored for this account |
| `unreachable` | network problem, so the check was inconclusive |

`no-expiry` is reported but not warned on. GitHub simply omits the expiry header for a token that
never expires, so the absence of the header is the signal. Worth knowing you have one; not worth
a daily alert.

`unreachable` never counts as expiry. A probe that cannot reach the network will not tell you a
working token is dead.

`probe` exits non-zero when anything is `dead` or `expiring`, so you can gate a CI step on it.

## Azure DevOps

ADO is handled differently and deliberately. Its git authentication is owned by Git Credential
Manager's Azure AD flow, so there is no PAT for git to store; trying to store one does not stick.

An ADO account's PAT is treated as a **REST API credential** instead, for skills that call the ADO
API. It is looked up in three places, in order: the keychain, then the env var named in
`apiToken.envVar` (conventionally `AZURE_DEVOPS_PAT`), then any `.env` file listed in
`apiToken.envFile`.

That third source matters more than it looks. A scheduled task runs with a minimal environment,
so a token that only exists in your shell is invisible to the daily probe, which then reports it
as `absent` and checks nothing. Point `apiToken.envFile` at the `.env` you already keep and the
probe works unattended. `probe` prints the source for any token not from the keychain, so you can
always see which one answered.

ADO exposes no expiry date to an unprivileged token, so its check is validity-only.

`dev.azure.com` and `<org>.visualstudio.com` are the same organisation but different credential
hosts to git, so they appear as two accounts.

## Adding an account later

```
/git-manager add github-newthing
```

Or manually, if you prefer:

```
node scripts/creds.mjs add-account --id github-newthing --host github.com \
  --username <user> --email <you@example.com> --owners <org>
node scripts/creds.mjs set-token --id github-newthing --from-env SOME_VAR
node scripts/creds.mjs sync-repos && node scripts/creds.mjs doctor
```

`add-account` applies the routing and the commit identity for you. Doing it by hand and
forgetting either is exactly what this skill exists to prevent, which is why `doctor` checks for
both. Omitting `--email` is allowed and reported, not silently accepted.

## Removing repos that no longer exist

`sync-repos` only adds. When a repo is deleted on the provider its registry entry lingers:

```
node scripts/creds.mjs prune-repos --id github-personal --dry-run
node scripts/creds.mjs prune-repos --id github-personal
```

It will not take a 404 at face value. GitHub returns 404 rather than 403 for a private repo a
token cannot read, so an under-scoped token would make every private repo look deleted. The
token's reach is checked first, and anything it cannot conclusively see is reported
`inconclusive` and **kept**.

Local clones are never touched. A clone whose remote is gone is reported with its path, since it
can no longer push.

## Safety

- Secrets are never accepted on argv, which is visible to every process and lands in shell
  history. Use `--from-env VAR` or pipe on stdin.
- Tokens are printed masked unless you pass `--reveal`.
- Scheduler installers are printed, never run automatically.
- `remove-account` drops the metadata, the tokens, the routes **and** the commit identity
  together, so deleting an account cannot leave orphaned credentials or a stale author address
  behind.
- A commit email is never guessed. A wrong one fails silently and unwinding it rewrites history.
- `prune-repos` deletes registry entries only, never a working copy, and never acts on a repo
  whose absence it could not establish.

## Known limits

- The cron installer is syntax-checked and its argument handling is tested, but the actual
  `crontab` write has not been exercised (developed on Windows). Verify with
  `crontab -l | grep git-manager` after installing.
- On macOS, a cron job reaching the keychain may need Full Disk Access granted to `cron` before
  it can read tokens. The probe log is where that surfaces.
- Repo discovery walks each root one level deep. Nested layouts need the inner directory listed
  as its own root.
- Commit-identity patterns are emitted for the owner as declared and lowercased. An owner written
  in some third casing in a remote URL is not matched, because git's `hasconfig:` glob is
  case-sensitive. Declare the owner as it appears in the remote.
- `doctor`'s identity drift check only sees repos the registry knows about. A clone that was
  never registered picks up the right identity automatically but cannot be reported on; run
  `sync-repos` to bring it into view.

See `references/design.md` for why things are built this way, including the measurements that
overturned the original design.

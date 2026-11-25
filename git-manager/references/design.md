# Design notes

Decisions that cost something to discover. Each one was measured on a real machine with three
GitHub identities and an Azure DevOps organisation.

## Tokens were never the problem; routing was

The starting assumption was that several GitHub accounts overwrite one shared credential slot,
so the fix was to key storage per repo path with `credential.useHttpPath=true`.

Measured, that was wrong in both halves:

- The OS credential store **already keyed tokens by username**. Two accounts on `github.com`
  held distinct 40-character tokens, confirmed by comparing SHA-256 prefixes without printing
  either value. Nothing was overwriting anything.
- The actual failure was that git had no way to know **which username** a given repo wanted, so
  it fell back to an unqualified `github.com` entry.

So the fix is routing, not storage. And `useHttpPath=true` would have made things worse: with it
on, a lookup for an existing token returns nothing, because a path-scoped query does not match a
pathless entry. Enabling it would have orphaned every working token on the machine.

**Lesson: confirm which of two plausible mechanisms is actually failing before fixing either.**

## Git matches credential config by path PREFIX

This is what makes per-owner routing viable, and it is easy to assume otherwise since the
documentation stresses exact matching. Verified with `git config --get-urlmatch`:

```
credential.https://github.com/acme-org.username = alice
-> https://github.com/acme-org/some-repo.git   resolves to alice
```

One line per owner covers every repo under it. Without prefix matching this would need one entry
per repo, which is 25 entries on the machine it was developed against.

Prefix matching works with `useHttpPath` **off**, which is the combination used: routing by
config, storage by host and username.

## A second secret cannot be scoped by `path=`

An earlier version stored an account password alongside its PAT, separated by
`path=__account-password__`. It looked sufficient. It was not.

With `useHttpPath` off, Git Credential Manager **normalises the path away**, so both secrets
resolved to the same `(host, username)` key and the second write overwrote the first. Writing the
password destroyed the PAT and broke git auth for that account outright. The failure is silent at
write time and only appears later as a confusing auth error.

Two consequences, both retained:

- Secrets that must coexist use a **synthetic host** (`api-token.invalid`, reserved by RFC 2606
  and never resolvable) rather than a path qualifier.
- `storeToken` **re-reads the git token after any API-token write** and refuses if it was
  clobbered. A guarantee that fails silently needs a check, not a comment.

**Lesson: storage granularity is decided by the credential HELPER, not by the fields passed to
it.**

## Three token states, not two

The probe originally classified valid or dead. A real classic PAT returned 200 with **no**
`github-authentication-token-expiration` header at all. GitHub omits that header entirely for a
token with no expiration date, so absence is the signal, not an error.

Classifying it `valid` hides a non-expiring credential with broad scopes. Classifying it a
failure cries wolf on every probe. It gets its own state, `no-expiry`, reported but not warned
on.

`unreachable` is likewise separate. A probe that cannot reach the network must never tell
somebody their working token is dead.

## Azure DevOps cannot be managed the same way

Attempted and reverted: writing an ADO PAT through `git credential approve` does not stick,
because Git Credential Manager owns ADO auth through its Azure AD flow. Hand-managing it fights
the helper instead of configuring it.

Two further details that cost time:

- The credential's real username is the **Azure AD email**, not the organisation name that
  appears in the remote URL. GCM rewrites the username it was queried with.
- `dev.azure.com` and `<org>.visualstudio.com` are the same organisation but **different
  credential hosts** to git, so they need separate account entries.

ADO accounts are therefore `interactive-aad`: git auth is left alone, and only the REST API PAT
is managed and probed.

## A route is only required where a host is contested

The first `doctor` demanded a username route for every account and reported three problems on a
correctly configured machine. With one account on a host, git has nothing to disambiguate.

**Lesson: a check that fires on a correct configuration trains people to ignore it.**

## Authentication and authorship are different questions

The registry routed credentials by owner from the start, and stopped there. Repointing a repo at
another account therefore fixed the push and left the commit email wrong, which surfaced only
when somebody noticed commits attributing to the wrong person. The manual `git config user.email`
that fixes one repo is also what hides the gap, because it leaves every other repo under that
account still wrong.

Two candidate mechanisms:

| Mechanism | Binds to | Fails when |
|---|---|---|
| `includeIf "gitdir:<path>"` | where the clone sits | a repo moves, is cloned outside the scanned roots, or is repointed at another account |
| `includeIf "hasconfig:remote.*.url:<glob>"` | the remote URL | the URL is written in a form or casing no pattern covers |

The remote-URL form was chosen because it binds identity to the **same axis the credential route
already uses**. Any drift then affects both together rather than leaving them disagreeing, and
the case the gitdir form gets wrong - a repointed remote - is exactly the case that motivated the
feature.

Measured behaviour, because none of it is stated plainly in the docs:

| Remote URL | Pattern `https://github.com/acct/**` |
|---|---|
| `https://github.com/acct/x.git` | matches |
| `https://github.com/acct/x` | matches |
| `https://github.com/ACCT/x.git` | **no match** - case-sensitive |
| `git@github.com:acct/x.git` | **no match** - literal on URL form |
| `ssh://git@github.com/acct/x.git` | **no match** |

Hence four patterns per owner, each also emitted lowercased. The SSH forms match once given
their own patterns.

**Lesson: a glob over a URL is not a URL matcher.** It does not normalise scheme, casing or the
SCP-like form, so every form a remote can be written in needs its own pattern.

### Two gates that look alike and are not

`applyRouting` skips a host with only one account, correctly: git has nothing to disambiguate.
Reusing that gate for identity would have been wrong, because git cannot infer an email from the
number of accounts. The same applies to `authMode`: an `interactive-aad` account has no stored
git token and still authors commits. The identity pass is therefore gated only on whether an
email is declared.

**Lesson: before reusing a guard, restate what it is protecting against in the new context.**

### The version check is the feature

`includeIf "hasconfig:"` needs Git 2.36. Older git does not warn, it ignores the section. A
skill that wrote the config anyway would report success and leave authorship untouched, which is
worse than not having the feature: the user stops checking. So the version is probed and
`set-identity` exits non-zero when it cannot apply.

**Lesson: a mechanism whose failure mode is silence must verify its own precondition.**

### Local config still wins, on purpose

A repo-local `user.email` outranks any global include. Overriding that would break a deliberate
per-repo exception, so precedence is left as git defines it. The cost is that a stale local value
silently defeats the account identity, so `doctor` reads what git actually RESOLVES in every
registered repo and reports each mismatch with its `--unset` command, rather than trusting that
writing the include was sufficient.

**Lesson: verify the resolved value, not the write that was supposed to produce it.**

## A 404 is a statement about the TOKEN as much as about the repo

`prune-repos` removes registry entries for repositories the provider no longer has. The first
implementation classified three ways - present, gone, inconclusive - specifically to avoid
treating a network failure as a deletion. It still got the important case wrong.

GitHub answers **404, not 403**, for a private repository a token cannot read, deliberately, so
that it does not leak existence. A prune that reads 404 as "deleted" therefore removes every
private repo the instant a token is under-scoped, and the output looks exactly like a genuine
mass deletion: no error, no warning, just a long list of confident verdicts.

It was caught by the COUNT. A 6-repo account reported 5 gone against a user who had deleted
"a couple". Nothing in the tool's output was suspicious; the arithmetic was. The verdict then
survived scrutiny - the token did hold `repo` scope, two independent methods agreed, and the
repos really were deleted - but the near-miss was luck, not design.

The fix establishes visibility BEFORE interpreting any 404:

| `x-oauth-scopes` on `/user` | Meaning | 404 means |
|---|---|---|
| present, contains `repo` | classic PAT that can read private repos | `gone` |
| present, no `repo` | classic PAT limited to public | `inconclusive` |
| absent | fine-grained PAT; its grant is not enumerable from a header | `gone`, with a printed caveat |

Note the header's absence means "cannot tell", not "no scopes" - reading an absent header as an
empty scope list would have made every fine-grained token look powerless.

**Lesson: a negative result from an authenticated API is conditioned on what that credential can
see. Establish the observer's reach before believing the observation.** Same family as
"a detector that reports zero must be distinguishable from one that is blind", and the reason the
summary prints the size of the set scanned next to the number of hits.

**Second lesson: an implausible proportion is the cheapest defect detector available.** It needs
no instrumentation and it fired here when nothing else did.

## Answering a question a directory cannot answer

`discoverRepos` treated any directory where `git remote get-url origin` succeeded as a repo.
That command succeeds from **anywhere inside a work tree**, so the test never distinguished a
repo from a folder within one. Passing two repos as roots reported 30, and each registry entry
kept whichever child sorted last - `.../services/agent/webui` instead of `.../services/agent`.

Nothing failed. The paths looked plausible, and the only visible symptom was a repo count that
was too high to be real.

`rev-parse --show-toplevel` asks the actual question, and deduplicating on its answer collapses
every child of one repo to a single entry. The root itself is now examined too, so pointing the
scanner at a repo does the obvious thing instead of scanning past it.

**Lesson: a command succeeding is not the proposition you wanted tested.** Same shape as the 404
above - both took a convenient signal for the question actually being asked.

## Why not a password vault

An earlier version included an AES-256-GCM vault with a scrypt-derived key for account passwords.
It worked, and it was removed, because an account password enables nothing here: GitHub has not
accepted one for git operations since 2021, and the API takes tokens. Storing one is liability
with no capability.

There is also a practical trap worth recording: when an agent is doing the storing, a passphrase
supplied in conversation sits in the transcript beside the secret it protects, so the vault adds
ceremony without adding protection. A passphrase-gated vault is only meaningfully stronger when a
human types the passphrase into a terminal.

## Probe what the credential is SCOPED for, not what is convenient to probe

The ADO probe originally tested one org-independent endpoint,
`app.vssps.visualstudio.com/_apis/profile/profiles/me`, chosen so a wrong org name could never
cause a false negative.

That endpoint needs **User Profile (Read)** scope. A PAT scoped to Work Items, which is what the
ADO skills actually require, does not have it. ADO returns **401 for insufficient scope exactly
as it does for a revoked token**, so there was no way to tell them apart from the response.

Measured on a genuinely new, working PAT:

| Endpoint | Result |
|---|---|
| `_apis/profile/profiles/me` | 401 |
| `<project>/_apis/wit/workitems/<id>` | 200 |
| `_apis/projects` | 200 |
| `<project>/_apis/wit/fields` | 200 |

So the probe reported DEAD on a perfectly good credential. That is the worst possible direction
for this error: the advice attached to DEAD is "regenerate it", so the tool confidently tells you
to replace a working token, and the replacement fails the same way. The user had already done
exactly that once.

The fix is to probe the account's **own** org and project first, recovered from its `owners`
field, and to declare the token dead only when every endpoint in the ladder rejects it. The
profile endpoint remains last, as a fallback for an account with no org recorded.

Note the two owner shapes, which are easy to conflate: on `dev.azure.com` the owner is
`<org>/<project>` and the org is not in the host, while on `<org>.visualstudio.com` the org IS
the host subdomain and the owner is just the project.

**General lesson: a reachability probe must exercise a capability the credential is actually
granted. Testing a broader capability manufactures false failure, and a false DEAD is far more
damaging than a false UNREACHABLE, because of the action it prompts.**

## Credential context must not contain credentials

The request was for credentials to be provided automatically whenever a task concerns GitHub or
ADO. Taken literally that means injecting a token into conversation context, which would copy a
live credential into every transcript, log and context window that request touches, permanently
and by default. It is the same exposure that made the PAT earlier in this work need rotating,
except automated.

What a caller actually needs is three facts, none of them secret: which identity applies, whether
it is healthy, and how to use it. So the hook injects those, and `exec` supplies the token to a
child process's environment where it is used but never displayed.

The tempting shortcut is `get-token --reveal` piped into a command. That defeats the whole
arrangement, so the context block says so explicitly every time it fires.

## A trigger that fires on everything is a trigger that gets disabled

The hook first matched on topic keywords **or** on the working directory being a GitHub/ADO
clone. Tested, the location arm fired on `refactor this function please` inside a checkout, which
is to say on nearly every prompt anyone types in a repo.

The location arm was also redundant: the phrasings it was meant to catch ("push this", "open a
PR") all contain verbs already in the topic pattern. It contributed noise and no signal, so it
was removed. The working directory is still used, but only afterwards, to name the account that
applies.

Measured after the change, 8 of 8 cases classify correctly, including `improve the preprocessing
step` staying silent, which needs `\bPR\b` matched case-sensitively and separately from the
case-insensitive topic pattern.

## `shell: true` and a token are a bad combination

`exec` first spawned with `shell: true` on Windows so that `.cmd` wrappers like npm would run.
Node's own DEP0190 warning names the problem: with a shell, argv is concatenated **without
escaping**. That mangled quoted arguments in testing, and more seriously it turns any shell
metacharacter in an argument into injection, in the one command that deliberately carries a
credential in its environment.

Now `shell: false` always. A `.cmd` is wrapped explicitly (`-- cmd /c npm ...`), and an ENOENT on
win32 prints that hint.

## Verification status

| Component | Verified how |
|---|---|
| Routing, three identities | `ls-remote` against all three, unattended, prompts disabled |
| Prefix matching | `git config --get-urlmatch` against real repo URLs |
| PAT collision and guard | reproduced the clobber, restored, confirmed the guard rejects it |
| Probe: `dead` | real expired ADO PAT, 401 across three endpoints |
| Probe: `no-expiry` | real GitHub classic PAT, header absent on 200 |
| `status --quiet` | printed only when warnings existed |
| Cron installer | `bash -n` syntax check, plus argument validation exercised |
| `.env` fallback | probe resolved a token from file and reported `source: file:...` |
| `exec` injection | child read `GITHUB_TOKEN` and authenticated as the expected login |
| `exec` exit codes | child `process.exit(7)` propagated as 7 |
| Hook triggering | 8 of 8 cases, both fire and stay-silent, including `preprocessing` |
| Hook output | valid JSON, correct `hookEventName`, scanned for `ghp_`/`github_pat_`: none |
| Cron installation itself | **NOT verified** - no crontab on the development machine |
| Windows task installation | **NOT verified** - left for the user to run deliberately |
| Hook installed in settings | **NOT verified** - left for the user to enable deliberately |

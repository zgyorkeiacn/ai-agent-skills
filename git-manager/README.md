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
powershell -ExecutionPolicy Bypass -File scripts/install-schedule.ps1 -Time 09:00

# macOS / Linux
bash scripts/install-schedule.sh --time 09:00
```

## Daily use

Mostly none. The scheduled probe runs once a day and writes a status file; the skill reads it and
stays silent unless something needs attention.

```
/git-manager              # status summary
/git-manager probe        # check every token right now
/git-manager doctor       # routing, tokens, and whether the daily check is still running
/git-manager whoami       # which account owns the repo you are standing in
```

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
| Account metadata: id, username, host, repositories | `~/.claude/credentials/accounts.json`, plaintext |
| Tokens | Your OS keychain, via git's own credential helper |
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
  --username <user> --owners <org>
node scripts/creds.mjs set-token --id github-newthing --from-env SOME_VAR
node scripts/creds.mjs sync-repos && node scripts/creds.mjs doctor
```

`add-account` applies the routing for you. Doing it by hand and forgetting the route is exactly
the collision this skill exists to prevent, which is why `doctor` checks for it.

## Safety

- Secrets are never accepted on argv, which is visible to every process and lands in shell
  history. Use `--from-env VAR` or pipe on stdin.
- Tokens are printed masked unless you pass `--reveal`.
- Scheduler installers are printed, never run automatically.
- `remove-account` drops the metadata, the tokens **and** the routes together, so deleting an
  account cannot leave orphaned credentials behind.

## Known limits

- The cron installer is syntax-checked and its argument handling is tested, but the actual
  `crontab` write has not been exercised (developed on Windows). Verify with
  `crontab -l | grep git-manager` after installing.
- On macOS, a cron job reaching the keychain may need Full Disk Access granted to `cron` before
  it can read tokens. The probe log is where that surfaces.
- Repo discovery walks each root one level deep. Nested layouts need the inner directory listed
  as its own root.

See `references/design.md` for why things are built this way, including the measurements that
overturned the original design.

# UserPromptSubmit hook: surface the right git identity when a request concerns GitHub or
# Azure DevOps, and warn about a dead or expiring token before it wastes a run.
#
# It injects CONTEXT, never a token. Putting a live credential into conversation context copies
# it into every transcript, log and context window that request touches, which is the exposure
# the credential store exists to prevent. What the agent needs is which identity applies, whether
# it is healthy, and the one command that uses a token without printing it.
#
# Silent when the request has nothing to do with either - a hook that fires on everything is a
# hook people turn off.
#
# Any failure exits 0 with no output. A broken hook must never block a prompt.

$ErrorActionPreference = 'Stop'

try {
    $raw = [Console]::In.ReadToEnd()
    if (-not $raw) { exit 0 }
    $payload = $raw | ConvertFrom-Json
    $prompt = [string]$payload.prompt
    $cwd = [string]$payload.cwd
} catch {
    exit 0
}

if (-not $cwd) { $cwd = (Get-Location).Path }

# Trigger on what the request is ABOUT, never on where it happens to run.
#
# An earlier version also fired whenever the working directory was a GitHub or ADO clone. That
# matched almost every prompt in any checkout - including "refactor this function" - which is the
# failure mode this hook most needs to avoid: one that fires on everything gets switched off, and
# then it is not there on the day it matters. The verbs that genuinely imply remote work (push,
# pull, clone, merge, commit, PR) are already in the pattern, so the location added noise and no
# signal. Location is still used AFTERWARDS, to say which account applies.
#
# `\bPR\b` is matched case-SENSITIVELY and separately: case-insensitively it would fire on any
# word containing "pr".
$topicPattern = '(?i)\b(github|gh\s+(pr|repo|issue)|pull\s*request|azure\s*devops|dev\.azure|ado|work\s*item|user\s*story|epic|backlog|sprint|clone|fork|remote|push|merge|commit|repo(sitory)?|token|credential|pat)\b'

$relevant = ($prompt -cmatch '\bPR\b') -or ($prompt -match $topicPattern)
if (-not $relevant) { exit 0 }

$creds = Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts\creds.mjs'
if (-not (Test-Path $creds)) { exit 0 }

try {
    $context = & node $creds context --cwd $cwd 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $context) { exit 0 }
} catch {
    exit 0
}

@{
    hookSpecificOutput = @{
        hookEventName     = 'UserPromptSubmit'
        additionalContext = ($context -join "`n")
    }
} | ConvertTo-Json -Compress -Depth 5

exit 0

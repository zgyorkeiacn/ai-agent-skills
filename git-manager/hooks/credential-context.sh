#!/usr/bin/env bash
#
# UserPromptSubmit hook (macOS / Linux): surface the right git identity when a request concerns
# GitHub or Azure DevOps, and warn about a dead or expiring token before it wastes a run.
#
# Injects CONTEXT, never a token. A live credential in conversation context is copied into every
# transcript, log and context window that request touches.
#
# Silent when the request concerns neither. Any failure exits 0 with no output: a broken hook
# must never block a prompt.

set -uo pipefail

payload="$(cat || true)"
[ -n "$payload" ] || exit 0

# Prefer jq, but do not require it: a hook that hard-depends on an optional tool fails closed on
# machines that lack it, and this one must fail open.
if command -v jq >/dev/null 2>&1; then
  prompt="$(printf '%s' "$payload" | jq -r '.prompt // ""' 2>/dev/null || true)"
  cwd="$(printf '%s' "$payload" | jq -r '.cwd // ""' 2>/dev/null || true)"
else
  prompt="$(printf '%s' "$payload" | sed -n 's/.*"prompt"[[:space:]]*:[[:space:]]*"\(.*\)".*/\1/p' | head -1)"
  cwd="$(printf '%s' "$payload" | sed -n 's/.*"cwd"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
fi

[ -n "$cwd" ] || cwd="$PWD"

# Trigger on what the request is ABOUT, never on where it happens to run. Firing merely because
# the working directory is a clone matched almost every prompt in any checkout, and a hook that
# fires on everything gets switched off. Location is used afterwards, to say which account
# applies, not to decide relevance.
relevant=0
if printf '%s' "$prompt" | grep -Eiq '\b(github|pull[[:space:]]*request|azure[[:space:]]*devops|dev\.azure|ado|work[[:space:]]*item|user[[:space:]]*story|epic|backlog|sprint|clone|fork|remote|push|merge|commit|repo|repository|token|credential|pat)\b'; then
  relevant=1
fi
# Case-SENSITIVE, so it does not fire on every word containing "pr".
if printf '%s' "$prompt" | grep -Eq '\bPR\b'; then
  relevant=1
fi

[ "$relevant" -eq 1 ] || exit 0

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CREDS="$(dirname "$SCRIPT_DIR")/scripts/creds.mjs"
[ -f "$CREDS" ] || exit 0

context="$(node "$CREDS" context --cwd "$cwd" 2>/dev/null || true)"
[ -n "$context" ] || exit 0

# Emit JSON with the context as a string. jq builds it safely; without jq, fall back to a
# minimal escaper covering backslash, quote and newline.
if command -v jq >/dev/null 2>&1; then
  jq -nc --arg ctx "$context" \
    '{hookSpecificOutput:{hookEventName:"UserPromptSubmit",additionalContext:$ctx}}'
else
  escaped="$(printf '%s' "$context" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | awk '{printf "%s\\n", $0}')"
  printf '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"%s"}}\n' "$escaped"
fi

exit 0

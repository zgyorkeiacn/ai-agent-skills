# PostToolUse hook: TodoWrite - runs /index-codebase refresh + /update-docs when all todos done.
# Both skills check staleness internally; this hook only gates on all-done state.
# Shared hook: also referenced by update-docs/hooks/on-todo-complete.ps1.

$raw = [Console]::In.ReadToEnd()
if (-not $raw.Trim()) { exit 0 }

try { $data = $raw | ConvertFrom-Json } catch { exit 0 }

$todos = $data.tool_input.todos
if (-not $todos -or $todos.Count -eq 0) { exit 0 }

# Only fire if every todo is completed
$pending = @($todos | Where-Object { $_.status -ne "completed" })
if ($pending.Count -gt 0) { exit 0 }

$cwd = if ($data.cwd) { $data.cwd } else { (Get-Location).Path }

# Guard: skip if already fired for this project in the last 30 minutes
$safeKey = $cwd -replace '[:\\/]', '-'
$stateFile = Join-Path $env:TEMP "claude-todo-complete-$safeKey.txt"
if (Test-Path $stateFile) {
    try {
        $lastRun = [datetime](Get-Content $stateFile -Raw).Trim()
        if ((Get-Date) - $lastRun -lt [timespan]::FromMinutes(30)) { exit 0 }
    } catch {}
}
(Get-Date -Format "o") | Set-Content $stateFile -Encoding UTF8

$logFile = Join-Path $env:TEMP "claude-todo-complete.log"
$prompt = "All todos are complete. Run /index-codebase refresh to update CODEBASE_INDEX.md if stale, then run /update-docs to audit and update docs/ if stale. Do nothing else."

Start-Process -FilePath "pwsh" `
    -ArgumentList @(
        "-NonInteractive",
        "-Command",
        "Set-Location '$cwd'; claude --dangerously-skip-permissions --print -p '$prompt' 2>&1 | Out-File -FilePath '$logFile' -Encoding utf8"
    ) `
    -WindowStyle Hidden

exit 0

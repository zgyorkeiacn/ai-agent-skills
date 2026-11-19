# PostToolUse hook: ExitPlanMode
# Finds the most recently written plan file and asynchronously invokes the session-handoff
# skill to incorporate the plan's phases and tasks into implementation_plan.md.
# Returns immediately so the conversation is not blocked.

$raw = [Console]::In.ReadToEnd()
$cwd = $null
if ($raw.Trim()) {
    try { $cwd = ($raw | ConvertFrom-Json).cwd } catch {}
}
if (-not $cwd) { $cwd = (Get-Location).Path }

$plansDir = "C:\Users\zoltan.gyorkei\.claude\plans"
$planFile = Get-ChildItem -Path $plansDir -Filter "*.md" -ErrorAction SilentlyContinue `
    | Sort-Object LastWriteTime -Descending `
    | Select-Object -First 1 -ExpandProperty FullName

if (-not $planFile) { exit 0 }

$logFile = Join-Path $env:TEMP "claude-handoff-exit.log"
$prompt = "The plan at '$planFile' was just accepted. Run /session-handoff skill: incorporate the plan's phases and tasks into implementation_plan.md. Write it short (bullets, about 1.5 KB per entry, no copied prompts or history). Preserve AGENT_CONTEXT.md unless it needs an update."

Start-Process -FilePath "pwsh" `
    -ArgumentList @(
        "-NonInteractive",
        "-Command",
        "Set-Location '$cwd'; claude --dangerously-skip-permissions --print -p '$prompt' 2>&1 | Out-File -FilePath '$logFile' -Encoding utf8"
    ) `
    -WindowStyle Hidden

exit 0

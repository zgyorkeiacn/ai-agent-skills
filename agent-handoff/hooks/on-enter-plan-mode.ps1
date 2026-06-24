# PostToolUse hook: EnterPlanMode
# Asynchronously runs the agent-handoff skill to orient any agent before plan mode begins.
# Returns immediately so plan mode is not delayed.

$raw = [Console]::In.ReadToEnd()
$cwd = $null
if ($raw.Trim()) {
    try { $cwd = ($raw | ConvertFrom-Json).cwd } catch {}
}
if (-not $cwd) { $cwd = (Get-Location).Path }

$logFile = Join-Path $env:TEMP "claude-handoff-enter.log"
$prompt = "Run the agent-handoff skill to generate or refresh AGENT_CONTEXT.md and a skeleton implementation_plan.md for this project. Plan mode has just started."

Start-Process -FilePath "pwsh" `
    -ArgumentList @(
        "-NonInteractive",
        "-Command",
        "Set-Location '$cwd'; claude --dangerously-skip-permissions --print -p '$prompt' 2>&1 | Out-File -FilePath '$logFile' -Encoding utf8"
    ) `
    -WindowStyle Hidden

exit 0

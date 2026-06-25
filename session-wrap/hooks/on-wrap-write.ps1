# on-wrap-write.ps1
# PostToolUse/Write hook for the session-wrap skill.
# Fires after every Write tool call; acts only when /session-wrap has just
# written .claude/session-wrap/current.md.
#
# On match: spawns a new pwsh window running 'claude' so the user can switch
# to a fresh session that will auto-load the summary via CLAUDE.md.

$ErrorActionPreference = "Stop"

try {
    # Read JSON payload from stdin
    $raw = $input | Out-String
    if ([string]::IsNullOrWhiteSpace($raw)) { exit 0 }

    $payload  = $raw | ConvertFrom-Json
    $filePath = $payload.tool_input.file_path

    if ([string]::IsNullOrWhiteSpace($filePath)) { exit 0 }

    # Normalize path separators for comparison
    $normalized = $filePath -replace '/', '\'

    # Only act when the session-wrap summary file was written
    if ($normalized -notmatch 'session-wrap\\current\.md$') {
        exit 0
    }

    # Spawn a new PowerShell terminal running 'claude'
    # -WindowStyle Normal opens a visible window the user can switch to
    Start-Process pwsh `
        -ArgumentList @("-NoExit", "-Command", "claude") `
        -WindowStyle Normal

} catch {
    # Never block the Write tool - swallow all errors silently
}

exit 0

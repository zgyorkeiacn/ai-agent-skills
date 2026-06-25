# index-codebase skill installer
# Installs the on-todo-complete hook to ~/.claude/scripts/ and registers it in settings.json.
# Idempotent: safe to run multiple times.

$ErrorActionPreference = "Stop"
$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$ScriptsDir  = "$env:USERPROFILE\.claude\scripts"
$SettingsFile = "$env:USERPROFILE\.claude\settings.json"
$HookSrc     = Join-Path $ScriptDir "hooks\on-todo-complete.ps1"
$HookDest    = Join-Path $ScriptsDir "on-todo-complete.ps1"

# 1. Ensure scripts directory exists
New-Item -ItemType Directory -Force $ScriptsDir | Out-Null

# 2. Copy hook script
Copy-Item -Force $HookSrc $HookDest
Write-Host "Installed: $HookDest"

# 3. Register in settings.json if not already present
$settings = if (Test-Path $SettingsFile) {
    Get-Content $SettingsFile -Raw | ConvertFrom-Json
} else {
    [pscustomobject]@{ hooks = [pscustomobject]@{ PostToolUse = @() } }
}

if (-not $settings.hooks) {
    $settings | Add-Member -NotePropertyName hooks -NotePropertyValue ([pscustomobject]@{ PostToolUse = @() })
}
if (-not $settings.hooks.PostToolUse) {
    $settings.hooks | Add-Member -NotePropertyName PostToolUse -NotePropertyValue @()
}

$hookCommand = "pwsh -NonInteractive -File $HookDest"

# Check if already registered
$alreadyRegistered = $false
foreach ($entry in $settings.hooks.PostToolUse) {
    if ($entry.matcher -eq "TodoWrite") {
        foreach ($h in $entry.hooks) {
            if ($h.command -eq $hookCommand) { $alreadyRegistered = $true; break }
        }
    }
    if ($alreadyRegistered) { break }
}

if ($alreadyRegistered) {
    Write-Host "Hook already registered in settings.json - skipping."
} else {
    $newEntry = [pscustomobject]@{
        matcher = "TodoWrite"
        hooks   = @([pscustomobject]@{ type = "command"; command = $hookCommand })
    }
    $settings.hooks.PostToolUse = @($settings.hooks.PostToolUse) + $newEntry
    $settings | ConvertTo-Json -Depth 20 | Set-Content $SettingsFile -Encoding UTF8
    Write-Host "Registered TodoWrite hook in settings.json."
}

Write-Host "index-codebase install complete."

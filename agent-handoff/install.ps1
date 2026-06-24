# agent-handoff/install.ps1
# Installs Claude Code hook scripts and settings.json patch for the agent-handoff skill.
# Idempotent — safe to run multiple times.
#
# Usage:
#   .\install.ps1              # install
#   .\install.ps1 -Uninstall   # remove scripts and hooks from settings.json

param([switch]$Uninstall)

$ErrorActionPreference = "Stop"

$SkillDir    = Split-Path -Parent $MyInvocation.MyCommand.Path
$HooksDir    = Join-Path $SkillDir "hooks"
$ScriptsDir  = "$env:USERPROFILE\.claude\scripts"
$SettingsFile = "$env:USERPROFILE\.claude\settings.json"

$HookScripts = @(
    "on-enter-plan-mode.ps1",
    "on-exit-plan-mode.ps1",
    "on-todo-write.ps1"
)

# matcher -> script filename
$HookMap = [ordered]@{
    "EnterPlanMode" = "on-enter-plan-mode.ps1"
    "ExitPlanMode"  = "on-exit-plan-mode.ps1"
    "TodoWrite"     = "on-todo-write.ps1"
}

function Write-Ok   { param($m) Write-Host "  [OK]   $m" -ForegroundColor Green }
function Write-Skip { param($m) Write-Host "  [SKIP] $m" -ForegroundColor Yellow }
function Write-Info { param($m) Write-Host "  [INFO] $m" -ForegroundColor Cyan }
function Write-Fail { param($m) Write-Host "  [FAIL] $m" -ForegroundColor Red }

Write-Host ""
Write-Host "  agent-handoff hook $(if ($Uninstall) { 'un' })installer" -ForegroundColor Magenta
Write-Host "  ─────────────────────────────────────" -ForegroundColor DarkGray
Write-Host ""

# ── UNINSTALL ─────────────────────────────────────────────────────────────────
if ($Uninstall) {
    foreach ($script in $HookScripts) {
        $target = Join-Path $ScriptsDir $script
        if (Test-Path $target) {
            Remove-Item $target -Force
            Write-Ok "Removed $target"
        } else {
            Write-Skip "$script not found at $ScriptsDir"
        }
    }

    if (Test-Path $SettingsFile) {
        $settings = Get-Content $SettingsFile -Raw | ConvertFrom-Json

        if ($settings.PSObject.Properties["hooks"] -and $settings.hooks.PSObject.Properties["PostToolUse"]) {
            $filtered = @($settings.hooks.PostToolUse | Where-Object {
                $_.matcher -notin $HookMap.Keys
            })
            $settings.hooks.PostToolUse = $filtered

            if ($filtered.Count -eq 0) {
                $settings.hooks.PSObject.Properties.Remove("PostToolUse")
            }
            if (($settings.hooks.PSObject.Properties | Measure-Object).Count -eq 0) {
                $settings.PSObject.Properties.Remove("hooks")
            }

            $settings | ConvertTo-Json -Depth 10 | Set-Content $SettingsFile -Encoding UTF8
            Write-Ok "Removed agent-handoff hooks from settings.json"
        } else {
            Write-Skip "No agent-handoff hooks found in settings.json"
        }
    }

    Write-Host ""
    Write-Ok "Uninstall complete"
    Write-Host ""
    exit 0
}

# ── INSTALL ───────────────────────────────────────────────────────────────────

# 1. Copy hook scripts to ~/.claude/scripts/
if (-not (Test-Path $ScriptsDir)) {
    New-Item -ItemType Directory -Path $ScriptsDir -Force | Out-Null
    Write-Info "Created $ScriptsDir"
}

foreach ($script in $HookScripts) {
    $src = Join-Path $HooksDir $script
    $dst = Join-Path $ScriptsDir $script

    if (-not (Test-Path $src)) {
        Write-Fail "Source not found: $src"
        exit 1
    }

    Copy-Item $src $dst -Force
    Write-Ok "Copied $script -> $ScriptsDir"
}

# 2. Patch ~/.claude/settings.json
if (-not (Test-Path $SettingsFile)) {
    Write-Info "settings.json not found - creating minimal one"
    @{ hooks = @{ PostToolUse = @() } } | ConvertTo-Json -Depth 10 |
        Set-Content $SettingsFile -Encoding UTF8
}

$settings = Get-Content $SettingsFile -Raw | ConvertFrom-Json

# Ensure hooks.PostToolUse exists
if (-not $settings.PSObject.Properties["hooks"]) {
    $settings | Add-Member -NotePropertyName "hooks" -NotePropertyValue ([PSCustomObject]@{})
}
if (-not $settings.hooks.PSObject.Properties["PostToolUse"]) {
    $settings.hooks | Add-Member -NotePropertyName "PostToolUse" -NotePropertyValue @()
}

$changed = $false
foreach ($matcher in $HookMap.Keys) {
    $scriptName = $HookMap[$matcher]
    $scriptPath = Join-Path $ScriptsDir $scriptName

    $exists = @($settings.hooks.PostToolUse | Where-Object { $_.matcher -eq $matcher })
    if ($exists.Count -gt 0) {
        # Update command in case the path changed
        $exists[0].hooks[0].command = "pwsh -NonInteractive -File $scriptPath"
        Write-Skip "$matcher hook already present - updated command path"
        $changed = $true
        continue
    }

    $entry = [PSCustomObject]@{
        matcher = $matcher
        hooks   = @(
            [PSCustomObject]@{
                type    = "command"
                command = "pwsh -NonInteractive -File $scriptPath"
            }
        )
    }

    $settings.hooks.PostToolUse = @($settings.hooks.PostToolUse) + @($entry)
    Write-Ok "Added PostToolUse hook for $matcher"
    $changed = $true
}

if ($changed) {
    $settings | ConvertTo-Json -Depth 10 | Set-Content $SettingsFile -Encoding UTF8
    Write-Ok "settings.json updated"
} else {
    Write-Skip "settings.json already up to date"
}

Write-Host ""
Write-Ok "Installation complete"
Write-Info "Restart Claude Code for hook changes to take effect"
Write-Host ""

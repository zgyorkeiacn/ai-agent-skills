# session-wrap/install.ps1
# Installs the Claude Code PostToolUse/Write hook that auto-spawns a new claude
# terminal window whenever /session-wrap writes current.md.
# sentinel: $env:USERPROFILE\.claude\scripts\on-wrap-write.ps1
# Idempotent - safe to run multiple times.
#
# Usage:
#   .\install.ps1              # install
#   .\install.ps1 -Uninstall   # remove script and hook from settings.json

param([switch]$Uninstall)

$ErrorActionPreference = "Stop"

$SkillDir     = Split-Path -Parent $MyInvocation.MyCommand.Path
$HooksDir     = Join-Path $SkillDir "hooks"
$ScriptsDir   = "$env:USERPROFILE\.claude\scripts"
$SettingsFile = "$env:USERPROFILE\.claude\settings.json"

$HookScript   = "on-wrap-write.ps1"
$HookMatcher  = "Write"

function Write-Ok   { param($m) Write-Host "  [OK]   $m" -ForegroundColor Green }
function Write-Skip { param($m) Write-Host "  [SKIP] $m" -ForegroundColor Yellow }
function Write-Info { param($m) Write-Host "  [INFO] $m" -ForegroundColor Cyan }
function Write-Fail { param($m) Write-Host "  [FAIL] $m" -ForegroundColor Red }

Write-Host ""
Write-Host "  session-wrap hook $(if ($Uninstall) { 'un' })installer" -ForegroundColor Magenta
Write-Host "  ─────────────────────────────────────────────────────" -ForegroundColor DarkGray
Write-Host ""

# ── UNINSTALL ─────────────────────────────────────────────────────────────────
if ($Uninstall) {
    $target = Join-Path $ScriptsDir $HookScript
    if (Test-Path $target) {
        Remove-Item $target -Force
        Write-Ok "Removed $target"
    } else {
        Write-Skip "$HookScript not found at $ScriptsDir"
    }

    if (Test-Path $SettingsFile) {
        $settings = Get-Content $SettingsFile -Raw | ConvertFrom-Json

        if ($settings.PSObject.Properties["hooks"] -and
            $settings.hooks.PSObject.Properties["PostToolUse"]) {

            $filtered = @($settings.hooks.PostToolUse | Where-Object {
                $_.matcher -ne $HookMatcher -or
                ($_.hooks | Where-Object { $_.command -like "*on-wrap-write*" }).Count -eq 0
            })

            $settings.hooks.PostToolUse = $filtered

            if ($filtered.Count -eq 0) {
                $settings.hooks.PSObject.Properties.Remove("PostToolUse")
            }
            if (($settings.hooks.PSObject.Properties | Measure-Object).Count -eq 0) {
                $settings.PSObject.Properties.Remove("hooks")
            }

            $settings | ConvertTo-Json -Depth 10 | Set-Content $SettingsFile -Encoding UTF8
            Write-Ok "Removed session-wrap hook from settings.json"
        } else {
            Write-Skip "No session-wrap hook found in settings.json"
        }
    }

    Write-Host ""
    Write-Ok "Uninstall complete"
    Write-Host ""
    exit 0
}

# ── INSTALL ───────────────────────────────────────────────────────────────────

# 1. Copy hook script to ~/.claude/scripts/
if (-not (Test-Path $ScriptsDir)) {
    New-Item -ItemType Directory -Path $ScriptsDir -Force | Out-Null
    Write-Info "Created $ScriptsDir"
}

$src = Join-Path $HooksDir $HookScript
$dst = Join-Path $ScriptsDir $HookScript

if (-not (Test-Path $src)) {
    Write-Fail "Source not found: $src"
    exit 1
}

Copy-Item $src $dst -Force
Write-Ok "Copied $HookScript -> $ScriptsDir"

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

# Check for existing session-wrap Write entry
$existing = @($settings.hooks.PostToolUse | Where-Object {
    $_.matcher -eq $HookMatcher -and
    ($_.hooks | Where-Object { $_.command -like "*on-wrap-write*" }).Count -gt 0
})

if ($existing.Count -gt 0) {
    $existing[0].hooks[0].command = "pwsh -NonInteractive -File $dst"
    Write-Skip "$HookMatcher hook already present - updated command path"
} else {
    $entry = [PSCustomObject]@{
        matcher = $HookMatcher
        hooks   = @(
            [PSCustomObject]@{
                type    = "command"
                command = "pwsh -NonInteractive -File $dst"
            }
        )
    }
    $settings.hooks.PostToolUse = @($settings.hooks.PostToolUse) + @($entry)
    Write-Ok "Added PostToolUse hook for $HookMatcher"
}

$settings | ConvertTo-Json -Depth 10 | Set-Content $SettingsFile -Encoding UTF8
Write-Ok "settings.json updated"

Write-Host ""
Write-Ok "Installation complete"
Write-Info "Restart Claude Code for the hook to take effect"
Write-Host ""

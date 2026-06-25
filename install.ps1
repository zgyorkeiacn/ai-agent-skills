# AI Agent Skills - Unified Installer
# Manages symlinks, per-skill hook installers, and per-skill enable/disable state.
#
# Usage:
#   .\install.ps1                          # install: symlinks + per-skill hooks
#   .\install.ps1 -Uninstall               # full uninstall (symlinks + hooks)
#   .\install.ps1 status                   # show all skills with their state
#   .\install.ps1 hooks                    # run per-skill installers only (no symlinks)
#   .\install.ps1 disable <skill-name>     # disable a skill (removes symlinks, skips future installs)
#   .\install.ps1 enable  <skill-name>     # re-enable a disabled skill

param(
    [Parameter(Position = 0)]
    [string]$Command = "",
    [Parameter(Position = 1)]
    [string]$SkillName = $null,
    [switch]$Uninstall,
    [ValidateSet("user", "repo")]
    [string]$Scope = "user",
    [string]$RepoPath = $null
)

$ErrorActionPreference = "Stop"

$SkillsRepoPath   = Split-Path -Parent $MyInvocation.MyCommand.Path
$SkillsConfigFile = "$env:USERPROFILE\.claude\skills-config.json"
$ExcludeSkills    = @("copilot-instructions-installer")

# ── Color helpers ──────────────────────────────────────────────────────────────

function Write-Ok   { param($m) Write-Host "  [OK]   $m" -ForegroundColor Green }
function Write-Skip { param($m) Write-Host "  [SKIP] $m" -ForegroundColor Yellow }
function Write-Info { param($m) Write-Host "  [INFO] $m" -ForegroundColor Cyan }
function Write-Fail { param($m) Write-Host "  [FAIL] $m" -ForegroundColor Red }

# ── Skills config ──────────────────────────────────────────────────────────────

function Get-SkillsConfig {
    if (Test-Path $SkillsConfigFile) {
        $cfg = Get-Content $SkillsConfigFile -Raw | ConvertFrom-Json
        if (-not $cfg.PSObject.Properties["disabled"]) {
            $cfg | Add-Member -NotePropertyName "disabled" -NotePropertyValue @()
        }
        return $cfg
    }
    return [PSCustomObject]@{ disabled = @() }
}

function Save-SkillsConfig {
    param($Config)
    $dir = Split-Path $SkillsConfigFile -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $Config | ConvertTo-Json -Depth 5 | Set-Content $SkillsConfigFile -Encoding UTF8
}

# ── Sentinel detection ─────────────────────────────────────────────────────────
# Each skill install.ps1 may declare its sentinel file on one of its first 5 lines:
#   # sentinel: $env:USERPROFILE\.claude\scripts\my-hook.ps1
# The root installer reads this to determine whether the hook is currently active.

function Get-SkillSentinel {
    param([string]$SkillDir)
    $script = Join-Path $SkillDir "install.ps1"
    if (-not (Test-Path $script)) { return $null }

    $lines = Get-Content $script -TotalCount 5 -ErrorAction SilentlyContinue
    foreach ($line in $lines) {
        if ($line -match '^\s*#\s*sentinel:\s*(.+)$') {
            # Convert $env:VAR notation to %VAR% so ExpandEnvironmentVariables works
            $raw      = $Matches[1].Trim()
            $winStyle = $raw -replace '\$env:(\w+)', '%$1%'
            return [System.Environment]::ExpandEnvironmentVariables($winStyle)
        }
    }
    return $null
}

# ── Agent system detection ─────────────────────────────────────────────────────

function Get-AgentSystems {
    param([string]$Scope, [string]$RepoPath)
    $systems = @()

    $claudePaths  = @(); $copilotPaths = @(); $geminiPaths  = @()

    if ($Scope -eq "user") {
        $claudePaths  += "$env:USERPROFILE\.claude\skills"
        $copilotPaths += "$env:USERPROFILE\.copilot\skills"
        $geminiPaths  += "$env:USERPROFILE\.gemini\antigravity\skills"
    }
    if ($Scope -eq "repo" -and $RepoPath) {
        $claudePaths  += "$RepoPath\.claude\skills"
        $copilotPaths += "$RepoPath\.copilot\skills"
        $geminiPaths  += "$RepoPath\.gemini\antigravity\skills"
    }

    if (($claudePaths  | Where-Object { Test-Path (Split-Path $_ -Parent) }).Count -gt 0) {
        $systems += [PSCustomObject]@{ Name = "Claude";  Paths = $claudePaths }
    }
    if (($copilotPaths | Where-Object { Test-Path (Split-Path $_ -Parent) }).Count -gt 0) {
        $systems += [PSCustomObject]@{ Name = "Copilot"; Paths = $copilotPaths }
    }
    if (($geminiPaths  | Where-Object { Test-Path (Split-Path $_ -Parent) }).Count -gt 0) {
        $systems += [PSCustomObject]@{ Name = "Gemini";  Paths = $geminiPaths }
    }

    return $systems
}

# ── Symlink helpers ────────────────────────────────────────────────────────────

function Set-SkillSymlinks {
    param($Skill, $AgentSystems)
    $count = 0
    foreach ($system in $AgentSystems) {
        foreach ($basePath in $system.Paths) {
            if (-not (Test-Path $basePath)) {
                New-Item -ItemType Directory -Path $basePath -Force | Out-Null
                Write-Info "Created $basePath"
            }
            $linkPath = Join-Path $basePath $Skill.Name
            if (Test-Path $linkPath) {
                $item = Get-Item $linkPath -ErrorAction SilentlyContinue
                if ($item.LinkType -in @("SymbolicLink", "Junction")) {
                    Remove-Item $linkPath -Force
                } else {
                    Write-Skip "$linkPath (not a symlink - skipping)"
                    continue
                }
            }
            try {
                New-Item -ItemType SymbolicLink -Path $linkPath -Target $Skill.FullName -Force | Out-Null
                Write-Ok "$($system.Name): $($Skill.Name)"
                $count++
            } catch {
                try {
                    cmd /c mklink /J "$linkPath" "$($Skill.FullName)" 2>&1 | Out-Null
                    Write-Ok "$($system.Name): $($Skill.Name) (junction)"
                    $count++
                } catch {
                    Write-Fail "Failed to link $($Skill.Name): $_"
                }
            }
        }
    }
    return $count
}

function Remove-SkillSymlinks {
    param([string]$SkillName, $AgentSystems)
    $count = 0
    foreach ($system in $AgentSystems) {
        foreach ($basePath in $system.Paths) {
            if (-not (Test-Path $basePath)) { continue }
            $linkPath = Join-Path $basePath $SkillName
            if (Test-Path $linkPath) {
                $item = Get-Item $linkPath -ErrorAction SilentlyContinue
                if ($item.LinkType -in @("SymbolicLink", "Junction")) {
                    Remove-Item $linkPath -Force
                    Write-Ok "Removed $($system.Name): $SkillName"
                    $count++
                } else {
                    Write-Skip "$linkPath (not a symlink)"
                }
            }
        }
    }
    return $count
}

# ── Per-skill hook installer ───────────────────────────────────────────────────

function Invoke-SkillInstaller {
    param([string]$SkillDir, [switch]$Uninstall)
    $script    = Join-Path $SkillDir "install.ps1"
    if (-not (Test-Path $script)) { return }
    $skillName = Split-Path $SkillDir -Leaf
    try {
        $output = if ($Uninstall) {
            & pwsh -NonInteractive -File $script -Uninstall 2>&1
        } else {
            & pwsh -NonInteractive -File $script 2>&1
        }
        if ($LASTEXITCODE -eq 0) {
            $verb = if ($Uninstall) { "uninstalled" } else { "installed" }
            Write-Ok "Hooks $verb`: $skillName"
        } else {
            Write-Fail "Hook installer failed: $skillName (exit $LASTEXITCODE)"
            $output | ForEach-Object { Write-Host "      $_" -ForegroundColor DarkGray }
        }
    } catch {
        Write-Fail "Hook installer error: $skillName - $_"
    }
}

# ── Normalise command ──────────────────────────────────────────────────────────

if ($Uninstall) { $Command = "uninstall" }
if ([string]::IsNullOrWhiteSpace($Command)) { $Command = "install" }
$Command = $Command.ToLower().Trim()

# ── Header ─────────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "  ═══════════════════════════════════════════════" -ForegroundColor Magenta
Write-Host "    AI Agent Skills" -ForegroundColor Magenta
Write-Host "  ═══════════════════════════════════════════════" -ForegroundColor Magenta
Write-Host ""

# ── Load skills and config ─────────────────────────────────────────────────────

$AllSkills = Get-ChildItem -Path $SkillsRepoPath -Directory |
    Where-Object { (Test-Path (Join-Path $_.FullName "SKILL.md")) -and ($_.Name -notin $ExcludeSkills) }

if ($AllSkills.Count -eq 0) {
    Write-Fail "No skills found in $SkillsRepoPath"
    exit 1
}

$Cfg           = Get-SkillsConfig
$Disabled      = @($Cfg.disabled)
$EnabledSkills = @($AllSkills | Where-Object { $_.Name -notin $Disabled })
$AgentSystems  = Get-AgentSystems -Scope $Scope -RepoPath $RepoPath

# ── Command dispatch ───────────────────────────────────────────────────────────

switch ($Command) {

    # ── install ───────────────────────────────────────────────────────────────
    "install" {
        if ($AgentSystems.Count -eq 0) {
            Write-Info "No AI agent directories detected - skipping symlinks."
            Write-Info "Run '.\install.ps1 hooks' to install hooks without symlinks."
            Write-Host ""
        } else {
            Write-Host "  Symlinking $($EnabledSkills.Count) skill(s)..." -ForegroundColor White
            if ($Disabled.Count -gt 0) {
                Write-Info "Skipping disabled: $($Disabled -join ', ')"
            }
            Write-Host ""
        }

        $symCount = 0
        foreach ($skill in $EnabledSkills) {
            $symCount += Set-SkillSymlinks -Skill $skill -AgentSystems $AgentSystems
        }

        $hookSkills = @($EnabledSkills | Where-Object { Test-Path (Join-Path $_.FullName "install.ps1") })
        if ($hookSkills.Count -gt 0) {
            Write-Host ""
            Write-Host "  Running per-skill hook installer(s)..." -ForegroundColor White
            Write-Host ""
            foreach ($skill in $hookSkills) {
                Invoke-SkillInstaller -SkillDir $skill.FullName
            }
        }

        Write-Host ""
        Write-Host "  ═══════════════════════════════════════════════" -ForegroundColor Magenta
        Write-Ok "Done  ($symCount symlink(s) created, $($hookSkills.Count) hook installer(s) run)"
        Write-Host "  ═══════════════════════════════════════════════" -ForegroundColor Magenta
        Write-Host ""
    }

    # ── uninstall ─────────────────────────────────────────────────────────────
    "uninstall" {
        Write-Host "  Uninstalling all skills..." -ForegroundColor Yellow
        Write-Host ""

        $removed = 0
        foreach ($skill in $AllSkills) {
            $removed += Remove-SkillSymlinks -SkillName $skill.Name -AgentSystems $AgentSystems
        }

        $hookSkills = @($AllSkills | Where-Object { Test-Path (Join-Path $_.FullName "install.ps1") })
        if ($hookSkills.Count -gt 0) {
            Write-Host ""
            Write-Host "  Uninstalling skill hooks..." -ForegroundColor Yellow
            Write-Host ""
            foreach ($skill in $hookSkills) {
                Invoke-SkillInstaller -SkillDir $skill.FullName -Uninstall
            }
        }

        Write-Host ""
        Write-Ok "Uninstall complete ($removed symlink(s) removed)"
        Write-Host ""
    }

    # ── status ────────────────────────────────────────────────────────────────
    "status" {
        $col1 = 26   # skill name
        $col2 = 20   # symlinks
        $col3 = 20   # hooks

        $header  = "  " + "Skill".PadRight($col1) + "Symlinks".PadRight($col2) + "Hooks".PadRight($col3) + "State"
        $divider = "  " + ("-" * ($col1 + $col2 + $col3 + 10))

        Write-Host $header  -ForegroundColor White
        Write-Host $divider -ForegroundColor DarkGray
        Write-Host ""

        foreach ($skill in $AllSkills) {
            $isDisabled = $Disabled -contains $skill.Name

            # Symlink column
            if ($AgentSystems.Count -eq 0) {
                $symlinkText  = "n/a"
                $symlinkColor = "DarkGray"
            } else {
                $parts = @()
                foreach ($system in $AgentSystems) {
                    foreach ($basePath in $system.Paths) {
                        $linkPath = Join-Path $basePath $skill.Name
                        $ok = Test-Path $linkPath
                        $parts += "$($system.Name) $(if ($ok) {'[ok]'} else {'[missing]'})"
                    }
                }
                $symlinkText  = $parts -join ", "
                $symlinkColor = if ($symlinkText -like "*[missing]*") { "Yellow" } else { "Green" }
            }

            # Hooks column
            $installScript = Join-Path $skill.FullName "install.ps1"
            if (-not (Test-Path $installScript)) {
                $hookText  = "n/a"
                $hookColor = "DarkGray"
            } else {
                $sentinel = Get-SkillSentinel -SkillDir $skill.FullName
                if ($null -eq $sentinel) {
                    $hookText  = "has installer"
                    $hookColor = "Cyan"
                } elseif (Test-Path $sentinel) {
                    $hookText  = "installed [ok]"
                    $hookColor = "Green"
                } else {
                    $hookText  = "not installed"
                    $hookColor = "Yellow"
                }
            }

            # State column
            $stateText  = if ($isDisabled) { "DISABLED" } else { "enabled" }
            $stateColor = if ($isDisabled) { "Yellow"   } else { "Green"   }

            Write-Host "  " -NoNewline
            Write-Host $skill.Name.PadRight($col1) -ForegroundColor White   -NoNewline
            Write-Host $symlinkText.PadRight($col2) -ForegroundColor $symlinkColor -NoNewline
            Write-Host $hookText.PadRight($col3)    -ForegroundColor $hookColor    -NoNewline
            Write-Host $stateText                   -ForegroundColor $stateColor
        }

        Write-Host ""
        Write-Host $divider -ForegroundColor DarkGray
        $detectedNames = if ($AgentSystems.Count -gt 0) { ($AgentSystems | ForEach-Object { $_.Name }) -join ", " } else { "none" }
        Write-Info "Detected agents : $detectedNames"
        Write-Info "Disabled        : $(if ($Disabled.Count -gt 0) { $Disabled -join ', ' } else { 'none' })"
        Write-Info "Config file     : $SkillsConfigFile"
        Write-Host ""
    }

    # ── hooks ─────────────────────────────────────────────────────────────────
    "hooks" {
        $hookSkills = @($EnabledSkills | Where-Object { Test-Path (Join-Path $_.FullName "install.ps1") })
        if ($hookSkills.Count -eq 0) {
            Write-Info "No enabled skills have per-skill hook installers."
            Write-Host ""
            exit 0
        }

        Write-Host "  Running $($hookSkills.Count) hook installer(s)..." -ForegroundColor White
        Write-Host ""

        foreach ($skill in $hookSkills) {
            Invoke-SkillInstaller -SkillDir $skill.FullName
        }

        Write-Host ""
        Write-Ok "Done"
        Write-Host ""
    }

    # ── disable ───────────────────────────────────────────────────────────────
    "disable" {
        if ([string]::IsNullOrWhiteSpace($SkillName)) {
            Write-Fail "Usage: .\install.ps1 disable <skill-name>"
            Write-Host ""
            Write-Host "  Available skills: $($AllSkills.Name -join ', ')" -ForegroundColor Gray
            exit 1
        }
        $target = $AllSkills | Where-Object { $_.Name -eq $SkillName } | Select-Object -First 1
        if (-not $target) {
            Write-Fail "Unknown skill: '$SkillName'"
            Write-Host "  Available: $($AllSkills.Name -join ', ')" -ForegroundColor Gray
            exit 1
        }
        if ($Disabled -contains $SkillName) {
            Write-Skip "$SkillName is already disabled"
            Write-Host ""
            exit 0
        }

        $Cfg.disabled = @($Disabled) + @($SkillName)
        Save-SkillsConfig -Config $Cfg

        $removed = Remove-SkillSymlinks -SkillName $SkillName -AgentSystems $AgentSystems

        Write-Host ""
        Write-Ok "$SkillName disabled ($removed symlink(s) removed)"
        Write-Info "Config updated: $SkillsConfigFile"
        Write-Host ""
    }

    # ── enable ────────────────────────────────────────────────────────────────
    "enable" {
        if ([string]::IsNullOrWhiteSpace($SkillName)) {
            Write-Fail "Usage: .\install.ps1 enable <skill-name>"
            Write-Host ""
            Write-Host "  Disabled skills: $(if ($Disabled.Count -gt 0) { $Disabled -join ', ' } else { 'none' })" -ForegroundColor Gray
            exit 1
        }
        $target = $AllSkills | Where-Object { $_.Name -eq $SkillName } | Select-Object -First 1
        if (-not $target) {
            Write-Fail "Unknown skill: '$SkillName'"
            Write-Host "  Available: $($AllSkills.Name -join ', ')" -ForegroundColor Gray
            exit 1
        }
        if ($Disabled -notcontains $SkillName) {
            Write-Skip "$SkillName is already enabled"
            Write-Host ""
            exit 0
        }

        $Cfg.disabled = @($Disabled | Where-Object { $_ -ne $SkillName })
        Save-SkillsConfig -Config $Cfg

        $added = Set-SkillSymlinks -Skill $target -AgentSystems $AgentSystems

        Write-Host ""
        Write-Ok "$SkillName enabled ($added symlink(s) created)"
        Write-Info "Config updated: $SkillsConfigFile"
        Write-Host ""
    }

    # ── unknown command ───────────────────────────────────────────────────────
    default {
        Write-Fail "Unknown command: '$Command'"
        Write-Host ""
        Write-Host "  Commands:" -ForegroundColor White
        Write-Host "    .\install.ps1                       install all (symlinks + hooks)" -ForegroundColor Gray
        Write-Host "    .\install.ps1 -Uninstall            uninstall all" -ForegroundColor Gray
        Write-Host "    .\install.ps1 status                show skill state" -ForegroundColor Gray
        Write-Host "    .\install.ps1 hooks                 run per-skill hook installers only" -ForegroundColor Gray
        Write-Host "    .\install.ps1 disable <skill-name>  disable a skill" -ForegroundColor Gray
        Write-Host "    .\install.ps1 enable  <skill-name>  re-enable a skill" -ForegroundColor Gray
        Write-Host ""
        exit 1
    }
}

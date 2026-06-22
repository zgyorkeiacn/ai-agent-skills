# AI Agent Skills Installer for Windows
# Automatically symlinks skills to AI agent directories

param(
    [switch]$Uninstall,
    [ValidateSet("user", "repo")]
    [string]$Scope = "user",
    [string]$RepoPath = $null
)

$ErrorActionPreference = "Stop"

# Color output helpers
function Write-Success { param($msg) Write-Host "✓ $msg" -ForegroundColor Green }
function Write-Info { param($msg) Write-Host "ℹ $msg" -ForegroundColor Cyan }
function Write-Warning { param($msg) Write-Host "⚠ $msg" -ForegroundColor Yellow }
function Write-Error { param($msg) Write-Host "✗ $msg" -ForegroundColor Red }

# Get the absolute path to this script's directory
$SkillsRepoPath = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host ""
Write-Host "═══════════════════════════════════════════════" -ForegroundColor Magenta
Write-Host "  AI Agent Skills Installer" -ForegroundColor Magenta
Write-Host "═══════════════════════════════════════════════" -ForegroundColor Magenta
Write-Host ""

# Detect available skills (exclude standalone skills)
$ExcludeSkills = @("copilot-instructions-installer")
$Skills = Get-ChildItem -Path $SkillsRepoPath -Directory | Where-Object { 
    (Test-Path (Join-Path $_.FullName "SKILL.md")) -and ($_.Name -notin $ExcludeSkills)
}

if ($Skills.Count -eq 0) {
    Write-Error "No skills found in $SkillsRepoPath"
    exit 1
}

Write-Info "Found $($Skills.Count) skill(s): $($Skills.Name -join ', ')"
Write-Host ""

# Detect AI agent systems
$AgentSystems = @()

# GitHub Copilot
$CopilotPaths = @()
if ($Scope -eq "user") {
    $CopilotPaths += "$env:USERPROFILE\.copilot\skills"
}
if ($Scope -eq "repo" -and $RepoPath) {
    $CopilotPaths += "$RepoPath\.copilot\skills"
}
if (($CopilotPaths | Where-Object { Test-Path (Split-Path $_ -Parent) }).Count -gt 0) {
    $AgentSystems += @{ Name = "GitHub Copilot"; Paths = $CopilotPaths }
}

# Gemini Antigravity
$GeminiPaths = @()
if ($Scope -eq "user") {
    $GeminiPaths += "$env:USERPROFILE\.gemini\antigravity\skills"
}
if ($Scope -eq "repo" -and $RepoPath) {
    $GeminiPaths += "$RepoPath\.gemini\antigravity\skills"
}
if (($GeminiPaths | Where-Object { Test-Path (Split-Path $_ -Parent) }).Count -gt 0) {
    $AgentSystems += @{ Name = "Gemini Antigravity"; Paths = $GeminiPaths }
}

# Claude
$ClaudePaths = @()
if ($Scope -eq "user") {
    $ClaudePaths += "$env:USERPROFILE\.claude\skills"
}
if ($Scope -eq "repo" -and $RepoPath) {
    $ClaudePaths += "$RepoPath\.claude\skills"
}
if (($ClaudePaths | Where-Object { Test-Path (Split-Path $_ -Parent) }).Count -gt 0) {
    $AgentSystems += @{ Name = "Claude"; Paths = $ClaudePaths }
}

if ($AgentSystems.Count -eq 0) {
    Write-Warning "No AI agent systems detected."
    Write-Info "Supported locations:"
    Write-Host "  - $env:USERPROFILE\.copilot\skills"
    Write-Host "  - $env:USERPROFILE\.gemini\antigravity\skills"
    Write-Host "  - $env:USERPROFILE\.claude\skills"
    Write-Host ""
    Write-Info "To create directories manually:"
    Write-Host '  New-Item -ItemType Directory -Path "$env:USERPROFILE\.copilot\skills" -Force'
    Write-Host ""
    exit 1
}

Write-Info "Detected AI systems: $($AgentSystems.Name -join ', ')"
Write-Host ""

# Uninstall mode
if ($Uninstall) {
    Write-Host "UNINSTALLING skills..." -ForegroundColor Yellow
    Write-Host ""
    
    $removed = 0
    foreach ($system in $AgentSystems) {
        foreach ($basePath in $system.Paths) {
            if (-not (Test-Path $basePath)) { continue }
            
            foreach ($skill in $Skills) {
                $linkPath = Join-Path $basePath $skill.Name
                if (Test-Path $linkPath) {
                    Remove-Item $linkPath -Force -Recurse
                    Write-Success "Removed $($system.Name): $($skill.Name)"
                    $removed++
                }
            }
        }
    }
    
    Write-Host ""
    if ($removed -gt 0) {
        Write-Success "Uninstalled $removed symlink(s)"
    } else {
        Write-Info "No symlinks found to remove"
    }
    exit 0
}

# Install mode
Write-Host "INSTALLING skills..." -ForegroundColor Green
Write-Host ""

$installed = 0
foreach ($system in $AgentSystems) {
    foreach ($basePath in $system.Paths) {
        # Create base directory if needed
        if (-not (Test-Path $basePath)) {
            New-Item -ItemType Directory -Path $basePath -Force | Out-Null
            Write-Info "Created directory: $basePath"
        }
        
        foreach ($skill in $Skills) {
            $sourcePath = $skill.FullName
            $linkPath = Join-Path $basePath $skill.Name
            
            # Remove existing symlink/directory
            if (Test-Path $linkPath) {
                $item = Get-Item $linkPath
                if ($item.LinkType -eq "SymbolicLink" -or $item.LinkType -eq "Junction") {
                    Remove-Item $linkPath -Force
                    Write-Info "Removed existing symlink: $linkPath"
                } else {
                    Write-Warning "Skipping $linkPath (not a symlink)"
                    continue
                }
            }
            
            # Create symlink (requires admin on older Windows, mklink /J for junction)
            try {
                New-Item -ItemType SymbolicLink -Path $linkPath -Target $sourcePath -Force | Out-Null
                Write-Success "$($system.Name): $($skill.Name)"
                $installed++
            } catch {
                # Fall back to junction if symlink fails
                try {
                    cmd /c mklink /J "$linkPath" "$sourcePath" 2>&1 | Out-Null
                    Write-Success "$($system.Name): $($skill.Name) (junction)"
                    $installed++
                } catch {
                    Write-Error "Failed to link $($skill.Name): $_"
                }
            }
        }
    }
}

Write-Host ""
Write-Host "═══════════════════════════════════════════════" -ForegroundColor Magenta
Write-Success "Installation complete! ($installed symlink(s) created)"
Write-Host "═══════════════════════════════════════════════" -ForegroundColor Magenta
Write-Host ""

# Verification
Write-Info "Verification:"
foreach ($system in $AgentSystems) {
    foreach ($basePath in $system.Paths) {
        if (Test-Path $basePath) {
            Write-Host "  $($system.Name):" -ForegroundColor Cyan
            Get-ChildItem $basePath | ForEach-Object {
                $target = if ($_.LinkType) { " -> $($_.Target)" } else { "" }
                Write-Host "    - $($_.Name)$target" -ForegroundColor Gray
            }
        }
    }
}

Write-Host ""
Write-Info "Skills are now available in your AI agent!"
Write-Host ""
Write-Info "Usage examples:"
Write-Host '  @workspace /repo-dependency-analysis' -ForegroundColor Gray
Write-Host '  @antigravity /repo-dependency-analysis' -ForegroundColor Gray
Write-Host ""

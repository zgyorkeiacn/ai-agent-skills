# repo-dependency-analysis/install.ps1
# sentinel: $env:USERPROFILE\.claude\scripts\on-repo-dep-todo-complete.ps1
# Idempotent - safe to run multiple times.
#
# Usage:
#   .\install.ps1              # interactive: configure repos + install hook
#   .\install.ps1 add          # add a repo to config
#   .\install.ps1 remove       # remove a repo from config
#   .\install.ps1 list         # list configured repos
#   .\install.ps1 -HooksOnly   # install/update hook without interactive config UI
#   .\install.ps1 -Uninstall   # remove hook from settings.json (config preserved)

param(
    [Parameter(Position = 0)]
    [string]$Command = "",
    [switch]$Uninstall,
    [switch]$HooksOnly
)

$ErrorActionPreference = "Stop"

$SkillDir     = Split-Path -Parent $MyInvocation.MyCommand.Path
$HooksDir     = Join-Path $SkillDir "hooks"
$ScriptsDir   = "$env:USERPROFILE\.claude\scripts"
$SettingsFile = "$env:USERPROFILE\.claude\settings.json"
$ConfigFile   = "$env:USERPROFILE\.claude\repo-dependency-config.json"
$SidecarFile  = "$env:USERPROFILE\.claude\repo-dependency-skill-path.txt"
$HookSrc      = Join-Path $HooksDir "on-todo-complete.ps1"
$HookDst      = Join-Path $ScriptsDir "on-repo-dep-todo-complete.ps1"
$HookMatcher  = "TodoWrite"

function Write-Ok   { param($m) Write-Host "  [OK]   $m" -ForegroundColor Green }
function Write-Skip { param($m) Write-Host "  [SKIP] $m" -ForegroundColor Yellow }
function Write-Info { param($m) Write-Host "  [INFO] $m" -ForegroundColor Cyan }
function Write-Fail { param($m) Write-Host "  [FAIL] $m" -ForegroundColor Red }

# ── CONFIG HELPERS ─────────────────────────────────────────────────────────────

function Get-RepoConfig {
    if (Test-Path $ConfigFile) {
        try { return Get-Content $ConfigFile -Raw | ConvertFrom-Json } catch {}
    }
    return [PSCustomObject]@{
        repositories      = @()
        trackDependencies = [PSCustomObject]@{
            npm             = $true
            maven           = $true
            docker          = $true
            envVars         = $true
            apiSchemas      = $true
            typeDefinitions = $true
        }
        ignorePatterns = @("**/node_modules/**","**/target/**","**/.git/**","**/dist/**","**/build/**")
    }
}

function Save-RepoConfig($cfg) {
    $cfg | ConvertTo-Json -Depth 10 | Set-Content $ConfigFile -Encoding UTF8
}

function Show-RepoList($cfg) {
    if ($cfg.repositories.Count -eq 0) {
        Write-Host "  (no repositories configured)" -ForegroundColor DarkGray
        return
    }
    Write-Host ""
    Write-Host ("  {0,-4} {1,-25} {2,-10} {3}" -f "#", "Name", "Type", "Path") -ForegroundColor Cyan
    Write-Host ("  {0,-4} {1,-25} {2,-10} {3}" -f "---", "----", "----", "----") -ForegroundColor DarkGray
    for ($i = 0; $i -lt $cfg.repositories.Count; $i++) {
        $r = $cfg.repositories[$i]
        $exists = if (Test-Path $r.path) { "" } else { " [missing]" }
        Write-Host ("  {0,-4} {1,-25} {2,-10} {3}{4}" -f ($i + 1), $r.name, $r.type, $r.path, $exists)
    }
    Write-Host ""
}

function Add-Repo($cfg) {
    Write-Host ""
    $rawPath = Read-Host "  Enter absolute path to repository"
    if (-not $rawPath.Trim()) { Write-Info "Cancelled."; return $cfg }

    $normPath = [System.IO.Path]::GetFullPath($rawPath.Trim()).TrimEnd('\', '/')

    # Check duplicate
    $dup = $cfg.repositories | Where-Object {
        $_.path.TrimEnd('\', '/') -eq $normPath
    }
    if ($dup) {
        Write-Skip "Repository at this path is already configured: $($dup.name)"
        return $cfg
    }

    # Existence check
    if (-not (Test-Path $normPath)) {
        Write-Host "  [WARN] Path does not exist: $normPath" -ForegroundColor Yellow
        $ans = Read-Host "  Add anyway? [y/N]"
        if ($ans -notmatch '^[yY]') { Write-Info "Skipped."; return $cfg }
    }

    $autoName = Split-Path $normPath -Leaf

    # Auto-detect type
    $repoType = "unknown"
    if (Test-Path (Join-Path $normPath "docker-compose.yml")) { $repoType = "orchestration" }
    elseif (Test-Path (Join-Path $normPath "pom.xml"))        { $repoType = "java" }
    elseif (Test-Path (Join-Path $normPath "package.json"))   { $repoType = "node" }

    $newRepo = [PSCustomObject]@{ name = $autoName; path = $normPath; type = $repoType }
    $cfg.repositories = @($cfg.repositories) + @($newRepo)

    Write-Ok "Added: $autoName ($normPath) [$repoType]"
    return $cfg
}

function Remove-Repo($cfg) {
    if ($cfg.repositories.Count -eq 0) {
        Write-Info "No repositories configured."
        return $cfg
    }
    Show-RepoList $cfg
    $ans = Read-Host "  Enter number to remove (0 to cancel)"
    $idx = 0
    if (-not [int]::TryParse($ans, [ref]$idx) -or $idx -lt 1 -or $idx -gt $cfg.repositories.Count) {
        Write-Info "Cancelled."
        return $cfg
    }
    $removed = $cfg.repositories[$idx - 1]
    $cfg.repositories = @($cfg.repositories | Where-Object { $_ -ne $removed })
    Write-Ok "Removed: $($removed.name)"
    return $cfg
}

function Edit-DependencyTypes($cfg) {
    $keys = @('npm','maven','docker','envVars','apiSchemas','typeDefinitions')
    while ($true) {
        Write-Host ""
        Write-Host "  Dependency Types  (enabled = [x])" -ForegroundColor Cyan
        Write-Host ("  " + ("─" * 35)) -ForegroundColor DarkGray
        for ($i = 0; $i -lt $keys.Count; $i++) {
            $k = $keys[$i]
            $state = if ($cfg.trackDependencies.$k) { '[x]' } else { '[ ]' }
            Write-Host ("  [{0}] {1,-20} {2}" -f ($i + 1), $k, $state)
        }
        Write-Host ""
        $ans = Read-Host "  Enter number to toggle (Enter to go back)"
        if (-not $ans.Trim()) { return $cfg }
        $n = 0
        if ([int]::TryParse($ans.Trim(), [ref]$n) -and $n -ge 1 -and $n -le $keys.Count) {
            $k = $keys[$n - 1]
            $cfg.trackDependencies.$k = -not $cfg.trackDependencies.$k
            Save-RepoConfig $cfg
            Write-Ok "$k is now $(if ($cfg.trackDependencies.$k) { 'enabled' } else { 'disabled' })"
        } else {
            Write-Info "Invalid choice."
        }
    }
}

function Edit-IgnorePatterns($cfg) {
    while ($true) {
        Write-Host ""
        Write-Host "  Ignore Patterns" -ForegroundColor Cyan
        Write-Host ("  " + ("─" * 35)) -ForegroundColor DarkGray
        if ($cfg.ignorePatterns.Count -eq 0) {
            Write-Host "  (none)" -ForegroundColor DarkGray
        } else {
            for ($i = 0; $i -lt $cfg.ignorePatterns.Count; $i++) {
                Write-Host ("  {0,-4} {1}" -f ($i + 1), $cfg.ignorePatterns[$i])
            }
        }
        Write-Host ""
        Write-Host "    [A] Add pattern   [R] Remove by number   [B] Back"
        Write-Host ""
        $choice = Read-Host "  Enter choice"
        switch ($choice.Trim().ToUpper()) {
            'A' {
                $pat = Read-Host "  Enter glob pattern"
                if ($pat.Trim()) {
                    $cfg.ignorePatterns = @($cfg.ignorePatterns) + @($pat.Trim())
                    Save-RepoConfig $cfg
                    Write-Ok "Added: $($pat.Trim())"
                }
            }
            'R' {
                $ans = Read-Host "  Enter number to remove (0 to cancel)"
                $n = 0
                if ([int]::TryParse($ans, [ref]$n) -and $n -ge 1 -and $n -le $cfg.ignorePatterns.Count) {
                    $removed = $cfg.ignorePatterns[$n - 1]
                    # Remove exactly the entry at index n-1 (handles duplicates correctly)
                    $newList = [System.Collections.Generic.List[string]]::new()
                    for ($j = 0; $j -lt $cfg.ignorePatterns.Count; $j++) {
                        if ($j -ne ($n - 1)) { $newList.Add($cfg.ignorePatterns[$j]) }
                    }
                    $cfg.ignorePatterns = @($newList)
                    Save-RepoConfig $cfg
                    Write-Ok "Removed: $removed"
                } else {
                    Write-Info "Cancelled."
                }
            }
            'B' { return $cfg }
            default { Write-Info "Enter A, R, or B." }
        }
    }
}

function Invoke-RepoConfigUI($cfg) {
    while ($true) {
        Write-Host ""
        Write-Host "  Repo Dependency Analysis - Configuration" -ForegroundColor Magenta
        Write-Host ("  " + ("─" * 50)) -ForegroundColor DarkGray
        Write-Host "  Repositories: $($cfg.repositories.Count)   Dep types enabled: $(($cfg.trackDependencies.PSObject.Properties | Where-Object { $_.Value }).Count)/6   Ignore patterns: $($cfg.ignorePatterns.Count)"
        Write-Host ""
        Write-Host "    [A] Add a repository"
        Write-Host "    [R] Remove a repository"
        Write-Host "    [L] List repositories"
        Write-Host "    [T] Configure dependency types"
        Write-Host "    [I] Configure ignore patterns"
        Write-Host "    [D] Done"
        Write-Host ""
        $choice = Read-Host "  Enter choice"

        switch ($choice.Trim().ToUpper()) {
            'A' { $cfg = Add-Repo $cfg; Save-RepoConfig $cfg }
            'R' { $cfg = Remove-Repo $cfg; Save-RepoConfig $cfg }
            'L' { Show-RepoList $cfg }
            'T' { $cfg = Edit-DependencyTypes $cfg }
            'I' { $cfg = Edit-IgnorePatterns $cfg }
            'D' { return $cfg }
            default { Write-Info "Unknown choice. Enter A, R, L, T, I, or D." }
        }
    }
}

# ── UNINSTALL ─────────────────────────────────────────────────────────────────

if ($Uninstall) {
    Write-Host ""
    Write-Host "  repo-dependency-analysis uninstaller" -ForegroundColor Magenta
    Write-Host "  ─────────────────────────────────────" -ForegroundColor DarkGray
    Write-Host ""

    # Remove hook script
    if (Test-Path $HookDst) {
        Remove-Item $HookDst -Force
        Write-Ok "Removed $HookDst"
    } else {
        Write-Skip "Hook script not found"
    }

    # Remove sidecar
    if (Test-Path $SidecarFile) {
        Remove-Item $SidecarFile -Force
        Write-Ok "Removed skill-path sidecar"
    }

    # Remove only our TodoWrite entry from settings.json (leave others intact)
    if (Test-Path $SettingsFile) {
        $settings = Get-Content $SettingsFile -Raw | ConvertFrom-Json
        if ($settings.PSObject.Properties["hooks"] -and $settings.hooks.PSObject.Properties["PostToolUse"]) {
            $before = $settings.hooks.PostToolUse.Count
            $settings.hooks.PostToolUse = @($settings.hooks.PostToolUse | Where-Object {
                -not ($_.matcher -eq $HookMatcher -and
                      ($_.hooks | Where-Object { $_.command -like "*on-repo-dep-todo-complete*" }))
            })
            if ($settings.hooks.PostToolUse.Count -lt $before) {
                $settings | ConvertTo-Json -Depth 10 | Set-Content $SettingsFile -Encoding UTF8
                Write-Ok "Removed hook entry from settings.json"
            } else {
                Write-Skip "Hook entry not found in settings.json"
            }
        }
    }

    Write-Host ""
    Write-Ok "Uninstall complete. Config preserved at: $ConfigFile"
    Write-Host ""
    exit 0
}

# ── SUBCOMMANDS ───────────────────────────────────────────────────────────────

switch ($Command.ToLower()) {
    "add" {
        Write-Host ""
        Write-Host "  repo-dependency-analysis - Add Repository" -ForegroundColor Magenta
        Write-Host ""
        $cfg = Get-RepoConfig
        $cfg = Add-Repo $cfg
        Save-RepoConfig $cfg
        Write-Host ""
        Write-Info "Run '.\install.ps1' to (re)install the hook after config changes."
        Write-Host ""
        exit 0
    }
    "remove" {
        Write-Host ""
        Write-Host "  repo-dependency-analysis - Remove Repository" -ForegroundColor Magenta
        Write-Host ""
        $cfg = Get-RepoConfig
        $cfg = Remove-Repo $cfg
        Save-RepoConfig $cfg
        Write-Host ""
        exit 0
    }
    "list" {
        Write-Host ""
        Write-Host "  repo-dependency-analysis - Configured Repositories" -ForegroundColor Magenta
        $cfg = Get-RepoConfig
        Show-RepoList $cfg
        exit 0
    }
}

# ── FULL INSTALL ──────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "  repo-dependency-analysis installer$(if ($HooksOnly) { ' (hooks only)' })" -ForegroundColor Magenta
Write-Host ("  " + ("─" * 37)) -ForegroundColor DarkGray
Write-Host ""

# Step 1: Configure repos interactively (skipped when -HooksOnly)
$cfg = Get-RepoConfig
if (-not $HooksOnly) {
    $cfg = Invoke-RepoConfigUI $cfg
    Save-RepoConfig $cfg
    Write-Ok "Configuration saved to: $ConfigFile"
} else {
    Write-Info "Skipping interactive config (using existing config at: $ConfigFile)"
}

# Step 2: Copy hook script
if (-not (Test-Path $ScriptsDir)) {
    New-Item -ItemType Directory -Path $ScriptsDir -Force | Out-Null
    Write-Info "Created $ScriptsDir"
}

if (-not (Test-Path $HookSrc)) {
    Write-Fail "Hook source not found: $HookSrc"
    exit 1
}

Copy-Item $HookSrc $HookDst -Force
Write-Ok "Copied hook -> $HookDst"

# Step 3: Write skill-path sidecar
$SkillDir | Set-Content $SidecarFile -Encoding UTF8
Write-Ok "Skill path sidecar written"

# Step 4: Patch settings.json
if (-not (Test-Path $SettingsFile)) {
    Write-Info "settings.json not found - creating"
    [PSCustomObject]@{ hooks = [PSCustomObject]@{ PostToolUse = @() } } |
        ConvertTo-Json -Depth 10 | Set-Content $SettingsFile -Encoding UTF8
}

$settings = Get-Content $SettingsFile -Raw | ConvertFrom-Json

if (-not $settings.PSObject.Properties["hooks"]) {
    $settings | Add-Member -NotePropertyName "hooks" -NotePropertyValue ([PSCustomObject]@{})
}
if (-not $settings.hooks.PSObject.Properties["PostToolUse"]) {
    $settings.hooks | Add-Member -NotePropertyName "PostToolUse" -NotePropertyValue @()
}

$existing = @($settings.hooks.PostToolUse | Where-Object {
    $_.matcher -eq $HookMatcher -and
    ($_.hooks | Where-Object { $_.command -like "*on-repo-dep-todo-complete*" })
})

if ($existing.Count -gt 0) {
    $existing[0].hooks[0].command = "pwsh -NonInteractive -File $HookDst"
    Write-Skip "TodoWrite hook already present - updated command path"
} else {
    $entry = [PSCustomObject]@{
        matcher = $HookMatcher
        hooks   = @([PSCustomObject]@{
            type    = "command"
            command = "pwsh -NonInteractive -File $HookDst"
        })
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

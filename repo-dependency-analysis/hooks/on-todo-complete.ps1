# PostToolUse hook: TodoWrite
# Fires when all todos complete in a session whose cwd matches a configured repo.
# Captures git diff snapshot and spawns a background sub-agent to run cross-repo analysis.

$raw = [Console]::In.ReadToEnd()
if (-not $raw.Trim()) { exit 0 }

try { $data = $raw | ConvertFrom-Json } catch { exit 0 }

$todos = $data.tool_input.todos
if (-not $todos -or $todos.Count -eq 0) { exit 0 }

# Gate 1: all todos must be completed
$pending = @($todos | Where-Object { $_.status -ne 'completed' })
if ($pending.Count -gt 0) { exit 0 }

$cwd = if ($data.cwd) { $data.cwd } else { (Get-Location).Path }

# Gate 2: config must exist and have at least one repo
$configFile = "$env:USERPROFILE\.claude\repo-dependency-config.json"
if (-not (Test-Path $configFile)) { exit 0 }

try {
    $config = Get-Content $configFile -Raw | ConvertFrom-Json
} catch { exit 0 }

if (-not $config.repositories -or $config.repositories.Count -eq 0) { exit 0 }

# Gate 3: cwd must be under a configured repo
$cwdNorm = $cwd.TrimEnd('\', '/')
$matchedRepo = $config.repositories | Where-Object {
    $repoNorm = $_.path.TrimEnd('\', '/')
    $cwdNorm -eq $repoNorm -or
    $cwdNorm.StartsWith($repoNorm + '\') -or
    $cwdNorm.StartsWith($repoNorm + '/')
} | Select-Object -First 1

if (-not $matchedRepo) { exit 0 }

# Gate 4: 30-minute debounce per repo
$safeKey = $cwdNorm -replace '[:\\/]', '-'
$debounceFile = Join-Path $env:TEMP "claude-repo-dep-todo-$safeKey.txt"
if (Test-Path $debounceFile) {
    try {
        $lastRun = [datetime](Get-Content $debounceFile -Raw).Trim()
        if ((Get-Date) - $lastRun -lt [timespan]::FromMinutes(30)) { exit 0 }
    } catch {}
}
(Get-Date -Format 'o') | Set-Content $debounceFile -Encoding UTF8

# Capture git diff snapshot
$changedFiles  = @(git -C $cwd diff --name-only HEAD 2>$null)
$stagedFiles   = @(git -C $cwd diff --name-only --cached 2>$null)
$allChanged    = @($changedFiles + $stagedFiles | Sort-Object -Unique | Where-Object { $_ })
$rawDiffLines  = @(git -C $cwd diff HEAD --unified=3 2>$null | Select-Object -First 2000)
$rawDiff       = $rawDiffLines -join "`n"

$snapshotPath = Join-Path $env:TEMP "claude-repo-dep-diff-$safeKey.json"
$snapshot = [PSCustomObject]@{
    repo         = $matchedRepo.name
    repoPath     = $matchedRepo.path
    changedFiles = $allChanged
    rawDiff      = $rawDiff
    capturedAt   = (Get-Date -Format 'o')
}
$snapshot | ConvertTo-Json -Depth 5 | Set-Content $snapshotPath -Encoding UTF8

# Resolve skill dir from sidecar
$sidecarFile = "$env:USERPROFILE\.claude\repo-dependency-skill-path.txt"
if (-not (Test-Path $sidecarFile)) { exit 0 }
$skillDir = (Get-Content $sidecarFile -Raw).Trim()
$detectScript = Join-Path $skillDir 'scripts\detect-ripple-effects.js'
if (-not (Test-Path $detectScript)) { exit 0 }

# Build sub-agent prompt
$repoName     = $matchedRepo.name
$cwdSafe      = $cwd      -replace "'", "''"
$repoNameSafe = $repoName -replace "'", "''"
$snapshotSafe = $snapshotPath -replace "'", "''"
$fileList     = ($allChanged | Select-Object -First 20) -join ', '
if (-not $fileList) { $fileList = '(no uncommitted changes - checking recent commits)' }

$prompt = "All todos are complete in the '$repoNameSafe' repository. Changed files: $fileList. A full diff snapshot is at '$snapshotSafe'. Run /repo-dependency-analysis to check for ripple effects in all other configured repositories. Use the diff snapshot to produce targeted impact analysis. Report any CRITICAL or WARNING impacts immediately."

$logFile = Join-Path $env:TEMP 'claude-repo-dep-analysis.log'

Start-Process -FilePath 'pwsh' `
    -ArgumentList @(
        '-NonInteractive',
        '-Command',
        "Set-Location '$cwdSafe'; claude --dangerously-skip-permissions --print -p '$prompt' 2>&1 | Out-File -FilePath '$logFile' -Encoding utf8"
    ) `
    -WindowStyle Hidden

exit 0

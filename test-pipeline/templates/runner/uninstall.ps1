<#
Remove the pipeline.

  .\uninstall.ps1                  # remove the scheduled tasks only
  .\uninstall.ps1 -RemoveScripts   # also delete the scaffolded scripts
  .\uninstall.ps1 -RemoveHistory   # also delete the recorded history (asks twice)

Tasks come out cleanly and can be re-registered in seconds. The history cannot: it is one line per
run accumulated over the pipeline's whole life, it is what every report is built from, and nothing
can reconstruct it. So it is opt-in, confirmed separately, and never bundled into a broader flag.
#>
param(
    [string]$Config = 'pipeline.config.json',
    [switch]$RemoveScripts,
    [switch]$RemoveHistory,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..' '..')).Path
Set-Location $RepoRoot

if (-not (Test-Path $Config)) { Write-Host "[uninstall] no config at $Config"; exit 1 }
$cfg = Get-Content $Config -Raw | ConvertFrom-Json
$prefix = if ($cfg.taskPrefix) { $cfg.taskPrefix } else { 'TestPipeline' }

# Say exactly what will happen before anything happens. An uninstall that surprises someone is the
# one that takes data with it.
Write-Host ''
Write-Host 'This will remove:'
foreach ($e in $cfg.environments) {
    $n = "$prefix-$($e.name)"
    $exists = [bool](Get-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue)
    Write-Host ("  scheduled task  {0,-34} {1}" -f $n, $(if ($exists) { '' } else { '(not registered)' }))
}
if ($RemoveScripts) { Write-Host "  directory       $($cfg.pipelineDir)  (scaffolded scripts)" }
if ($RemoveHistory) { Write-Host "  HISTORY         $($cfg.runsDir)/history.jsonl  - NOT RECOVERABLE" -ForegroundColor Yellow }
Write-Host ''
Write-Host 'This will be kept:'
if (-not $RemoveScripts) { Write-Host "  $($cfg.pipelineDir)  (scripts)" }
if (-not $RemoveHistory) { Write-Host "  $($cfg.runsDir)/history.jsonl  (the recorded history)" }
Write-Host "  $Config"
Write-Host ''

if (-not $Force) {
    $a = Read-Host 'Proceed? (yes/no)'
    if ($a -ne 'yes') { Write-Host '[uninstall] cancelled'; exit 0 }
}

foreach ($e in $cfg.environments) {
    $n = "$prefix-$($e.name)"
    if (Get-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $n -Confirm:$false
        Write-Host "[uninstall] removed task $n"
    }
}

if ($RemoveHistory) {
    # Deliberately a second prompt with a distinct answer, even under -Force. -Force is there to let
    # someone script the task removal, not to let them delete months of history without noticing.
    $h = Join-Path $cfg.runsDir 'history.jsonl'
    if (Test-Path $h) {
        $lines = (Get-Content $h | Measure-Object -Line).Lines
        $a = Read-Host "Really delete $lines recorded run(s)? This cannot be undone. Type DELETE to confirm"
        if ($a -ceq 'DELETE') {
            Remove-Item $h -Force
            Write-Host '[uninstall] history deleted'
        } else {
            Write-Host '[uninstall] history KEPT'
        }
    }
}

if ($RemoveScripts) {
    if (Test-Path $cfg.pipelineDir) {
        # Everything under runsDir that is not history is reproducible, but if runsDir sits inside
        # pipelineDir a blanket delete would take the history with it. Move it aside first.
        $h = Join-Path $cfg.runsDir 'history.jsonl'
        $keep = (Test-Path $h) -and -not $RemoveHistory
        if ($keep) {
            $stash = Join-Path $RepoRoot 'history.jsonl.kept'
            Copy-Item $h $stash -Force
            Write-Host "[uninstall] history preserved at $stash"
        }
        Remove-Item $cfg.pipelineDir -Recurse -Force
        Write-Host "[uninstall] removed $($cfg.pipelineDir)"
    }
}

Write-Host ''
Write-Host '[uninstall] done. Re-install with: /test-pipeline init'

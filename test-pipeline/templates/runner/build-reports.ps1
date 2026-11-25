# Thin wrapper. All report-selection logic lives in build-all.mjs so the Windows and POSIX paths
# cannot drift into building different sets.
param([string]$Config = 'pipeline.config.json', [string]$Environment)
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..' '..')).Path
Set-Location $RepoRoot
$cfg = Get-Content $Config -Raw | ConvertFrom-Json
$a = @((Join-Path $cfg.pipelineDir 'reports/build-all.mjs'), '--config', $Config)
if ($Environment) { $a += @('--env', $Environment) }
& node @a
exit $LASTEXITCODE

<#
One scheduled run of the suite against ONE environment, then - if this run wins the claim - the
reports for the whole cycle.

  .\run-cycle.ps1 -Environment qc2 [-Config pipeline.config.json] [-NoReports]

Pause the schedule by writing an ISO timestamp into <runsDir>/hold-until.txt; firings before it are
skipped and logged, and the file clears itself once the time passes. Preferred over disabling the
task, because a disabled task needs a human to remember to switch it back on.
#>
param(
    [Parameter(Mandatory)][string]$Environment,
    [string]$Config = 'pipeline.config.json',
    [switch]$NoReports
)

$ErrorActionPreference = 'Continue'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..' '..')).Path
Set-Location $RepoRoot
. (Join-Path $PSScriptRoot 'cycle.ps1')

if (-not (Test-Path $Config)) { Write-Host "[run] no config at $Config"; exit 1 }
$cfg = Get-Content $Config -Raw | ConvertFrom-Json

$envCfg = $cfg.environments | Where-Object { $_.name -eq $Environment } | Select-Object -First 1
if (-not $envCfg) {
    Write-Host "[run] '$Environment' is not in the config. Known: $(($cfg.environments.name) -join ', ')"
    exit 1
}
if ($envCfg.enabled -eq $false) {
    Write-Host "[run] '$Environment' is disabled in the config - set enabled=true to run it"
    exit 0
}

$runsDir = $cfg.runsDir
$logDir  = Join-Path $runsDir 'logs'
New-Item -ItemType Directory -Force $runsDir, $logDir | Out-Null

$runId   = Get-Date -Format 'yyyy-MM-ddTHH-mm-ss'
# The cycle is only the ENABLED environments. Waiting on a disabled one would burn the full
# timeout every hour for a run that is never scheduled. `enabled` absent means true, so an older
# config keeps working unchanged.
$slots   = @($cfg.environments | Where-Object { $_.enabled -ne $false } | ForEach-Object { $_.name })
$lock    = Join-Path $runsDir ".running-$Environment"
$skipLog = Join-Path $runsDir 'skipped.log'

# A skipped slot is recorded HERE and nowhere else.
#
# It must never reach history.jsonl: a non-run and a failed run mean opposite things, and every
# report is only readable if the two stay apart. A skip recorded as a failure makes an environment
# outage look like a product regression, forever, in every chart built from it.
function Write-Skip([string]$why) {
    "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $runId  $Environment  SKIPPED - $why" | Add-Content $skipLog
    Write-Host "[run] skipped - $why"
    # Mark the cycle too, or every other environment waits the full timeout for a run that is
    # never coming.
    try { Write-CycleMarker -Slot $Environment -Status 'skipped' -RunsDir $runsDir | Out-Null } catch { }
}

# ---- Gate A: hold ----------------------------------------------------------
# Checked before the probe: if the schedule is paused there is no reason to poke the environment,
# and "held" is a more useful thing to find in the log than "unreachable", which would suggest an
# outage when the truth is that somebody wanted the slot.
$holdFile = Join-Path $runsDir 'hold-until.txt'
if (Test-Path $holdFile) {
    $raw = (Get-Content $holdFile -First 1)
    $until = $null
    # TryParse's [ref] overload cannot bind $null in PowerShell, so this is a try/catch rather than
    # the obvious one-liner.
    try { $until = [datetime]::Parse($raw.Trim()) } catch { Write-Host "[run] unparseable hold-until.txt ('$raw') - ignoring" }
    if ($until -and (Get-Date) -lt $until) {
        $mins = [int]($until - (Get-Date)).TotalMinutes
        Write-Skip "held until $($until.ToString('yyyy-MM-dd HH:mm')) - ${mins}m remaining"
        exit 0
    }
    if ($until) { Remove-Item $holdFile -Force -ErrorAction SilentlyContinue }
}

# ---- Gate B: is the environment actually up? -------------------------------
# Skipping beats recording a wipeout. A run against a dead environment produces a full red result
# that means nothing, and it pollutes every average built from the history afterwards.
#
# Retried, not single-shot. First contact with a host can fail while a VPN or zero-trust tunnel
# establishes its route - the connection is refused or the TLS handshake dies, and a second attempt
# moments later succeeds. Observed on three environments that were individually reachable but had
# not been touched since the tunnel came up. A single-shot probe turns that into a skipped run
# every time the machine wakes, which looks exactly like an outage in the skip log and is far more
# annoying to diagnose than the few seconds the retries cost.
function Test-EnvironmentUp($probe, $baseUrl) {
    if (-not $probe -or $probe.kind -eq 'none') { return $true }
    $timeout  = if ($probe.timeoutSeconds) { $probe.timeoutSeconds } else { 20 }
    $attempts = if ($probe.attempts) { [int]$probe.attempts } else { 3 }
    $gap      = if ($probe.retryGapSeconds) { [int]$probe.retryGapSeconds } else { 3 }

    for ($i = 1; $i -le $attempts; $i++) {
        $ok = $false
        $why = ''

        if ($probe.kind -eq 'tcp') {
            try {
                $u = [uri]$baseUrl
                $port = if ($u.Port -gt 0) { $u.Port } else { if ($u.Scheme -eq 'https') { 443 } else { 80 } }
                $c = [System.Net.Sockets.TcpClient]::new()
                $ok = $c.ConnectAsync($u.Host, $port).Wait($timeout * 1000)
                $c.Dispose()
                if (-not $ok) { $why = 'connect timed out' }
            } catch { $why = $_.Exception.Message.Split([char]10)[0] }
        } else {
            # http. Deliberately stricter than a TCP connect: an environment that is down often
            # still accepts connections and answers 503 to everything, which a TCP probe reads as
            # healthy and which then produces an entire red run that means nothing.
            try {
                $path = if ($probe.path) { $probe.path } else { '/' }
                $url = ($baseUrl.TrimEnd('/')) + $path
                $expect = if ($probe.expectStatus) { $probe.expectStatus } else { 200 }
                $r = Invoke-WebRequest -Uri $url -Method GET -TimeoutSec $timeout -SkipCertificateCheck -SkipHttpErrorCheck -ErrorAction Stop
                $ok = ([int]$r.StatusCode -eq [int]$expect)
                if (-not $ok) { $why = "returned $([int]$r.StatusCode), expected $expect" }
            } catch { $why = $_.Exception.Message.Split([char]10)[0] }
        }

        if ($ok) {
            if ($i -gt 1) { Write-Host "[run] probe succeeded on attempt $i" }
            return $true
        }
        # A real status code is the environment answering and declining. Retrying will not change
        # its mind, so only transport-level failures are worth another attempt.
        if ($why -match 'returned \d+, expected') { Write-Host "[run] probe $why"; return $false }
        if ($i -lt $attempts) { Start-Sleep -Seconds $gap }
        else { Write-Host "[run] probe failed after $attempts attempt(s): $why" }
    }
    return $false
}

# CI intake: an environment with source=ci reads finished pipeline runs instead of running the suite.
# There is no environment of ours to probe, so Gate B does not apply.
$isCi = ($envCfg.source -eq 'ci')

if (-not $isCi -and -not (Test-EnvironmentUp $envCfg.probe $envCfg.baseUrl)) {
    Write-Skip "$Environment is not answering its health probe"
    exit 0
}

# ---- Gate C: is a previous run of THIS environment still going? ------------
# The lock is per environment, not global. A single shared lock would mean the second environment
# is skipped outright with "previous run still going", so "run both" silently becomes "run one".
if (Test-Path $lock) {
    $owner = (Get-Content $lock -First 1)
    $ownerPid = if ($owner -match '\s(\d+)\s*$') { [int]$Matches[1] } else { 0 }
    $alive = $false
    if ($ownerPid) {
        $p = Get-Process -Id $ownerPid -ErrorAction SilentlyContinue
        $alive = $p -and $p.ProcessName -in @('pwsh', 'powershell')
    }
    if ($alive) { Write-Skip "previous run still going (pid $ownerPid)"; exit 0 }
    Write-Host "[run] clearing stale lock from pid $ownerPid"
    Remove-Item $lock -Force -ErrorAction SilentlyContinue
}
Set-Content $lock "$runId $PID"

$log = Join-Path $logDir "run-$runId-$Environment.log"
$startedAt = (Get-Date).ToString('o')

try {
  if ($isCi) {
    # ---- CI intake: poll the provider, record any new completed run ----------
    # Exit 0 = ingested, 10 = nothing new, 3 = could not poll. The latter two are skips, never
    # history records (same invariant as a local skip). The token comes from an environment
    # variable named in the config and is never passed on a command line.
    & node (Join-Path $cfg.pipelineDir 'ingest/ci-intake.mjs') --config $Config --environment $Environment
    if ($LASTEXITCODE -eq 10) { Write-Skip 'no new completed CI run'; exit 0 }
    if ($LASTEXITCODE -ne 0)  { Write-Skip "CI poll failed (exit $LASTEXITCODE)"; exit 0 }
  } else {
    # ---- Run the suite -----------------------------------------------------
    if ($envCfg.baseUrl) { $env:BASE_URL = $envCfg.baseUrl }
    $env:TEST_ENV = $Environment
    if ($envCfg.env) {
        foreach ($p in $envCfg.env.PSObject.Properties) {
            Set-Item -Path "Env:$($p.Name)" -Value ($p.Value -replace '\{baseUrl\}', $envCfg.baseUrl)
        }
    }

    $cmd = $cfg.runner.command -replace '\{env\}', $Environment -replace '\{baseUrl\}', $envCfg.baseUrl
    Write-Host "[run] $Environment : $cmd"
    # Exit code is deliberately not consulted: a suite with failing tests exits non-zero and that
    # is a perfectly good run. Pass/fail is derived from the results file, the only source that can
    # tell "3 tests failed" apart from "the runner could not start".
    & pwsh -NoProfile -Command $cmd *>&1 | Tee-Object -FilePath $log | Out-Null

    $finishedAt = (Get-Date).ToString('o')

    # ---- Record ------------------------------------------------------------
    $collectArgs = @(
        (Join-Path $cfg.pipelineDir 'ingest/collect-run.mjs'),
        '--config', $Config, '--run-id', $runId, '--env', $Environment,
        '--started', $startedAt, '--finished', $finishedAt
    )
    if ($envCfg.baseUrl) { $collectArgs += @('--base-url', $envCfg.baseUrl) }
    & node @collectArgs
    if ($LASTEXITCODE -ne 0) {
        # No readable results means we do not know what happened, and a fabricated zero-row record
        # would enter the history as a real datapoint. Record a skip instead.
        Write-Skip "results could not be read (collect exit $LASTEXITCODE)"
        exit 0
    }
  }

    # ---- Rendezvous --------------------------------------------------------
    Write-CycleMarker -Slot $Environment -Status 'ran' -RunId $runId -RunsDir $runsDir | Out-Null
    if ($NoReports) { Write-Host '[run] -NoReports, done'; exit 0 }

    $complete = Wait-ForCycle -Slots $slots -TimeoutMinutes $cfg.schedule.cycleWaitMinutes -RunsDir $runsDir
    if (-not (Claim-CycleReport -RunsDir $runsDir)) {
        Write-Host "[cycle] $(Get-CycleId) already claimed by another environment - not reporting here"
        exit 0
    }
    $runIds = @(Get-CycleRunIds -Slots $slots -RunsDir $runsDir)
    Write-Host "[cycle] $(Get-CycleId) claimed - reporting for: $($runIds -join ', ')$(if (-not $complete) { ' (incomplete)' })"

    # ---- Reports -----------------------------------------------------------
    # A second, coarser guard on top of the claim. The claim stops two environments of THIS cycle
    # racing; the mutex also covers a hand-run report happening at the same moment. Named per
    # checkout so unrelated clones on the same host do not block each other, and released
    # automatically if the process dies.
    $mutex = [System.Threading.Mutex]::new($false, (Get-ReportMutexName $RepoRoot))
    $held = $false
    try { $held = $mutex.WaitOne([TimeSpan]::FromMinutes(10)) } catch { $held = $true }
    if (-not $held) { Write-Host '[reports] waited 10 min for another writer - generating anyway' }
    try {
        & pwsh -NoProfile -File (Join-Path $PSScriptRoot 'build-reports.ps1') -Config $Config
    } finally {
        if ($held) { $mutex.ReleaseMutex() }
        $mutex.Dispose()
    }

    Remove-OldCycleMarkers -RunsDir $runsDir
}
finally {
    Remove-Item $lock -Force -ErrorAction SilentlyContinue

    # Retention. The history file is never touched here: it is one line per run, it is what every
    # report is built from, and it cannot be regenerated. Logs are bulky and reproducible.
    $keepLogs = if ($cfg.retention.runLogs) { $cfg.retention.runLogs } else { 200 }
    Get-ChildItem $logDir -Filter 'run-*.log' -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -Skip $keepLogs |
        Remove-Item -Force -ErrorAction SilentlyContinue
}

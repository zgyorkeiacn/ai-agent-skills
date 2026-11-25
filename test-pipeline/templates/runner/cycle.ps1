<#
Cycle rendezvous: every environment finishes, then exactly ONE of them builds the reports.

WHY THIS EXISTS

Environments run concurrently on the same trigger. Left alone, each would regenerate the same
reports from the same shared history and each would write over the other - so one hour of testing
produces N sets of reports, minutes apart, each describing a different subset of the picture.

So each run drops a marker when its result is recorded, waits briefly for the others, and exactly
one run claims the reporting. The claim is an atomic file create rather than a lock-then-check,
because two runs can finish inside the same second and a "test then act" check would let both
through.

Dot-source this; it defines functions only.
#>

<#
.SYNOPSIS Identity for "this batch of runs".
.DESCRIPTION
  Environments share a trigger but are jittered and staggered, so two runs of the same batch start
  minutes apart but inside the same hour. Truncating to the hour is therefore the right grain.

  A run at :10 and another at :19 agree. A run at :59 would not pair with one at :01 the next hour,
  which is correct - those are different batches.
#>
function Get-CycleId([datetime]$when = (Get-Date)) {
    return $when.ToString('yyyy-MM-ddTHH')
}

<#
.SYNOPSIS The marker directory, as an ABSOLUTE path.
.DESCRIPTION
  Absolute on purpose. Claim-CycleReport calls [System.IO.File]::Open, and .NET resolves a relative
  path against the PROCESS working directory - which Set-Location does not change. With a relative
  path the claim file lands wherever the process happened to start; in a scheduled task that is the
  user profile, so the open throws DirectoryNotFound and the claim silently fails for every caller.

  The symptom is "no run ever reports", which is a long way from the cause.
#>
function Get-CycleDir([string]$RunsDir) {
    $d = Join-Path $RunsDir 'cycle'
    New-Item -ItemType Directory -Force -Path $d | Out-Null
    return (Convert-Path -LiteralPath $d)
}

<#
.SYNOPSIS Record that this environment is done with this cycle.
.DESCRIPTION
  Status is 'ran' or 'skipped'. Skipped matters as much as ran: if an environment is unreachable,
  held, or already running, it writes a marker anyway so the others stop waiting for it immediately
  instead of burning the full timeout. Without it, every skip on one environment delays every other
  environment's report by the whole wait window.

  Written to a temp name and moved into place, so a poller never reads a half-written marker.
#>
function Write-CycleMarker {
    param(
        [Parameter(Mandatory)][string]$Slot,
        [Parameter(Mandatory)][ValidateSet('ran', 'skipped')][string]$Status,
        [string]$RunId = '',
        [string]$CycleId = (Get-CycleId),
        [Parameter(Mandatory)][string]$RunsDir
    )
    $dir = Get-CycleDir $RunsDir
    $path = Join-Path $dir "$CycleId.$Slot.json"
    $tmp = "$path.tmp"
    $payload = [ordered]@{
        slot   = $Slot
        status = $Status
        runId  = $RunId
        at     = (Get-Date).ToString('o')
    } | ConvertTo-Json -Compress
    Set-Content -LiteralPath $tmp -Value $payload -Encoding UTF8
    Move-Item -LiteralPath $tmp -Destination $path -Force
    return $path
}

function Get-CycleMarkers {
    param([string]$CycleId = (Get-CycleId), [Parameter(Mandatory)][string]$RunsDir)
    $dir = Get-CycleDir $RunsDir
    Get-ChildItem -LiteralPath $dir -Filter "$CycleId.*.json" -ErrorAction SilentlyContinue |
        ForEach-Object {
            try { Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json } catch { }
        }
}

<#
.SYNOPSIS Wait until every listed environment has reported in, or the timeout passes.
.DESCRIPTION
  Returns $true when the cycle completed, $false on timeout. The caller reports either way - an
  incomplete cycle still deserves a report, it just gets labelled as one.
#>
function Wait-ForCycle {
    param(
        [Parameter(Mandatory)][string[]]$Slots,
        [int]$TimeoutMinutes = 20,
        [string]$CycleId = (Get-CycleId),
        [Parameter(Mandatory)][string]$RunsDir
    )
    $deadline = (Get-Date).AddMinutes($TimeoutMinutes)
    $announced = $false
    while ($true) {
        $have = @(Get-CycleMarkers -CycleId $CycleId -RunsDir $RunsDir | ForEach-Object { $_.slot })
        $missing = @($Slots | Where-Object { $_ -notin $have })
        if (-not $missing) { return $true }
        if ((Get-Date) -ge $deadline) {
            Write-Host "[cycle] timed out after $TimeoutMinutes min waiting for: $($missing -join ', ')"
            return $false
        }
        if (-not $announced) {
            Write-Host "[cycle] waiting for: $($missing -join ', ')"
            $announced = $true
        }
        Start-Sleep -Seconds 15
    }
}

<#
.SYNOPSIS Try to become the one run that reports for this cycle. Returns $true exactly once.
.DESCRIPTION
  FileMode.CreateNew throws when the file already exists - the throw IS the mutual exclusion. This
  is deliberately not Test-Path followed by a create: every environment can clear Wait-ForCycle in
  the same instant, and a check-then-act would let all of them through.
#>
function Claim-CycleReport {
    param([string]$CycleId = (Get-CycleId), [Parameter(Mandatory)][string]$RunsDir)
    $f = Join-Path (Get-CycleDir $RunsDir) "$CycleId.claimed"
    try {
        $fs = [System.IO.File]::Open(
            $f, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
        try {
            $w = [System.IO.StreamWriter]::new($fs)
            $w.Write("$PID $(Get-Date -Format 'o')")
            $w.Flush()
        } finally { $fs.Dispose() }
        return $true
    } catch { return $false }
}

<#
.SYNOPSIS Run ids for this cycle, in the order the slots were given.
.DESCRIPTION
  Only markers with status 'ran' and a non-empty runId contribute. A skipped environment completes
  the rendezvous but adds no run - it has no result to report on.
#>
function Get-CycleRunIds {
    param(
        [Parameter(Mandatory)][string[]]$Slots,
        [string]$CycleId = (Get-CycleId),
        [Parameter(Mandatory)][string]$RunsDir
    )
    $markers = @(Get-CycleMarkers -CycleId $CycleId -RunsDir $RunsDir)
    foreach ($s in $Slots) {
        $m = $markers | Where-Object { $_.slot -eq $s -and $_.status -eq 'ran' -and $_.runId } | Select-Object -First 1
        if ($m) { $m.runId }
    }
}

function Remove-OldCycleMarkers {
    param([int]$KeepFiles = 200, [Parameter(Mandatory)][string]$RunsDir)
    $dir = Get-CycleDir $RunsDir
    Get-ChildItem -LiteralPath $dir -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -Skip $KeepFiles |
        Remove-Item -Force -ErrorAction SilentlyContinue
}

<#
.SYNOPSIS A mutex name unique to this checkout.
.DESCRIPTION
  'Global\' names are machine-wide. A fixed name means two checkouts of this pipeline on one host
  serialise their reporting against each other for no reason at all - and the symptom is a ten
  minute unexplained stall, which nobody will attribute to a name collision.

  Hashing the repo path keeps the guard doing its real job (two environments of the SAME pipeline
  must not write reports concurrently) without reaching across unrelated checkouts.
#>
function Get-ReportMutexName([string]$RepoRoot) {
    $md5 = [System.Security.Cryptography.MD5]::Create()
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($RepoRoot.ToLowerInvariant())
    $hash = [System.BitConverter]::ToString($md5.ComputeHash($bytes)).Replace('-', '').Substring(0, 12)
    return "Global\test-pipeline-reports-$hash"
}

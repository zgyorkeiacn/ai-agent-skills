<#
Register (or remove, or report on) one Windows scheduled task PER ENVIRONMENT.

  .\install-schedule.ps1                 # register every enabled environment in the config
  .\install-schedule.ps1 -Status         # show what is registered and when it last ran
  .\install-schedule.ps1 -Remove         # unregister them all
  .\install-schedule.ps1 -Only qc2       # act on one environment

ONE TASK PER ENVIRONMENT, AND EACH IS PASSED ITS OWN NAME.

The obvious shortcut is a single task that runs the runner with no arguments and lets it use a
default. That shortcut cannot schedule a second environment at all, and the usual outcome is that
somebody registers the second task by hand - at which point it exists on one machine, is in
nobody's version control, and silently disappears the next time the schedule is reinstalled.
#>
param(
    [string]$Config = 'pipeline.config.json',
    [switch]$Remove,
    [switch]$Status,
    [string]$Only,
    [switch]$S4U
)

$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..' '..')).Path
Set-Location $RepoRoot

if (-not (Test-Path $Config)) { Write-Host "[schedule] no config at $Config"; exit 1 }
$cfg = Get-Content $Config -Raw | ConvertFrom-Json
$runner = Join-Path $RepoRoot (Join-Path $cfg.pipelineDir 'runner/run-cycle.ps1')

$prefix = if ($cfg.taskPrefix) { $cfg.taskPrefix } else { 'TestPipeline' }

# Disabled environments get no task. `enabled` absent means true, so an older config is unaffected.
$targets = @($cfg.environments | Where-Object { $_.enabled -ne $false -and (-not $Only -or $_.name -eq $Only) })
if (-not $targets) {
    if ($Only) { Write-Host "[schedule] no enabled environment matched '$Only'" }
    else { Write-Host '[schedule] no enabled environments in the config' }
    exit 1
}

function Get-TaskName($envName) { "$prefix-$envName" }

# Resolve the shell rather than assuming pwsh.exe is on PATH for the scheduler's environment, which
# is not the same as the one this script is running in.
$shell = (Get-Command pwsh -ErrorAction SilentlyContinue)?.Source
if (-not $shell) { $shell = (Get-Command powershell -ErrorAction SilentlyContinue)?.Source }
if (-not $shell) { Write-Host '[schedule] neither pwsh nor powershell found on PATH'; exit 1 }

# ---- Status ----------------------------------------------------------------
if ($Status) {
    foreach ($e in $targets) {
        $n = Get-TaskName $e.name
        $t = Get-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue
        if (-not $t) { Write-Host "$n : NOT REGISTERED"; continue }
        $i = Get-ScheduledTaskInfo -TaskName $n
        Write-Host "$n"
        Write-Host "  state      : $($t.State)"
        Write-Host "  principal  : $($t.Principal.UserId)  logon=$($t.Principal.LogonType)"
        Write-Host "  last run   : $($i.LastRunTime)  result=$($i.LastTaskResult)"
        Write-Host "  next run   : $($i.NextRunTime)"
        Write-Host "  action     : $($t.Actions[0].Execute) $($t.Actions[0].Arguments)"
    }
    exit 0
}

# ---- Remove ----------------------------------------------------------------
if ($Remove) {
    foreach ($e in $targets) {
        $n = Get-TaskName $e.name
        if (Get-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue) {
            Unregister-ScheduledTask -TaskName $n -Confirm:$false
            Write-Host "[schedule] removed $n"
        } else { Write-Host "[schedule] $n was not registered" }
    }
    exit 0
}

# ---- Register --------------------------------------------------------------
$s = $cfg.schedule
$startHour = [int]$s.startHour
$endHour   = [int]$s.endHour
$jitter    = [int]$s.jitterMinutes
$stagger   = if ($s.staggerMinutes) { [int]$s.staggerMinutes } else { 0 }
$every     = if ($s.everyHours) { [int]$s.everyHours } else { 1 }
$days      = @($s.days)

$idx = 0
foreach ($e in $targets) {
    $name = Get-TaskName $e.name

    # Stagger environments so they do not start in the same minute and contend on a shared gateway.
    # Applied to the base minute; the jitter then spreads each one across its own window.
    $totalMinute = [int]$s.startMinute + ($idx * $stagger)
    $extraHours  = [math]::Floor($totalMinute / 60)
    $startMinute = $totalMinute % 60
    $at = (Get-Date -Hour ($startHour + $extraHours) -Minute $startMinute -Second 0).ToString('HH:mm')

    # A weekly trigger fixes the days; its Repetition fixes the hourly repeat inside the day. The
    # repetition is transplanted from a throwaway -Once trigger because New-ScheduledTaskTrigger
    # cannot express "weekly AND repeating" directly.
    $delay = New-TimeSpan -Minutes $jitter
    $span  = (New-TimeSpan -Hours ($endHour - $startHour)) + $delay
    $trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $days -At $at -RandomDelay $delay
    $rep = (New-ScheduledTaskTrigger -Once -At $at `
            -RepetitionInterval (New-TimeSpan -Hours $every) -RepetitionDuration $span).Repetition
    $rep.StopAtDurationEnd = $false
    $trigger.Repetition = $rep

    # The environment name is passed explicitly. This is the whole point of the per-environment task.
    $taskArgs = "-NoProfile -NonInteractive -File `"$runner`" -Environment $($e.name) -Config `"$Config`""
    $action = New-ScheduledTaskAction -Execute $shell -Argument $taskArgs -WorkingDirectory $RepoRoot

    $logon = if ($S4U) { 'S4U' } else { 'Interactive' }
    $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType $logon -RunLevel Limited

    $limit = if ($cfg.runner.timeoutMinutes) { [int]$cfg.runner.timeoutMinutes } else { 55 }
    $settings = New-ScheduledTaskSettingsSet `
        -MultipleInstances IgnoreNew `
        -ExecutionTimeLimit (New-TimeSpan -Minutes $limit) `
        -StartWhenAvailable -DontStopOnIdleEnd -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

    $desc = "test-pipeline: $($e.name), ${startHour}:00-${endHour}:00 on $($days -join ','), start jittered up to ${jitter}m. Appends to $($cfg.runsDir)/history.jsonl"

    try {
        Register-ScheduledTask -TaskName $name -Trigger $trigger -Action $action `
            -Principal $principal -Settings $settings -Description $desc -Force | Out-Null
    } catch {
        if ($S4U) {
            # S4U needs elevation AND the SeBatchLogonRight. Registration can appear to succeed and
            # then fail at every firing with 0x80070569, which is an unhelpful place to find out.
            Write-Host "[schedule] S4U registration failed for $name, falling back to Interactive: $($_.Exception.Message)"
            $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
            Register-ScheduledTask -TaskName $name -Trigger $trigger -Action $action `
                -Principal $principal -Settings $settings -Description $desc -Force | Out-Null
        } else { throw }
    }

    # Read the principal back rather than trusting the call, for the same reason.
    $actual = (Get-ScheduledTask -TaskName $name).Principal.LogonType
    Write-Host "[schedule] registered $name  at $at (+0-${jitter}m), every ${every}h until ${endHour}:00, logon=$actual"
    if ($actual -eq 'Interactive') {
        Write-Host "           note: Interactive logon means runs only fire while $env:USERNAME is signed in."
    }
    $idx++
}

$skipped = @($cfg.environments | Where-Object { $_.enabled -eq $false })
Write-Host ''
Write-Host "[schedule] $($targets.Count) task(s) registered. Check with: .\install-schedule.ps1 -Status"
if ($skipped) {
    Write-Host "[schedule] not scheduled (enabled=false): $(($skipped.name) -join ', ')"
}

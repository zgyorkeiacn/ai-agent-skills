<#
.SYNOPSIS
  Register (or remove) the daily git-manager credential probe as a Windows Scheduled Task.

.DESCRIPTION
  The task runs `node creds.mjs probe`, which checks every registered token and writes
  pat-status.json. Nothing else reads the network, so this is cheap and safe to run daily.

  The task runs ONLY when the user is logged on, and deliberately so: tokens live in the OS
  credential store, which is unlocked by the user's logon session. A task configured to run
  whether-logged-on-or-not would find nothing and report every token as missing.

.EXAMPLE
  powershell -NoProfile -File install-schedule.ps1 -Time 09:00
  powershell -NoProfile -File install-schedule.ps1 -Uninstall
#>
[CmdletBinding()]
param(
  [string]$Time = '09:00',
  [string]$TaskName = 'git-manager-credential-probe',
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'

if ($Uninstall) {
  $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($existing) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "removed scheduled task '$TaskName'"
  } else {
    Write-Host "no scheduled task '$TaskName' to remove"
  }
  return
}

if ($Time -notmatch '^([01]\d|2[0-3]):([0-5]\d)$') {
  throw "-Time must be HH:MM in 24-hour form, got '$Time'"
}

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'node was not found on PATH. Install Node.js, or add it to PATH, then re-run.' }

$probeScript = Join-Path $PSScriptRoot 'creds.mjs'
if (-not (Test-Path $probeScript)) { throw "creds.mjs not found next to this script (looked in $PSScriptRoot)" }

# -NoProfile keeps a slow or noisy PowerShell profile out of a background task; -w hidden
# suppresses the console window that would otherwise flash once a day.
#
# `exit 0` is deliberate. `probe` exits non-zero when a credential is dead or expiring, which is
# what makes it usable as a CI gate - but Task Scheduler records that as the task's Last Result,
# so a genuinely expiring token would show the JOB as failing, every day, until fixed. A task
# permanently displaying an error is a task people stop reading. The real state lives in
# pat-status.json and is surfaced by `status`; the scheduler only needs to know the run happened.
$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -NonInteractive -w hidden -Command `"& '$node' '$probeScript' probe; exit 0`""

$trigger  = New-ScheduledTaskTrigger -Daily -At $Time
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries `
  -AllowStartIfOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

# Interactive principal: the credential store is only readable inside the user's own session.
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Settings $settings -Principal $principal `
  -Description 'git-manager: daily check for expired or expiring git credentials' | Out-Null

Write-Host "registered '$TaskName', runs daily at $Time"
Write-Host "verify with:  Get-ScheduledTask -TaskName $TaskName"
Write-Host "run it now:   Start-ScheduledTask -TaskName $TaskName"

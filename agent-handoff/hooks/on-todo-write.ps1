# PostToolUse hook: TodoWrite
# Detects newly-completed todo items and marks the corresponding tasks in
# implementation_plan.md as done. Updates the Current State block timestamp.
# Pure PowerShell — no sub-claude invocation needed.

$raw = [Console]::In.ReadToEnd()
if (-not $raw.Trim()) { exit 0 }

try {
    $data = $raw | ConvertFrom-Json
} catch { exit 0 }

$todos = $data.tool_input.todos
if (-not $todos) { exit 0 }

$cwd = if ($data.cwd) { $data.cwd } else { (Get-Location).Path }

# Find implementation_plan.md — check common locations
$candidatePaths = @(
    (Join-Path $cwd "implementation_plan.md"),
    (Join-Path $cwd "artifacts\implementation_plan.md"),
    (Join-Path $cwd "..\artifacts\implementation_plan.md")
)
$planPath = $candidatePaths | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $planPath) { exit 0 }

# Load previous todo state (keyed by project dir to survive multi-project sessions)
$safeKey = $cwd -replace '[:\\/]', '-'
$stateFile = Join-Path $env:TEMP "claude-todos-$safeKey.json"
$prevStatus = @{}
if (Test-Path $stateFile) {
    try {
        $prev = Get-Content $stateFile -Raw | ConvertFrom-Json
        foreach ($t in $prev) { $prevStatus[$t.id] = $t.status }
    } catch {}
}

# Identify newly completed items
$newlyDone = @($todos | Where-Object {
    $_.status -eq "completed" -and $prevStatus[$_.id] -ne "completed"
})

if ($newlyDone.Count -gt 0) {
    $planLines = (Get-Content $planPath -Raw) -split "`n"
    $timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd HH:mm") + " UTC"

    foreach ($todo in $newlyDone) {
        # Fuzzy match: split content into significant words (>3 chars), find a - [ ] line
        $words = @($todo.content -replace '[^\w\s]', '' -split '\s+' |
                   Where-Object { $_.Length -gt 3 })
        if ($words.Count -eq 0) { continue }

        for ($i = 0; $i -lt $planLines.Length; $i++) {
            if ($planLines[$i] -notmatch '^\s*-\s*\[\s*\]') { continue }
            $lineLower = $planLines[$i].ToLower()
            $matched = @($words | Where-Object { $lineLower -match $_.ToLower() }).Count
            if (($matched / $words.Count) -ge 0.6) {
                $planLines[$i] = $planLines[$i] -replace '\[\s*\]', "[x] ($timestamp)"
                break
            }
        }
    }

    # Update Last Updated in Current State block
    $updated = $planLines -join "`n"
    $updated = $updated -replace '(\*\*Last Updated:\*\*\s*)[^\n]*', "`${1}$timestamp"

    Set-Content -Path $planPath -Value $updated -NoNewline -Encoding UTF8
}

# Save current state for next diff
$todos | ConvertTo-Json -Depth 5 | Set-Content -Path $stateFile -Encoding UTF8
exit 0

# PostToolUse hook: EnterPlanMode
# Emits CODEBASE_INDEX reminder so Claude reads the index before planning.
# Returns immediately so plan mode is not delayed.

$raw = [Console]::In.ReadToEnd()
$cwd = $null
if ($raw.Trim()) {
    try { $cwd = ($raw | ConvertFrom-Json).cwd } catch {}
}
if (-not $cwd) { $cwd = (Get-Location).Path }

$indices = Get-ChildItem -Path $cwd -Recurse -Filter "CODEBASE_INDEX.md" -Depth 6 -ErrorAction SilentlyContinue |
    ForEach-Object { $_.FullName.Replace($cwd, '').TrimStart('\', '/').Replace('\', '/') }
if ($indices) {
    $list = $indices -join ', '
    Write-Output "PLAN MODE: Read these CODEBASE_INDEX.md file(s) before planning: $list"
}

exit 0

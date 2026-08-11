# Runs every quality gate from .claude/commands/verify.md, in the same order, but
# WITHOUT `&&` short-circuiting: a failing stage does not stop the ones after it.
# One run therefore reports every problem, not just the first.
#
# Written so the whole gate can be run in a terminal rather than through Claude —
# the gate is cheap, but streaming its output back through a model is not.
#
# Usage:
#   .\full_test.bat                  # everything
#   .\full_test.bat -SkipE2e         # skip the browser sweep (the slow stage)
#   .\full_test.bat -StopOnFirst     # classic fail-fast, like `npm run verify`
#
# Exit code is 0 only when every stage that ran passed.

[CmdletBinding()]
param(
  # Skip stage 5 (Playwright). Everything else still runs.
  [switch]$SkipE2e,
  # Stop at the first failing stage instead of running them all.
  [switch]$StopOnFirst
)

$ErrorActionPreference = 'Continue'
$PSNativeCommandUseErrorActionPreference = $false

# Always operate on the repo root (this script lives in scripts/).
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

$LogDir = Join-Path $RepoRoot '.verify\logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

$Results = [System.Collections.Generic.List[object]]::new()
$StartedAt = Get-Date

function Invoke-Stage {
  param(
    [Parameter(Mandatory)][string]$Name,
    [Parameter(Mandatory)][string]$Command,
    # A stage the later ones depend on. If it fails, the rest can't be trusted.
    [switch]$Critical
  )

  # Honour -StopOnFirst, and never run a stage whose prerequisite already failed.
  $alreadyFailed = $Results | Where-Object { -not $_.Passed }
  if ($alreadyFailed -and ($StopOnFirst -or ($alreadyFailed | Where-Object { $_.Critical }))) {
    $reason = if ($StopOnFirst) { 'stopped on first failure' } else { 'prerequisite stage failed' }
    Write-Host ''
    Write-Host "SKIP  $Name  ($reason)" -ForegroundColor DarkGray
    $Results.Add([pscustomobject]@{
      Name = $Name; Passed = $true; Skipped = $true; Critical = [bool]$Critical
      Seconds = 0; Log = $null
    })
    return
  }

  $slug = ($Name -replace '[^a-zA-Z0-9]+', '-').Trim('-').ToLower()
  $log = Join-Path $LogDir "$slug.log"
  $sw = [System.Diagnostics.Stopwatch]::StartNew()

  Write-Host ''
  Write-Host ('=' * 72) -ForegroundColor DarkCyan
  Write-Host "RUN   $Name" -ForegroundColor Cyan
  Write-Host "      $Command" -ForegroundColor DarkGray
  Write-Host ('=' * 72) -ForegroundColor DarkCyan

  # Tee so the console stays live while a full transcript lands on disk.
  & cmd /c "$Command 2>&1" | Tee-Object -FilePath $log
  $code = $LASTEXITCODE
  $sw.Stop()

  $passed = ($code -eq 0)
  if ($passed) {
    Write-Host ("PASS  {0}  ({1:n1}s)" -f $Name, $sw.Elapsed.TotalSeconds) -ForegroundColor Green
  } else {
    Write-Host ("FAIL  {0}  (exit {1}, {2:n1}s)  log: {3}" -f $Name, $code, $sw.Elapsed.TotalSeconds, $log) -ForegroundColor Red
  }

  $Results.Add([pscustomobject]@{
    Name = $Name; Passed = $passed; Skipped = $false; Critical = [bool]$Critical
    Seconds = $sw.Elapsed.TotalSeconds; Log = $log
  })
}

Write-Host ''
Write-Host 'MyHomeBase - full quality gate' -ForegroundColor White
Write-Host "Repo: $RepoRoot" -ForegroundColor DarkGray
Write-Host "Logs: $LogDir" -ForegroundColor DarkGray
if ($SkipE2e)     { Write-Host 'Mode: -SkipE2e (browser sweep will not run)' -ForegroundColor Yellow }
if ($StopOnFirst) { Write-Host 'Mode: -StopOnFirst (fail fast)' -ForegroundColor Yellow }

# Stage 0. Clear .next FIRST. tsconfig typechecks .next/dev/types/**, and those
# dev-generated route types outlive a deleted page - a stale one fails the
# typecheck naming a file that no longer exists. Critical: every later stage
# reads from this tree.
Invoke-Stage -Name 'Clean .next' -Command 'npm run clean:next' -Critical

# Stage 1-2. Cheapest first.
Invoke-Stage -Name 'Typecheck'      -Command 'npm run typecheck'
Invoke-Stage -Name 'Lint'           -Command 'npm run lint'
Invoke-Stage -Name 'Library boundary' -Command 'npm run check:lib-boundary'

# Stage 3. Unit tests.
Invoke-Stage -Name 'Unit tests'     -Command 'npm test'

# Stage 4. Migration dry-run. Works on a COPY in .verify/; the script itself
# aborts if MYHOMEBASE_DB is unset or resolves inside the repo's data/ folder.
Invoke-Stage -Name 'Migration dry-run' -Command 'npm run db:migrate:dry-run'

# Stage 5. Browser sweep over every route.
if ($SkipE2e) {
  Write-Host ''
  Write-Host 'SKIP  Browser smoke test  (-SkipE2e)' -ForegroundColor DarkGray
  $Results.Add([pscustomobject]@{
    Name = 'Browser smoke test'; Passed = $true; Skipped = $true; Critical = $false
    Seconds = 0; Log = $null
  })
} else {
  # Preflight aborts if 3000/3100 are already listening. Do not skip it: clearing
  # .next under a running dev server corrupts it, and once left ~1600 orphaned
  # Turbopack workers saturating the machine.
  Invoke-Stage -Name 'E2E preflight'  -Command 'npm run verify:preflight' -Critical
  Invoke-Stage -Name 'Prepare smoke DB' -Command 'npm run verify:prepare-db' -Critical
  Invoke-Stage -Name 'Browser smoke test' -Command 'npm run test:e2e'
}

# ---- Summary -----------------------------------------------------------------

$elapsed = (Get-Date) - $StartedAt
$failed  = @($Results | Where-Object { -not $_.Passed })
$skipped = @($Results | Where-Object { $_.Skipped })

Write-Host ''
Write-Host ('=' * 72) -ForegroundColor DarkCyan
Write-Host 'SUMMARY' -ForegroundColor White
Write-Host ('=' * 72) -ForegroundColor DarkCyan

foreach ($r in $Results) {
  if ($r.Skipped)     { $tag = 'SKIP'; $color = 'DarkGray' }
  elseif ($r.Passed)  { $tag = 'PASS'; $color = 'Green' }
  else                { $tag = 'FAIL'; $color = 'Red' }
  Write-Host ("  {0}  {1,-22} {2,6:n1}s" -f $tag, $r.Name, $r.Seconds) -ForegroundColor $color
}

Write-Host ''
Write-Host ("Elapsed: {0:n1}s" -f $elapsed.TotalSeconds) -ForegroundColor DarkGray

if ($failed.Count -eq 0) {
  if ($skipped.Count -gt 0) {
    Write-Host 'GREEN - every stage that ran passed (some were skipped).' -ForegroundColor Green
  } else {
    Write-Host 'GREEN - every stage passed.' -ForegroundColor Green
  }
  exit 0
}

Write-Host ("RED - {0} stage(s) failed:" -f $failed.Count) -ForegroundColor Red
foreach ($r in $failed) {
  Write-Host ("  - {0}" -f $r.Name) -ForegroundColor Red
  Write-Host ("      log: {0}" -f $r.Log) -ForegroundColor DarkGray

  # First few error-ish lines, so the cause is visible without opening the log.
  if ($r.Log -and (Test-Path $r.Log)) {
    $hits = Select-String -Path $r.Log -Pattern 'error|Error|✗|✘|failed|FAIL' -SimpleMatch:$false |
            Select-Object -First 6
    foreach ($h in $hits) {
      Write-Host ("      {0}" -f $h.Line.Trim()) -ForegroundColor DarkYellow
    }
  }
}

Write-Host ''
Write-Host 'Playwright HTML report (if the sweep failed): npx playwright show-report' -ForegroundColor DarkGray
exit 1

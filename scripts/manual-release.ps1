# Runs the mechanical steps of .claude/commands/release.md WITHOUT Claude.
#
# Written to save tokens: everything here is deterministic — backup, changelog
# stamp, changelog ship, commit, push — so none of it needs a model. The two
# steps that DO need judgement are deliberately left out:
#
#   - Publishing. The script stops and tells you to run REBUILD_PUBLISH_NAS.bat
#     yourself, exactly as /release does. It never builds or copies the app.
#   - A real changelog entry. This writes a placeholder line only. When a
#     release deserves a described entry, use /release instead.
#
# Usage:
#   .\scripts\manual-release.ps1                    # NAS (default)
#   .\scripts\manual-release.ps1 -Target Windows
#   .\scripts\manual-release.ps1 -Target Both
#   .\scripts\manual-release.ps1 -DryRun            # show, change nothing
#   .\scripts\manual-release.ps1 -NoPush            # commit but don't push
#   .\scripts\manual-release.ps1 -Yes               # no confirmation prompts
#
# Exit code 0 only if every step that ran succeeded.

[CmdletBinding()]
param(
  [ValidateSet('NAS', 'Windows', 'Both')]
  [string]$Target = 'NAS',

  # Print every action without touching the disk, the NAS or git.
  [switch]$DryRun,

  # Commit locally but skip `git push`.
  [switch]$NoPush,

  # Answer every confirmation with yes. For unattended runs.
  [switch]$Yes
)

$ErrorActionPreference = 'Stop'

# ---- Paths. Edit these two if a machine differs. -----------------------------
$NasData     = '\\NAS_DS223\app\myhomebase\data'
$NasRoot     = '\\NAS_DS223\app\myhomebase'
$WindowsRoot = 'C:\webapp\MHB'

# Always operate on the repo root (this script lives in scripts/).
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

$ChangeLog = Join-Path $RepoRoot 'CHANGE_HISTORY.md'
$Stamp     = Get-Date -Format 'yyyy-MM-ddTHH-mm-ss'   # filename-safe
$Human     = Get-Date -Format 'yyyy-MM-dd HH:mm'      # changelog heading

$DoNas = $Target -in @('NAS', 'Both')
$DoWin = $Target -in @('Windows', 'Both')

$Steps = [System.Collections.Generic.List[object]]::new()

function Add-Step {
  param([string]$Name, [bool]$Passed, [string]$Detail = '')
  $Steps.Add([pscustomobject]@{ Name = $Name; Passed = $Passed; Detail = $Detail })
}

function Write-Head {
  param([string]$Text)
  Write-Host ''
  Write-Host ('=' * 72) -ForegroundColor DarkCyan
  Write-Host $Text -ForegroundColor Cyan
  Write-Host ('=' * 72) -ForegroundColor DarkCyan
}

function Confirm-Step {
  param([string]$Question)
  if ($Yes -or $DryRun) { return $true }
  $answer = Read-Host "$Question [y/N]"
  return ($answer -match '^(y|yes)$')
}

# Copies .db plus the -wal/-shm sidecars. All three, because the app runs in WAL
# mode: committed rows can still be sitting in the -wal and not yet in the .db,
# so a .db-only copy of a running server can miss the newest writes. The
# sidecars are best-effort — absent after a clean checkpointed shutdown.
function Backup-Database {
  param([string]$Label, [string]$DataDir)

  Write-Host ''
  Write-Host "-- $Label" -ForegroundColor White
  Write-Host "   $DataDir" -ForegroundColor DarkGray

  if (-not (Test-Path -LiteralPath $DataDir)) {
    Write-Host "   UNREACHABLE. Is the NAS on / the share mounted / the app installed?" -ForegroundColor Red
    Add-Step "Backup $Label" $false 'data folder not reachable'
    return
  }

  $db = Join-Path $DataDir 'myhomebase.db'
  if (-not (Test-Path -LiteralPath $db)) {
    Write-Host "   No myhomebase.db in that folder." -ForegroundColor Red
    Add-Step "Backup $Label" $false 'myhomebase.db not found'
    return
  }

  $copied = @()
  foreach ($suffix in @('', '-wal', '-shm')) {
    $src = Join-Path $DataDir "myhomebase.db$suffix"
    $dst = Join-Path $DataDir "myhomebase.db$suffix.bak-$Stamp"
    if (-not (Test-Path -LiteralPath $src)) { continue }

    if ($DryRun) {
      Write-Host "   [dry-run] copy myhomebase.db$suffix -> myhomebase.db$suffix.bak-$Stamp" -ForegroundColor Yellow
      $copied += "myhomebase.db$suffix"
      continue
    }

    try {
      Copy-Item -LiteralPath $src -Destination $dst -Force
      $size = '{0:n1} MB' -f ((Get-Item -LiteralPath $dst).Length / 1MB)
      Write-Host "   copied  myhomebase.db$suffix.bak-$Stamp  ($size)" -ForegroundColor Green
      $copied += "myhomebase.db$suffix"
    } catch {
      # The main .db failing is fatal for this target; a sidecar failing is not.
      if ($suffix -eq '') {
        Write-Host "   FAILED to copy the database: $_" -ForegroundColor Red
        Add-Step "Backup $Label" $false "$_"
        return
      }
      Write-Host "   (skipped myhomebase.db$suffix - $_)" -ForegroundColor DarkYellow
    }
  }

  Add-Step "Backup $Label" $true ($copied -join ', ')
}

# ---- Start -------------------------------------------------------------------

Write-Host ''
Write-Host 'MyHomeBase - manual release (no Claude)' -ForegroundColor White
Write-Host "Repo:   $RepoRoot"  -ForegroundColor DarkGray
Write-Host "Target: $Target"    -ForegroundColor DarkGray
Write-Host "Stamp:  $Human"     -ForegroundColor DarkGray
if ($DryRun) { Write-Host 'Mode:   -DryRun (nothing will be changed)' -ForegroundColor Yellow }
if ($NoPush) { Write-Host 'Mode:   -NoPush (commit only)' -ForegroundColor Yellow }

# ---- Step 1. Publish is yours to run ----------------------------------------

Write-Head 'STEP 1 of 5  -  Publish'

if ($DoNas) {
  Write-Host ''
  Write-Host '  >>> PLEASE RUN  REBUILD_PUBLISH_NAS.bat  <<<' -ForegroundColor Yellow
  Write-Host ''
  Write-Host '  It builds for aarch64, mirrors to the NAS share, and writes' -ForegroundColor DarkGray
  Write-Host '  deploy.trigger so the keepalive task restarts into the new build.' -ForegroundColor DarkGray
  Write-Host '  The NAS keeps serving the OLD build until that restart happens -' -ForegroundColor DarkGray
  Write-Host '  a copy alone is not a release.' -ForegroundColor DarkGray
  Write-Host ''
  Write-Host '  If this release adds a migration, apply it over SSH first:' -ForegroundColor DarkGray
  Write-Host '    cd /volume1/app/myhomebase && node --env-file-if-exists=.env migrate.cjs' -ForegroundColor DarkGray
}

if ($DoWin) {
  Write-Host ''
  Write-Host "  >>> PLEASE RUN  REBUILD_PUBLISH.bat $WindowsRoot  <<<" -ForegroundColor Yellow
}

Write-Host ''
if (-not (Confirm-Step 'Is the publish done (and restarted)?')) {
  Write-Host ''
  Write-Host 'Stopped. Nothing was changed. Publish first, then re-run.' -ForegroundColor Red
  exit 1
}
Add-Step 'Publish confirmed' $true

# ---- Step 2. Back up the production database ---------------------------------

Write-Head 'STEP 2 of 5  -  Back up the production database'

if ($DoNas) { Backup-Database -Label 'NAS'     -DataDir $NasData }
if ($DoWin) { Backup-Database -Label 'Windows' -DataDir (Join-Path $WindowsRoot 'data') }

# A failed backup means no verified restore point — do not go on to commit.
if ($Steps | Where-Object { $_.Name -like 'Backup*' -and -not $_.Passed }) {
  Write-Host ''
  Write-Host 'Backup failed. Stopping before any commit.' -ForegroundColor Red
  exit 1
}

# ---- Step 3. Stamp the changelog ---------------------------------------------

Write-Head 'STEP 3 of 5  -  Stamp CHANGE_HISTORY.md'

$entry = @"
## $Human - Manual release

Manual release on $Human. Published to: $Target.

No described entry: this release was shipped with ``scripts\manual-release.ps1``.
Run ``/release`` instead when the changes deserve a written summary.
"@

if ($DryRun) {
  Write-Host '[dry-run] would insert at the top of CHANGE_HISTORY.md:' -ForegroundColor Yellow
  Write-Host $entry -ForegroundColor DarkGray
  Add-Step 'Changelog stamped' $true '(dry-run)'
} elseif (-not (Test-Path -LiteralPath $ChangeLog)) {
  Write-Host "CHANGE_HISTORY.md not found at $ChangeLog" -ForegroundColor Red
  Add-Step 'Changelog stamped' $false 'file missing'
  exit 1
} else {
  # Insert under the "# Change History" title so newest stays at the top and the
  # H1 is not pushed down. -Raw + explicit UTF8 keeps the existing em-dashes and
  # box characters intact.
  $existing = Get-Content -LiteralPath $ChangeLog -Raw -Encoding UTF8
  $lines    = $existing -split "`r?`n"
  $titleIdx = -1
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match '^#\s') { $titleIdx = $i; break }
  }

  if ($titleIdx -ge 0) {
    $before = if ($titleIdx -ge 0) { ($lines[0..$titleIdx] -join "`r`n") } else { '' }
    $after  = ($lines[($titleIdx + 1)..($lines.Count - 1)] -join "`r`n").TrimStart("`r", "`n")
    $new    = "$before`r`n`r`n$entry`r`n`r`n$after"
  } else {
    $new = "$entry`r`n`r`n$existing"
  }

  Set-Content -LiteralPath $ChangeLog -Value $new -Encoding UTF8 -NoNewline
  Write-Host "Inserted: ## $Human - Manual release" -ForegroundColor Green
  Add-Step 'Changelog stamped' $true $Human
}

# ---- Step 4. Ship the changelog to the deployed copies -----------------------

Write-Head 'STEP 4 of 5  -  Ship CHANGE_HISTORY.md to the deployed app'

# The About page reads CHANGE_HISTORY.md from the RUNNING app's working
# directory, so the file just stamped in step 3 has to be pushed out. The NAS
# publish in step 1 happened BEFORE that stamp, so the NAS copy is stale by one
# entry and needs the single file copied over.
if ($DoNas) {
  if ($DryRun) {
    Write-Host "[dry-run] copy CHANGE_HISTORY.md -> $NasRoot" -ForegroundColor Yellow
    Add-Step 'Ship changelog (NAS)' $true '(dry-run)'
  } elseif (-not (Test-Path -LiteralPath $NasRoot)) {
    Write-Host "NAS unreachable at $NasRoot" -ForegroundColor Red
    Add-Step 'Ship changelog (NAS)' $false 'unreachable'
  } else {
    Copy-Item -LiteralPath $ChangeLog -Destination (Join-Path $NasRoot 'CHANGE_HISTORY.md') -Force
    Write-Host "Copied to $NasRoot" -ForegroundColor Green
    Add-Step 'Ship changelog (NAS)' $true ''
  }
}

if ($DoWin) {
  if ($DryRun) {
    Write-Host "[dry-run] copy CHANGE_HISTORY.md -> $WindowsRoot" -ForegroundColor Yellow
    Add-Step 'Ship changelog (Windows)' $true '(dry-run)'
  } elseif (-not (Test-Path -LiteralPath $WindowsRoot)) {
    Write-Host "$WindowsRoot not found" -ForegroundColor Red
    Add-Step 'Ship changelog (Windows)' $false 'destination missing'
  } else {
    Copy-Item -LiteralPath $ChangeLog -Destination (Join-Path $WindowsRoot 'CHANGE_HISTORY.md') -Force
    Write-Host "Copied to $WindowsRoot" -ForegroundColor Green
    Add-Step 'Ship changelog (Windows)' $true ''
  }
}

# ---- Step 5. Commit and push -------------------------------------------------

Write-Head 'STEP 5 of 5  -  Commit and push'

$status = & git status --porcelain
if ($LASTEXITCODE -ne 0) {
  Write-Host 'git status failed.' -ForegroundColor Red
  Add-Step 'Commit' $false 'git status failed'
  exit 1
}

if (-not $status) {
  Write-Host 'Working tree is clean - nothing to commit.' -ForegroundColor DarkGray
  Add-Step 'Commit' $true 'nothing to commit'
} else {
  Write-Host 'About to stage everything below:' -ForegroundColor White
  Write-Host ''
  $status | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
  Write-Host ''
  Write-Host 'Check for secrets, scratch scripts and stray debug files before saying yes.' -ForegroundColor Yellow
  Write-Host ''

  if (-not (Confirm-Step 'Stage all of it and commit?')) {
    Write-Host 'Stopped before committing. The backup and changelog stand.' -ForegroundColor Yellow
    Add-Step 'Commit' $false 'declined'
    $NoPush = $true
  } else {
    $message = "Manual release on $Human"

    if ($DryRun) {
      Write-Host "[dry-run] git add -A; git commit -m `"$message`"" -ForegroundColor Yellow
      Add-Step 'Commit' $true '(dry-run)'
    } else {
      & git add -A
      if ($LASTEXITCODE -ne 0) { Write-Host 'git add failed.' -ForegroundColor Red; Add-Step 'Commit' $false 'git add failed'; exit 1 }

      & git commit -m $message
      if ($LASTEXITCODE -ne 0) {
        Write-Host 'git commit failed (a hook may have rejected it).' -ForegroundColor Red
        Add-Step 'Commit' $false 'git commit failed'
        exit 1
      }
      Write-Host "Committed: $message" -ForegroundColor Green
      Add-Step 'Commit' $true $message
    }
  }
}

if ($NoPush) {
  Write-Host 'Skipping push (-NoPush, or the commit was declined).' -ForegroundColor DarkGray
} elseif ($DryRun) {
  Write-Host '[dry-run] git push origin main' -ForegroundColor Yellow
  Add-Step 'Push' $true '(dry-run)'
} else {
  & git push origin main
  if ($LASTEXITCODE -ne 0) {
    Write-Host 'git push failed.' -ForegroundColor Red
    Add-Step 'Push' $false 'git push failed'
  } else {
    Write-Host 'Pushed to origin/main.' -ForegroundColor Green
    Add-Step 'Push' $true ''
  }
}

# ---- Summary -----------------------------------------------------------------

Write-Head 'SUMMARY'

foreach ($s in $Steps) {
  $tag   = if ($s.Passed) { 'OK  ' } else { 'FAIL' }
  $color = if ($s.Passed) { 'Green' } else { 'Red' }
  $line  = '  {0}  {1,-24} {2}' -f $tag, $s.Name, $s.Detail
  Write-Host $line.TrimEnd() -ForegroundColor $color
}

$failed = @($Steps | Where-Object { -not $_.Passed })
Write-Host ''
if ($failed.Count -eq 0) {
  Write-Host 'Release complete.' -ForegroundColor Green
  exit 0
}

Write-Host ("{0} step(s) failed." -f $failed.Count) -ForegroundColor Red
exit 1

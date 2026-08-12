# Review step 3 of /release: update root .md docs based on code changes.
#
# Calls Claude headless to read the diff, compare it against each doc, and
# decide what needs updating. Does NOT rewrite files — just tells you what
# changed and what the updates should be.
#
# Usage:
#   .\scripts\review-release-docs.ps1              # against HEAD (uncommitted)
#   .\scripts\review-release-docs.ps1 -Since main  # since main branch
#   .\scripts\review-release-docs.ps1 -Model opus  # use a specific model (default haiku)

[CmdletBinding()]
param(
  # The ref to diff against. Default is HEAD (current branch uncommitted changes).
  [string]$Since = 'HEAD',

  # Claude model to use. Default is haiku (fast, cheap). Set to opus for more analysis.
  [string]$Model = 'haiku'
)

$ErrorActionPreference = 'Stop'

# Always operate on the repo root.
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

# ---- Gather the diff ----

Write-Host ''
Write-Host "Getting diff since $Since" -ForegroundColor White

try {
  $diffOutput = & git diff $Since
  if ($LASTEXITCODE -ne 0) {
    Write-Host "git diff failed. Is '$Since' a valid ref?" -ForegroundColor Red
    exit 1
  }
} catch {
  Write-Host "git diff failed: $_" -ForegroundColor Red
  exit 1
}

if (-not $diffOutput) {
  Write-Host "No changes since $Since." -ForegroundColor DarkGray
  exit 0
}

# ---- Read the docs into the prompt so Claude can compare ----

$docs = @(
  'CHANGE_HISTORY.md',
  'components.md',
  'design.md',
  'coding-guide.md',
  'INSTRUCTION_SETUP_SYNOLOGY.md',
  'ARCHITECTURE.md',
  'CLAUDE.md',
  'START_HERE.md'
)

$docsContent = @{}
foreach ($doc in $docs) {
  $path = Join-Path $RepoRoot $doc
  if (Test-Path -LiteralPath $path) {
    $docsContent[$doc] = Get-Content -LiteralPath $path -Raw -Encoding UTF8
  } else {
    $docsContent[$doc] = "(file not found)"
  }
}

# ---- Invoke Claude headless ----

$prompt = @"
You are reviewing documentation for a software release. The code has changed
(diff below), and you need to decide which of the root .md docs need updating.

Do NOT rewrite the docs. Instead, for each doc that needs changes, write a
clear summary of what changed in the code and what the doc updates should say.

## The diff

\`\`\`
$diffOutput
\`\`\`

## The current docs

$(
  foreach ($doc in $docs) {
    @"

### $doc

\`\`\`markdown
$($docsContent[$doc])
\`\`\`
"@
  }
)

## Your task

For each doc below, decide if it needs updating based on the diff:

- **CHANGE_HISTORY.md** — Always needs a new dated entry. Write what the entry should say based on the changes and the overall theme of the release.
- **components.md** — If any new reusable component was added or props changed.
- **design.md** — If colors, fonts, icons, themes, or phone/desktop layout rules changed.
- **coding-guide.md** — If table schemas, column names, or migration conventions changed.
- **INSTRUCTION_SETUP_SYNOLOGY.md** — If anything changed about building, deploying, or running on the NAS.
- **ARCHITECTURE.md** — If layering rules, lib/ structure, or testing patterns changed.
- **CLAUDE.md** — If conventions, verification steps, or project instructions changed.
- **START_HERE.md** — If setup, scaffolding, or bootstrap instructions changed (rare).

For each doc that needs updating, write:

1. The filename
2. What changed in the code (brief)
3. What the update should say (the actual text to add or replace, or a summary if it's complex)

For docs that don't need updates, just say "no update needed."

Keep it brief and actionable — the goal is to hand this summary to a human who will manually apply the changes.
"@

Write-Host 'Calling Claude...' -ForegroundColor Cyan
Write-Host ''

try {
  & claude -p $prompt --model $Model
  if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Write-Host 'Claude returned an error.' -ForegroundColor Red
    exit 1
  }
} catch {
  Write-Host "Claude call failed: $_" -ForegroundColor Red
  exit 1
}

exit 0

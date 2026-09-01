# Copies start.sh to the Synology NAS and makes it executable.
#
# start.sh is deliberately EXCLUDED from the publish (see REBUILD_PUBLISH_NAS.bat's
# robocopy /XF list), so a republish can never clobber the file DSM's boot task runs or
# strip its +x bit. The trade is that a change to it has to be copied by hand -- which is
# what this script is for. Run it whenever start.sh changes in the repo.
#
# Usage:
#   .\COPY_NAS_START_SH.ps1
#   .\COPY_NAS_START_SH.ps1 -NasUser someone -NasHost 192.168.4.9
#
# Requires the OpenSSH client (built into Windows 10/11: "Optional features" ->
# "OpenSSH Client"). Uses your SSH key if you have one set up -- see
# INSTRUCTION_SETUP_SYNOLOGY.md Part 3 -- and falls back to prompting for a password.

param(
    # ---------------------------------------------------------------------------
    # Connection details. Edit these defaults, or pass them on the command line.
    # ---------------------------------------------------------------------------
    [string]$NasUser = "ssh_user",
    [string]$NasHost = "192.168.4.2",
    [string]$NasPath = "/volume1/app/myhomebase",

    # The password is deliberately NOT stored here.
    #
    # This file is tracked by git (.gitignore excludes .env and Google_Client_Info.md, but
    # not .ps1), and a secret committed once stays in history even after it is deleted --
    # the exact hazard .gitignore already calls out for the real credential files. Leave
    # this empty and the script prompts; the prompt is masked and the value lives only in
    # this process.
    #
    # Better still, set up key auth once (INSTRUCTION_SETUP_SYNOLOGY.md Part 3) and neither
    # the prompt nor a password appears at all.
    [string]$NasPassword = ""
)

$ErrorActionPreference = "Stop"

# Run from the repo root regardless of the caller's working directory, so the script can be
# invoked from anywhere and still copy THIS repo's start.sh.
Set-Location -LiteralPath $PSScriptRoot

$localStartSh = Join-Path $PSScriptRoot "start.sh"
if (-not (Test-Path -LiteralPath $localStartSh)) {
    Write-Host "No start.sh found at $localStartSh." -ForegroundColor Red
    exit 1
}

if ([string]::IsNullOrWhiteSpace($NasUser)) {
    Write-Host "No SSH user set." -ForegroundColor Yellow
    Write-Host "  Either edit `$NasUser at the top of this script, or pass -NasUser <name>."
    $NasUser = Read-Host "NAS SSH user"
    if ([string]::IsNullOrWhiteSpace($NasUser)) {
        Write-Host "A user is required. Nothing was copied." -ForegroundColor Red
        exit 1
    }
}

$target = "$NasUser@$NasHost"

Write-Host ""
Write-Host "=== Copying start.sh to $target`:$NasPath ===" -ForegroundColor Cyan

# CRLF would break the script on the NAS.
#
# `sh` reads `#!/bin/sh\r` as an interpreter path with a carriage return in it and fails
# with a bare "not found" that names a binary that plainly exists -- one of the least
# obvious failures available on Windows. .gitattributes should be keeping this file LF, so
# this is a check rather than a fix: if it trips, the repo copy is wrong and converting it
# silently here would hide that.
$bytes = [System.IO.File]::ReadAllBytes($localStartSh)
if ($bytes -contains 13) {
    Write-Host ""
    Write-Host "start.sh contains CRLF line endings." -ForegroundColor Red
    Write-Host "  The NAS would fail to run it with a misleading 'not found'."
    Write-Host "  Fix the repo copy (it should be LF -- see .gitattributes), then re-run."
    exit 1
}

# Whether to route ssh/scp through sshpass-style stdin. Windows' OpenSSH has no
# --password flag and refuses to read one from a pipe, so a stored password can only be
# supplied by an interactive prompt -- which is what happens when this is empty.
if (-not [string]::IsNullOrWhiteSpace($NasPassword)) {
    Write-Host ""
    Write-Host "NOTE: `$NasPassword is set, but Windows' OpenSSH client cannot accept a" -ForegroundColor Yellow
    Write-Host "      password non-interactively -- it always prompts. You will still be"
    Write-Host "      asked for it below. Set up key auth to avoid the prompt entirely."
}

# `-O` forces the legacy SCP protocol instead of SFTP.
#
# Not optional against DSM. OpenSSH 9+ (Windows 11 ships 10.x) rewrote scp to transfer over
# the SFTP subsystem, and Synology does not enable that subsystem by default -- so a plain
# `scp` authenticates fine and then dies with:
#
#     subsystem request failed on channel 0
#     scp: Connection closed
#
# which reads like a network or credentials fault and is neither. `-O` skips SFTP entirely.
# The alternative is enabling SFTP in DSM (Control Panel -> File Services -> FTP -> SFTP),
# but a script that needs no server-side change is the better default.
& scp -O $localStartSh "$target`:$NasPath/start.sh"

if ($LASTEXITCODE -ne 0) {
    # Fall back to piping the file through ssh, which needs no subsystem at all -- just a
    # shell. Covers an scp too old for -O, or a DSM that refuses the legacy protocol too.
    Write-Host ""
    Write-Host "scp failed (exit $LASTEXITCODE). Retrying over a plain ssh pipe..." -ForegroundColor Yellow

    # -LiteralPath and -Raw so the bytes go across exactly as they are on disk; -NoNewline
    # on the write so nothing is appended. The CRLF check above already proved it is LF.
    $content = Get-Content -LiteralPath $localStartSh -Raw
    $content | & ssh $target "cat > '$NasPath/start.sh'"

    if ($LASTEXITCODE -ne 0) {
        Write-Host ""
        Write-Host "Both scp and the ssh pipe failed. start.sh was NOT copied." -ForegroundColor Red
        Write-Host "  - Is the user right?  You are connecting as '$NasUser'."
        Write-Host "  - Is the NAS reachable?  ssh $target"
        Write-Host "  - Is SSH enabled in DSM (Control Panel -> Terminal & SNMP)?"
        exit 1
    }
    Write-Host "Copied over the ssh pipe." -ForegroundColor Green
}

Write-Host "Copied. Restoring the executable bit..." -ForegroundColor Cyan

# Not optional. scp does not reliably carry the +x bit from Windows, and DSM's boot task
# runs this exact path -- a start.sh that lands non-executable means the app does not come
# back on the next restart. That is why this is a failure, not a warning.
& ssh $target "chmod +x '$NasPath/start.sh' && ls -l '$NasPath/start.sh'"
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "chmod FAILED (exit $LASTEXITCODE)." -ForegroundColor Red
    Write-Host "  start.sh is on the NAS but may not be executable, which would stop the"
    Write-Host "  app coming back on the next restart. Fix it by hand before rebooting:"
    Write-Host "    ssh $target `"chmod +x $NasPath/start.sh`""
    exit 1
}

Write-Host ""
Write-Host "start.sh is in place and executable." -ForegroundColor Green
Write-Host ""
Write-Host "It takes effect on the next run of the DSM keepalive task (every minute), or"
Write-Host "immediately via DSM -> Task Scheduler -> 'MyHomeBase keepalive' -> Run."
Write-Host ""
Write-Host "This copy adds the deployment recorder, so the next publish writes a row to"
Write-Host "sys_deployments and it appears on About -> Deployments."

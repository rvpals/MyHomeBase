# Publishes MyHomeBase to the NAS, then restarts it immediately over SSH.
#
# REBUILD_PUBLISH_NAS.bat does everything up to writing `deploy.trigger`, which the DSM
# keepalive task notices on its next run -- so a plain publish switches over within a
# minute on its own. This script adds the last step Min was doing by hand afterwards:
# DSM -> Task Scheduler -> "MyHomeBase keepalive" -> Run.
#
# It runs `start.sh` on the NAS directly rather than poking DSM's scheduler. That is the
# same script the keepalive task runs, so it takes the identical path -- sees the trigger,
# stops the old process, applies pending migrations, starts the new build, records the
# deployment. Triggering the DSM task instead would need root and the `synoschedtask` CLI,
# which is undocumented and has changed across DSM versions.
#
# Usage:
#   .\REBUILD_PUBLISH_NAS_START.ps1
#   .\REBUILD_PUBLISH_NAS_START.ps1 -NasUser someone -NasHost 192.168.4.9
#   .\REBUILD_PUBLISH_NAS_START.ps1 -Destination \\OTHER_NAS\app\myhomebase
#   .\REBUILD_PUBLISH_NAS_START.ps1 -SkipPublish     # restart only, no rebuild
#
# Requires the OpenSSH client (built into Windows 10/11) and, for an unattended run, key
# auth -- see INSTRUCTION_SETUP_SYNOLOGY.md Part 3. Without a key, ssh prompts for a
# password, which still works but means this can't be left alone.

param(
    # ---------------------------------------------------------------------------
    # Connection details. Edit these defaults, or pass them on the command line.
    # Kept identical to COPY_NAS_START_SH.ps1 so there is one place to look.
    # ---------------------------------------------------------------------------
    [string]$NasUser = "ssh_user",
    [string]$NasHost = "192.168.4.2",
    [string]$NasPath = "/volume1/app/myhomebase",

    # SMB destination for the file copy, passed straight through to
    # REBUILD_PUBLISH_NAS.bat. Empty means "let that script use its own default".
    [string]$Destination = "",

    # Restart without rebuilding. For when a publish already ran and only the switchover
    # is wanted -- or to re-run a start that failed once the cause is fixed.
    [switch]$SkipPublish,

    # How long to let start.sh run before giving up on it. start.sh's own port probe waits
    # up to 20s, and a migration on a DS223 can add plenty more, so this is generous. It
    # exists only so a wedged SSH session can't hang the window forever.
    [int]$RestartTimeout = 180
)

$ErrorActionPreference = "Stop"

# Run from the repo root regardless of the caller's working directory.
Set-Location -LiteralPath $PSScriptRoot

$target = "$NasUser@$NasHost"

# ---------------------------------------------------------------------------
# 1. Publish (unless asked to skip)
# ---------------------------------------------------------------------------
# Delegated to REBUILD_PUBLISH_NAS.bat rather than reimplemented. That script carries the
# build, the AArch64 verification, the trigger-before-copy ordering that fixed the
# 2026-08-30 outage, and the robocopy /XF list that protects the live database. Copying any
# of it here would mean two versions of those rules, and the wrong one would eventually be
# the one that ran.
if (-not $SkipPublish) {
    $publishArgs = @()
    if (-not [string]::IsNullOrWhiteSpace($Destination)) { $publishArgs += $Destination }

    & "$PSScriptRoot\REBUILD_PUBLISH_NAS.bat" @publishArgs
    if ($LASTEXITCODE -ne 0) {
        Write-Host ""
        Write-Host "Publish failed (exit $LASTEXITCODE). NOT restarting the app." -ForegroundColor Red
        Write-Host "  The NAS keeps serving the build it already had."
        Write-Host ""
        Write-Host "  DONE (nothing was deployed) -- you can close the terminal." -ForegroundColor Yellow
        exit 1
    }
} else {
    Write-Host ""
    Write-Host "-SkipPublish set: no rebuild, no copy. Restarting the current build only." -ForegroundColor Yellow
}

# ---------------------------------------------------------------------------
# 2. Restart immediately, and WAIT for the result
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "=== Restarting MyHomeBase on $target ===" -ForegroundColor Cyan
Write-Host "Running start.sh in the foreground -- this window stays open through its port"
Write-Host "probe (up to ~20s, plus any migration) so the real outcome is visible here."
Write-Host ""
# The app itself survives this window closing (start.sh launches server.js under nohup,
# with output to app.log, before the probe starts). What does NOT survive is the
# bookkeeping that runs AFTER the probe -- the startup message and the sys_deployments
# row. Closing early therefore leaves a running app with a missing deployment record,
# which is silent and only noticed much later on About -> Deployments. Hence a loud
# instruction here and an unmissable DONE marker at the end.
Write-Host "  *** DON'T CLOSE THE TERMINAL UNTIL YOU SEE THE 'DONE' MESSAGE ***" -ForegroundColor Yellow
Write-Host "  The app would keep running, but this release would not be recorded." -ForegroundColor Yellow
Write-Host ""

# Why the remote command redirects everything to a file instead of streaming back.
#
# The first version was `cd '$NasPath' && exec ./start.sh`, which HUNG for the full
# timeout on every run -- observed 2026-09-21, deployment #89: app.log showed the restart,
# the migration check, `Ready`, and the recorded deployment all inside a minute, yet ssh
# sat open until the 180s timeout and the script reported a failure for a deploy that had
# completely succeeded.
#
# The cause is not start.sh. It is that `nohup node server.js &` INHERITS the SSH session's
# stdout and stderr, and ssh does not close a channel while any process still holds the
# pipe open -- so the backgrounded server holds the session open for as long as it runs,
# i.e. forever. start.sh exits in seconds; ssh cannot tell.
#
# Redirecting the whole remote command to a file detaches the channel from the server's
# descriptors, so ssh returns the moment start.sh does. The output is then read back in a
# second, short connection. The exit code is captured on the NAS and echoed as the last
# line, because it must survive the redirect.
#
# `< /dev/null` too: without a stdin the session also waits on the terminal.
$outFile = "$NasPath/.restart-output"
$remote = "cd '$NasPath' && { ./start.sh; echo `"__EXIT__`$?`"; } > '$outFile' 2>&1 < /dev/null"

$sshJob = Start-Job -ScriptBlock {
    param($target, $remote, $outFile)
    # Two connections: one to run it (silent, returns as soon as start.sh does), one to
    # fetch what it wrote. Output and exit code are returned as one explicit object rather
    # than as a stream whose last element happens to be the code -- relying on position
    # breaks when ssh prints nothing and returns a bare scalar.
    & ssh -o BatchMode=no $target $remote 2>&1 | Out-Null
    $sshOwnCode = $LASTEXITCODE

    if ($sshOwnCode -ne 0) {
        # Couldn't even run it -- there is no output file to read.
        return [pscustomobject]@{ Lines = @(); Code = $sshOwnCode }
    }

    # Read and delete in one connection, so the temp file never lingers in the app folder
    # (robocopy /MIR on the next publish would remove it anyway -- it is not in the /XF
    # list -- but leaving deploy litter beside the live database is worth avoiding).
    $lines = @(& ssh -o BatchMode=no $target "cat '$outFile' 2>/dev/null; rm -f '$outFile'" 2>&1)

    # Pull the exit marker off the end; start.sh's real code lives there, not in ssh's.
    $code = $null
    $kept = @()
    foreach ($line in $lines) {
        if ("$line" -match '^__EXIT__(\d+)$') { $code = [int]$Matches[1] } else { $kept += $line }
    }
    [pscustomobject]@{ Lines = $kept; Code = $code }
} -ArgumentList $target, $remote, $outFile

# A timeout rather than a bare Wait-Job: an SSH session that hangs on host-key
# confirmation or a dead TCP connection would otherwise hold this window open forever.
if (Wait-Job -Job $sshJob -Timeout $RestartTimeout) {
    # Select-Object -Last 1 because a job's output can carry extra records; the object the
    # script block returned is the final one.
    $result = Receive-Job -Job $sshJob | Select-Object -Last 1
    Remove-Job -Job $sshJob

    if ($result) {
        $result.Lines | ForEach-Object { Write-Host "  $_" }
        # A null Code means ssh never set one, which is not a success -- report it as a
        # failure rather than defaulting to 0 and calling a non-deploy "DONE".
        $sshExit = if ($null -ne $result.Code) { [int]$result.Code } else { 1 }
    } else {
        Write-Host "  (no output returned from the SSH session)"
        $sshExit = 1
    }
} else {
    Stop-Job -Job $sshJob
    Remove-Job -Job $sshJob -Force
    Write-Host "Gave up waiting for the SSH session after ${RestartTimeout}s." -ForegroundColor Yellow
    Write-Host "  This is a reporting timeout, not evidence that the app is down."
    $sshExit = 124
}

Write-Host ""

if ($sshExit -eq 0) {
    Write-Host "MyHomeBase restarted into the new build." -ForegroundColor Green
    Write-Host "  start.sh confirmed something is listening on port 3000."
    Write-Host "  Any pending migration was applied before the app bound the port."
    Write-Host ""
    Write-Host "  ============================================================" -ForegroundColor Green
    Write-Host "   DONE -- you can close the terminal now." -ForegroundColor Green
    Write-Host "   The app runs on the NAS under nohup and does not depend on" -ForegroundColor Green
    Write-Host "   this window, the SSH session, or this PC staying on." -ForegroundColor Green
    Write-Host "  ============================================================" -ForegroundColor Green
    exit 0
}

# start.sh exits non-zero for exactly two reasons, and both are worth telling apart,
# because one is self-healing and the other is not.
Write-Host "The restart did not report success (exit $sshExit)." -ForegroundColor Red
Write-Host ""

if ($sshExit -eq 124) {
    # 124 is this script's own timeout, NOT start.sh's. Kept distinct because the first
    # version lumped it in with a real failure and told Min "start.sh ran and reported a
    # failure" about a deploy that had entirely succeeded (deployment #89).
    Write-Host "  That is THIS SCRIPT's timeout, not a failure reported by the NAS." -ForegroundColor Yellow
    Write-Host "  start.sh may well have finished and the app may be running fine."
    Write-Host ""
    Write-Host "  Check before assuming anything is broken:"
    Write-Host "    ssh $target `"tail -30 $NasPath/app.log`""
    Write-Host "  A line reading 'Ready' followed by 'Recorded deployment #N' means the"
    Write-Host "  release went live and only the reporting timed out."
} elseif ($sshExit -eq 255) {
    # 255 is ssh's own "could not connect / authenticate", not start.sh's.
    Write-Host "  That is an SSH failure, so start.sh probably never ran." -ForegroundColor Yellow
    Write-Host "    - Is the NAS reachable?  ssh $target"
    Write-Host "    - Is SSH enabled in DSM (Control Panel -> Terminal & SNMP)?"
    Write-Host "    - Is the user right?  Connecting as '$NasUser'."
    Write-Host ""
    Write-Host "  THE PUBLISH ITSELF STILL LANDED. deploy.trigger is on the NAS, so the"
    Write-Host "  every-minute keepalive task will switch over within a minute by itself."
    Write-Host "  Nothing further is required -- this only missed the instant switchover."
} else {
    Write-Host "  start.sh ran and reported a failure. The two causes it exits non-zero for:" -ForegroundColor Yellow
    Write-Host "    - a migration failed, so the app was deliberately NOT started"
    Write-Host "    - the app started but never bound port 3000 within its timeout"
    Write-Host ""
    Write-Host "  Either way port 3000 now serves the failure page: open the app in a"
    Write-Host "  browser and the last 100 lines of app.log are shown there, with the"
    Write-Host "  likely cause named. Or read it directly:"
    Write-Host "    ssh $target `"tail -50 $NasPath/app.log`""
    Write-Host ""
    Write-Host "  The keepalive task retries every minute, so a transient failure (a port"
    Write-Host "  not yet released) recovers on its own. A migration failure will not."
}

# Also marked DONE. The instruction above is "wait for DONE", so a failure that ended the
# wait without saying so would leave the window looking like it was still working.
Write-Host ""
Write-Host "  ============================================================" -ForegroundColor Yellow
Write-Host "   DONE (with the failure above) -- you can close the terminal." -ForegroundColor Yellow
Write-Host "   Nothing here is still running on your PC." -ForegroundColor Yellow
Write-Host "  ============================================================" -ForegroundColor Yellow

exit 1

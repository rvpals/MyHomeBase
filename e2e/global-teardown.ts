import { spawnSync } from "node:child_process";

/**
 * Reaps Turbopack worker processes that outlive the dev server Playwright booted.
 *
 * Playwright kills the process it spawned, but on Windows the dev server's worker
 * children are not always reaped with it, and each leftover holds memory. A previous
 * run left ~1600 of them behind and saturated the machine, so cleanup is a step rather
 * than a hope.
 *
 * Matching is narrow on purpose — only node processes whose command line points at
 * *this* checkout's `.next/dev/build` directory. That cannot match the deployed
 * instance (a different tree, and it runs `server.js`) or any unrelated editor or
 * tooling process.
 */
export default function globalTeardown(): void {
  if (process.platform !== "win32") {
    // Elsewhere the process group dies with the server, so there is nothing to do.
    return;
  }

  const workerPathFragment = `${process.cwd()}\\.next\\dev\\build`;
  const script = [
    "$fragment = $env:VERIFY_WORKER_PATH",
    "$workers = @(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" |",
    "  Where-Object { $_.CommandLine -and $_.CommandLine.Contains($fragment) })",
    "if ($workers.Count -gt 0) {",
    "  $workers | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {} }",
    "  Write-Output \"Reaped $($workers.Count) leftover dev worker process(es).\"",
    "}",
  ].join("; ");

  const result = spawnSync(
    "powershell",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    {
      env: { ...process.env, VERIFY_WORKER_PATH: workerPathFragment },
      encoding: "utf8",
    },
  );

  const output = (result.stdout ?? "").trim();
  if (output) console.log(output);
}

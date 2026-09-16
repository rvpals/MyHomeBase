import { describe, expect, it } from "vitest";
import { tailLines } from "./log-tail";
import { renderFailurePage } from "./page";
import type { FailurePageInput } from "./types";

function input(overrides: Partial<FailurePageInput> = {}): FailurePageInput {
  return {
    tail: tailLines("Error: listen EADDRINUSE: 0.0.0.0:3000"),
    occurredAt: new Date(2026, 8, 15, 8, 12, 3),
    logPath: "/volume1/app/myhomebase/app.log",
    refreshSeconds: 15,
    ...overrides,
  };
}

describe("renderFailurePage", () => {
  it("renders a complete standalone document", () => {
    const html = renderFailurePage(input());
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("</html>");
  });

  it("requests no external stylesheet, script or font", () => {
    // The app's bundle is what failed, so anything fetched from it is another way
    // for this page to break. It has to be one self-contained file.
    const html = renderFailurePage(input());
    expect(html).not.toMatch(/<link[^>]+stylesheet/i);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/https?:\/\//);
  });

  it("shows the diagnosis and the remedy for a recognised failure", () => {
    const html = renderFailurePage(input());
    expect(html).toContain("Port 3000 was still held by another process.");
    expect(html).toContain("netstat");
  });

  it("shows the log lines", () => {
    const html = renderFailurePage(
      input({ tail: tailLines("first line\nsecond line\nthird line") }),
    );
    expect(html).toContain("first line");
    expect(html).toContain("third line");
  });

  it("says how many lines it is showing when the log was truncated", () => {
    const raw = Array.from({ length: 4213 }, (_, index) => `line ${index}`).join("\n");
    const html = renderFailurePage(input({ tail: tailLines(raw, 100) }));
    expect(html).toContain("last 100 of 4,213 lines");
  });

  it("says so plainly when the log is empty rather than showing an empty box", () => {
    const html = renderFailurePage(input({ tail: tailLines("") }));
    expect(html).toContain("does not exist yet");
    expect(html).toContain("no lines yet");
  });

  it("escapes HTML in log lines", () => {
    // app.log is untrusted input here: a log line can carry anything an error
    // message interpolated, and this page has no authentication in front of it.
    const html = renderFailurePage({
      ...input({ tail: tailLines("<script>alert('x')</script>") }),
    });
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes HTML in the log path too", () => {
    const html = renderFailurePage(input({ logPath: '/app/"><b>x</b>' }));
    expect(html).not.toContain("<b>x</b>");
    expect(html).toContain("&lt;b&gt;");
  });

  it("carries a meta refresh so it hands over once the app starts", () => {
    expect(renderFailurePage(input({ refreshSeconds: 15 }))).toContain(
      '<meta http-equiv="refresh" content="15">',
    );
  });

  it("shows the detection timestamp", () => {
    expect(renderFailurePage(input())).toContain("2026-09-15 08:12:03");
  });

  it("states that it is not the app", () => {
    // Otherwise a reader reasonably concludes the app is up and merely broken.
    expect(renderFailurePage(input())).toContain("not by MyHomeBase");
  });

  it("notes that a transient failure may clear itself", () => {
    expect(renderFailurePage(input())).toContain("often clears on its own");
  });

  it("does not promise self-healing for a failure that retrying cannot fix", () => {
    const html = renderFailurePage(input({ tail: tailLines("NODE_MODULE_VERSION 115") }));
    expect(html).not.toContain("often clears on its own");
    expect(html).toContain("keepalive task retries");
  });

  it("renders an unknown failure without claiming a cause", () => {
    const html = renderFailurePage(input({ tail: tailLines("mystery output") }));
    expect(html).toContain("MyHomeBase failed to start.");
    expect(html).toContain("mystery output");
  });

  it("carries a narrow-screen block, since this gets read on a phone", () => {
    expect(renderFailurePage(input())).toContain("@media (max-width: 1023px)");
  });
});

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { deps } from "@/lib/wiring";
import path from "node:path";

/**
 * Serves the application server log file.
 * The log file is written to $APP/app.log by start.sh.
 */
export async function GET() {
  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  if (!currentUser) return new NextResponse(null, { status: 401 });

  // Read the app.log file from the app directory
  const appLogPath = path.join(process.cwd(), "app", "app.log");

  try {
    const fs = await import("node:fs");
    if (!fs.existsSync(appLogPath)) {
      return new NextResponse(
        JSON.stringify({ error: "Log file not found" }),
        {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const logContent = fs.readFileSync(appLogPath, "utf8");
    // Return the last 50 lines of the log
    const lines = logContent.split("\n").slice(-50);
    const formattedLog = lines.join("\n");

    return new NextResponse(formattedLog, {
      headers: {
        "Content-Type": "text/plain",
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (error) {
    console.error("Error reading log file:", error);
    return new NextResponse(
      JSON.stringify({ error: "Failed to read log file" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
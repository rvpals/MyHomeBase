import { listDependencyChecks } from "@/lib/code-test";
import { deps } from "@/lib/wiring";
import { CodeTesterView } from "./view";

/**
 * Administration -> Code Tester: a place to try experiments against the real server.
 *
 * Every experiment runs on demand through its own server action, because the point is
 * to time it. The only thing read up front is the list of dependency checks (names and
 * purposes, nothing run), so the client never bundles the probes. The admin layout
 * already gates the page; each action checks `requireAdmin()` itself as well.
 */
export default function CodeTesterPage() {
  return <CodeTesterView dependencies={listDependencyChecks(deps.codeTestDependencies.probes)} />;
}

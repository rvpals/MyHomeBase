import { CodeTesterView } from "./view";

/**
 * Administration -> Code Tester: a place to try experiments against the real server.
 *
 * Nothing to fetch up front -- every experiment runs on demand through its own server
 * action, because the point is to time it. The admin layout already gates the page;
 * each action checks `requireAdmin()` itself as well.
 */
export default function CodeTesterPage() {
  return <CodeTesterView />;
}

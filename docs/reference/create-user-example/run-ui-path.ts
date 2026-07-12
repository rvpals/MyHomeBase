// Stand-in for what the Next.js UI does when the form is submitted.
import { createUserAction } from "./src/app/actions.js";

const result = await createUserAction({
  email: "alice@ui.com",
  name: "Alice (from UI)",
  password: "secret123",
});
console.log("UI path result:", result);

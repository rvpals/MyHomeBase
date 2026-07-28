import { listUsers } from "@/lib/user";
import { deps } from "@/lib/wiring";

export async function listUsersCommand(): Promise<void> {
  const users = listUsers(deps.userRepo);

  if (users.length === 0) {
    console.log("No users yet.");
    return;
  }

  for (const user of users) {
    const status = user.isDisabled ? "disabled" : "active";
    const google = user.googleEmail ? `, google ${user.googleEmail}` : "";
    console.log(
      `#${user.id} ${user.username} — ${user.fullName} [${user.role}, ${status}]${google} (created ${user.createdAt})`,
    );
  }

  console.log(`\n${users.length} user(s).`);
}

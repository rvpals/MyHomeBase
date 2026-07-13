import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { listModules } from "@/lib/modules";
import { getUserModuleAccess, listUsers } from "@/lib/user";
import { deps } from "@/lib/wiring";
import { UserManagementView } from "./view";

export default async function UserManagementPage() {
  const users = listUsers(deps.userRepo);
  const modules = listModules(deps.moduleRepo, { includeHidden: true });

  const moduleIdsByUserId: Record<number, number[]> = {};
  for (const user of users) {
    moduleIdsByUserId[user.id] = getUserModuleAccess(user.id, deps.userRepo);
  }

  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);

  return (
    <UserManagementView
      users={users}
      modules={modules}
      moduleIdsByUserId={moduleIdsByUserId}
      currentUserId={currentUser?.id ?? -1}
    />
  );
}

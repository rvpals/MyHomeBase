"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/avatar";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import type { Module } from "@/lib/modules";
import type { User, UserRole } from "@/lib/user";
import {
  clearUserAvatarAction,
  createUserAction,
  deleteUserAction,
  setUserDisabledAction,
  setUserGoogleEmailAction,
  setUserModuleAccessAction,
  setUserPasswordAction,
  setUserRoleAction,
} from "./actions";

export interface UserManagementViewProps {
  users: User[];
  modules: Module[];
  moduleIdsByUserId: Record<number, number[]>;
  currentUserId: number;
}

function RoleBadge({ role }: { role: UserRole }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
        role === "admin" ? "bg-brass-soft text-brass-dark" : "bg-line/60 text-muted"
      }`}
    >
      {role === "admin" ? "Admin" : "User"}
    </span>
  );
}

function StatusBadge({ isDisabled }: { isDisabled: boolean }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
        isDisabled ? "bg-red-950/50 text-red-300" : "bg-emerald-950/50 text-emerald-300"
      }`}
    >
      {isDisabled ? "Disabled" : "Enabled"}
    </span>
  );
}

function ModuleAccessEditor({
  user,
  modules,
  grantedIds,
  onSave,
}: {
  user: User;
  modules: Module[];
  grantedIds: number[];
  onSave: (moduleIds: number[]) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set(grantedIds));
  const [isSaving, setIsSaving] = useState(false);

  if (user.role === "admin") {
    return <span className="text-sm text-muted">All modules (admin)</span>;
  }

  const grantedModules = modules.filter((module) => grantedIds.includes(module.id));

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1">
        {grantedModules.length === 0 ? (
          <span className="text-sm text-muted">No modules assigned</span>
        ) : (
          grantedModules.map((module) => (
            <span
              key={module.id}
              className="rounded-full bg-line/60 px-2 py-0.5 text-xs font-medium text-ink"
            >
              {module.shortName}
            </span>
          ))
        )}
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="text-xs font-medium text-brass-dark hover:underline"
        >
          {open ? "Cancel" : "Edit"}
        </button>
      </div>
      {open && (
        <div className="mt-2 flex flex-col gap-1 rounded-md border border-line bg-paper p-2">
          {modules.map((module) => (
            <label key={module.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selected.has(module.id)}
                onChange={(event) => {
                  setSelected((current) => {
                    const next = new Set(current);
                    if (event.target.checked) next.add(module.id);
                    else next.delete(module.id);
                    return next;
                  });
                }}
              />
              {module.shortName}
            </label>
          ))}
          <Button
            size="sm"
            className="mt-1 self-start"
            disabled={isSaving}
            onClick={async () => {
              setIsSaving(true);
              try {
                await onSave(Array.from(selected));
                setOpen(false);
              } finally {
                setIsSaving(false);
              }
            }}
          >
            {isSaving ? "Saving…" : "Save"}
          </Button>
        </div>
      )}
    </div>
  );
}

function GoogleEmailEditor({
  googleEmail,
  onSave,
}: {
  googleEmail?: string;
  onSave: (googleEmail: string | null) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(googleEmail ?? "");
  const [error, setError] = useState<string | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);

  if (!open) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm text-ink">{googleEmail ?? <span className="text-muted">Not linked</span>}</span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-xs font-medium text-brass-dark hover:underline"
        >
          {googleEmail ? "Edit" : "Link"}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <input
        type="email"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="name@gmail.com"
        className="w-44 rounded-md border border-line bg-paper px-2 py-1 text-xs text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
      />
      {error && <span className="text-xs text-red-400">{error}</span>}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={isSaving}
          onClick={async () => {
            setIsSaving(true);
            setError(undefined);
            try {
              await onSave(value.trim() === "" ? null : value.trim());
              setOpen(false);
            } finally {
              setIsSaving(false);
            }
          }}
        >
          {isSaving ? "Saving…" : "Save"}
        </Button>
        {googleEmail && (
          <Button
            size="sm"
            variant="secondary"
            disabled={isSaving}
            onClick={async () => {
              setIsSaving(true);
              try {
                await onSave(null);
                setOpen(false);
              } finally {
                setIsSaving(false);
              }
            }}
          >
            Unlink
          </Button>
        )}
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setOpen(false);
            setValue(googleEmail ?? "");
            setError(undefined);
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

function PasswordEditor({ onSave }: { onSave: (password: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-medium text-brass-dark hover:underline"
      >
        Change password
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <input
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        placeholder="New password"
        className="w-36 rounded-md border border-line bg-paper px-2 py-1 text-xs text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
      />
      {error && <span className="text-xs text-red-400">{error}</span>}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={isSaving}
          onClick={async () => {
            setIsSaving(true);
            setError(undefined);
            try {
              await onSave(password);
              setOpen(false);
              setPassword("");
            } finally {
              setIsSaving(false);
            }
          }}
        >
          {isSaving ? "Saving…" : "Save"}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setOpen(false);
            setPassword("");
            setError(undefined);
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

function AddUserForm({ onCreate }: { onCreate: (input: Parameters<typeof createUserAction>[0]) => Promise<string | undefined> }) {
  const [username, setUsername] = useState("");
  const [fullName, setFullName] = useState("");
  const [description, setDescription] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("user");
  const [error, setError] = useState<string | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError(undefined);
    try {
      const failure = await onCreate({ username, fullName, description, password, role });
      if (failure) {
        setError(failure);
        return;
      }
      setUsername("");
      setFullName("");
      setDescription("");
      setPassword("");
      setRole("user");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink">Username</span>
        <input
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          className="w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink">Full name</span>
        <input
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
          className="w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
        />
      </label>
      <label className="block text-sm sm:col-span-2">
        <span className="mb-1 block font-medium text-ink">Description</span>
        <input
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          className="w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink">Password</span>
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink">Role</span>
        <select
          value={role}
          onChange={(event) => setRole(event.target.value as UserRole)}
          className="w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
        >
          <option value="user">User</option>
          <option value="admin">Admin</option>
        </select>
      </label>
      {error && <p className="text-sm text-red-400 sm:col-span-2">{error}</p>}
      <div className="sm:col-span-2">
        <Button type="submit" disabled={isSaving}>
          {isSaving ? "Creating…" : "Create user"}
        </Button>
      </div>
    </form>
  );
}

export function UserManagementView({
  users,
  modules,
  moduleIdsByUserId,
  currentUserId,
}: UserManagementViewProps) {
  const router = useRouter();

  async function handleCreate(input: Parameters<typeof createUserAction>[0]) {
    const result = await createUserAction(input);
    if (!result.ok) return result.error ?? "Failed to create user.";
    router.refresh();
    return undefined;
  }

  const columns: DataGridColumn<User>[] = [
    {
      key: "id",
      header: "User ID",
      value: (user) => user.id,
      render: (user) => <span className="font-mono text-xs">{user.id}</span>,
    },
    {
      key: "avatar",
      header: "Avatar",
      render: (user) => (
        <div className="flex items-center gap-2">
          <Avatar
            userId={user.id}
            avatarMimeType={user.avatarMimeType}
            fallbackText={user.fullName}
            version={user.updatedAt}
          />
          {user.avatarMimeType && (
            <button
              type="button"
              onClick={async () => {
                const result = await clearUserAvatarAction(user.id);
                if (result.ok) router.refresh();
                else window.alert(result.error);
              }}
              className="text-xs font-medium text-red-400 hover:underline"
            >
              Clear
            </button>
          )}
        </div>
      ),
    },
    { key: "username", header: "Username", value: (user) => user.username, render: (user) => user.username },
    { key: "fullName", header: "Full Name", value: (user) => user.fullName, render: (user) => user.fullName },
    {
      key: "description",
      header: "Description",
      value: (user) => user.description ?? null,
      render: (user) => <span className="text-muted">{user.description ?? "—"}</span>,
    },
    {
      key: "role",
      header: "Role",
      value: (user) => user.role,
      render: (user) => (
        <div className="flex items-center gap-2">
          <RoleBadge role={user.role} />
          <button
            type="button"
            onClick={async () => {
              const result = await setUserRoleAction(user.id, user.role === "admin" ? "user" : "admin");
              if (result.ok) router.refresh();
              else window.alert(result.error);
            }}
            className="text-xs font-medium text-brass-dark hover:underline"
          >
            {user.role === "admin" ? "Demote to User" : "Elevate to Admin"}
          </button>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      value: (user) => (user.isDisabled ? "Disabled" : "Active"),
      render: (user) => (
        <div className="flex items-center gap-2">
          <StatusBadge isDisabled={user.isDisabled} />
          <button
            type="button"
            onClick={async () => {
              const result = await setUserDisabledAction(user.id, !user.isDisabled);
              if (result.ok) router.refresh();
              else window.alert(result.error);
            }}
            className="text-xs font-medium text-brass-dark hover:underline"
          >
            {user.isDisabled ? "Enable" : "Disable"}
          </button>
        </div>
      ),
    },
    {
      key: "googleEmail",
      header: "Google Email",
      value: (user) => user.googleEmail ?? null,
      render: (user) => (
        <GoogleEmailEditor
          googleEmail={user.googleEmail}
          onSave={async (googleEmail) => {
            const result = await setUserGoogleEmailAction(user.id, googleEmail);
            if (result.ok) router.refresh();
            else window.alert(result.error);
          }}
        />
      ),
    },
    {
      key: "modules",
      header: "Modules",
      value: (user) => (moduleIdsByUserId[user.id] ?? []).length,
      render: (user) => (
        <ModuleAccessEditor
          user={user}
          modules={modules}
          grantedIds={moduleIdsByUserId[user.id] ?? []}
          onSave={async (moduleIds) => {
            const result = await setUserModuleAccessAction(user.id, moduleIds);
            if (result.ok) router.refresh();
            else window.alert(result.error);
          }}
        />
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (user) => (
        <div className="flex flex-col gap-2">
          <PasswordEditor
            onSave={async (password) => {
              const result = await setUserPasswordAction(user.id, password);
              if (result.ok) router.refresh();
              else window.alert(result.error);
            }}
          />
          {user.id !== currentUserId && (
            <button
              type="button"
              onClick={async () => {
                if (!window.confirm(`Delete user "${user.username}"? This cannot be undone.`)) return;
                const result = await deleteUserAction(user.id);
                if (result.ok) router.refresh();
                else window.alert(result.error);
              }}
              className="text-xs font-medium text-red-400 hover:underline"
            >
              Delete
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <p className="font-mono text-xs font-medium uppercase tracking-widest text-brass-dark">
        Administration
      </p>
      <h1 className="mt-2 font-display text-3xl font-semibold text-ink">User Management</h1>
      <p className="mt-2 text-sm text-muted">
        Create accounts, manage roles and passwords, link Google accounts for one-click sign-in, and
        control which modules each user can see.
      </p>

      <div className="mt-6">
        <CollapsibleCard title="Add User">
          <AddUserForm onCreate={handleCreate} />
        </CollapsibleCard>
      </div>

      <div className="mt-6">
        <DataGrid
          columns={columns}
          rows={users}
          getRowKey={(user) => user.id}
          emptyMessage="No users yet."
          exportFileName="users"
        />
      </div>
    </div>
  );
}

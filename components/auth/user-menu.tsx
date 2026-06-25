import { LogOut } from "lucide-react";

import { auth, signOut } from "@/auth";
import { authEnabled } from "@/lib/auth/enabled";

/** Signed-in user + sign-out. Renders nothing when Entra ID auth is disabled. */
export async function UserMenu() {
  if (!authEnabled()) return null;
  const session = await auth();
  const user = session?.user;
  if (!user) return null;

  const label = user.name ?? user.email ?? "Signed in";

  return (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/" });
      }}
      className="flex items-center gap-2 rounded-lg bg-panel-2/50 px-2.5 py-2"
    >
      <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent to-accent-2 text-[10px] font-semibold text-accent-foreground">
        {label.slice(0, 1).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1 truncate text-[11px] text-muted" title={label}>
        {label}
      </div>
      <button
        type="submit"
        title="Sign out"
        className="rounded p-1 text-faint transition-colors hover:bg-line hover:text-danger"
      >
        <LogOut className="size-3.5" />
      </button>
    </form>
  );
}

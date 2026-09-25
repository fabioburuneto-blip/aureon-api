import Link from "next/link";
import { getCurrentBusiness } from "@/lib/auth";
import { signOut } from "@/app/auth/actions";
import { DashboardNav } from "./nav";
import { NotificationBell } from "./notification-bell";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { supabase, user, business, role } = await getCurrentBusiness();

  const [{ data: recentNotifications }, { count: unreadCount }] =
    await Promise.all([
      supabase
        .from("notifications")
        .select("*")
        .eq("recipient_user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(8),
      supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("recipient_user_id", user.id)
        .is("read_at", null),
    ]);

  return (
    <div className="flex flex-1 bg-zinc-50">
      <aside className="hidden w-64 shrink-0 border-r border-zinc-200 bg-white p-4 sm:flex sm:flex-col">
        <div className="mb-6 px-2">
          <p className="truncate text-sm font-semibold text-zinc-900">
            {business.name}
          </p>
          <Link
            href={`/${business.slug}`}
            target="_blank"
            className="text-xs text-zinc-500 hover:underline"
          >
            /{business.slug}
          </Link>
        </div>
        <DashboardNav />
        <div className="mt-auto flex flex-col gap-2 px-2 pt-4">
          <p className="text-xs text-zinc-400">
            {role === "owner" ? "Proprietário" : "Equipe"}
          </p>
          <form action={signOut}>
            <button
              type="submit"
              className="text-sm font-medium text-zinc-500 hover:text-zinc-900"
            >
              Sair
            </button>
          </form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="hidden items-center justify-end border-b border-zinc-200 bg-white px-8 py-3 sm:flex">
          <NotificationBell
            notifications={recentNotifications ?? []}
            unreadCount={unreadCount ?? 0}
            timezone={business.timezone}
          />
        </header>
        <header className="border-b border-zinc-200 bg-white sm:hidden">
          <div className="flex items-center justify-between px-4 py-3">
            <p className="truncate text-sm font-semibold text-zinc-900">
              {business.name}
            </p>
            <div className="flex items-center gap-2">
              <NotificationBell
                notifications={recentNotifications ?? []}
                unreadCount={unreadCount ?? 0}
                timezone={business.timezone}
              />
              <form action={signOut}>
                <button type="submit" className="text-sm text-zinc-500">
                  Sair
                </button>
              </form>
            </div>
          </div>
          <div className="overflow-x-auto px-4 pb-3">
            <DashboardNav orientation="horizontal" />
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 sm:p-8">{children}</main>
      </div>
    </div>
  );
}

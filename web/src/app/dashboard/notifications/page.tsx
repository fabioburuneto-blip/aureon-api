import Link from "next/link";
import { getCurrentBusiness } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import { markNotificationRead, markAllNotificationsRead } from "./actions";

export default async function NotificationsPage() {
  const { supabase, user, business } = await getCurrentBusiness();

  const { data: notifications } = await supabase
    .from("notifications")
    .select("*")
    .eq("recipient_user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(100);

  const list = notifications ?? [];
  const unreadCount = list.filter((n) => !n.read_at).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900">
            Notificações
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            {unreadCount > 0
              ? `${unreadCount} não lida${unreadCount === 1 ? "" : "s"}`
              : "Tudo em dia."}
          </p>
        </div>
        {unreadCount > 0 && (
          <form action={markAllNotificationsRead}>
            <Button type="submit" variant="secondary">
              Marcar todas como lidas
            </Button>
          </form>
        )}
      </div>

      <Card>
        {list.length === 0 ? (
          <p className="text-sm text-zinc-500">
            Nenhuma notificação ainda. Você será avisado aqui quando um
            cliente agendar, cancelar ou reagendar pela sua página pública.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {list.map((notification) => {
              const unread = !notification.read_at;
              const content = (
                <div className="flex items-start gap-3">
                  {unread && (
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-zinc-900" />
                  )}
                  <div className={unread ? "" : "pl-5"}>
                    <p className="font-medium text-zinc-900">
                      {notification.title}
                    </p>
                    {notification.body && (
                      <p className="text-sm text-zinc-500">
                        {notification.body}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-zinc-400">
                      {formatDateTime(notification.created_at, business.timezone)}
                    </p>
                  </div>
                </div>
              );

              return (
                <li
                  key={notification.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-4"
                >
                  {notification.appointment_id ? (
                    <Link
                      href={`/dashboard/appointments/${notification.appointment_id}`}
                      className="-mx-2 flex-1 rounded-lg px-2 py-1 hover:bg-zinc-50"
                    >
                      {content}
                    </Link>
                  ) : (
                    <div className="flex-1">{content}</div>
                  )}
                  {unread && (
                    <form action={markNotificationRead.bind(null, notification.id)}>
                      <button
                        type="submit"
                        className="text-sm font-medium text-zinc-600 hover:text-zinc-900"
                      >
                        Marcar como lida
                      </button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

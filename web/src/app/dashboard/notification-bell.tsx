"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { markNotificationRead } from "./notifications/actions";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";
import type { Database } from "@/types/database";

type Notification = Database["public"]["Tables"]["notifications"]["Row"];

export function NotificationBell({
  notifications,
  unreadCount,
  timezone,
}: {
  notifications: Notification[];
  unreadCount: number;
  timezone: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label="Notificações"
        aria-expanded={open}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          className="h-5 w-5"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 0 0-4-5.66V5a2 2 0 1 0-4 0v.34A6 6 0 0 0 6 11v3.2a2 2 0 0 1-.6 1.4L4 17h5m6 0v1a3 3 0 1 1-6 0v-1m6 0H9"
          />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-2 w-80 rounded-xl border border-zinc-200 bg-white p-2 shadow-lg">
          <div className="flex items-center justify-between px-2 py-1.5">
            <p className="text-sm font-semibold text-zinc-900">
              Notificações
            </p>
            <Link
              href="/dashboard/notifications"
              className="text-xs text-zinc-500 hover:underline"
              onClick={() => setOpen(false)}
            >
              Ver todas
            </Link>
          </div>
          {notifications.length === 0 ? (
            <p className="px-2 py-4 text-sm text-zinc-500">
              Nenhuma notificação ainda.
            </p>
          ) : (
            <ul className="mt-1 flex max-h-96 flex-col gap-0.5 overflow-y-auto">
              {notifications.map((notification) => (
                <li key={notification.id}>
                  <NotificationItem
                    notification={notification}
                    timezone={timezone}
                    onNavigate={() => setOpen(false)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function NotificationItem({
  notification,
  timezone,
  onNavigate,
}: {
  notification: Notification;
  timezone: string;
  onNavigate: () => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const unread = !notification.read_at;

  function handleClick() {
    if (unread) {
      startTransition(() => {
        markNotificationRead(notification.id);
      });
    }
    onNavigate();
    if (notification.appointment_id) {
      router.push(`/dashboard/appointments/${notification.appointment_id}`);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        "w-full rounded-lg px-2 py-2 text-left text-sm hover:bg-zinc-50",
        unread && "bg-zinc-50",
      )}
    >
      <div className="flex items-start gap-2">
        {unread && (
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-900" />
        )}
        <div className={unread ? "" : "pl-3.5"}>
          <p className="font-medium text-zinc-900">{notification.title}</p>
          {notification.body && (
            <p className="text-xs text-zinc-500">{notification.body}</p>
          )}
          <p className="mt-0.5 text-xs text-zinc-400">
            {formatDateTime(notification.created_at, timezone)}
          </p>
        </div>
      </div>
    </button>
  );
}

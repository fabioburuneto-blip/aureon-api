import Link from "next/link";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { formatTime } from "@/lib/format";
import {
  addDays,
  localDateKeyFromISO,
  toDateKey,
  WEEKDAY_SHORT_LABELS_MON_FIRST,
} from "@/lib/date-utils";
import type { AppointmentWithRelations } from "@/lib/appointments-data";

export function WeekView({
  appointments,
  timezone,
  startKey,
}: {
  appointments: AppointmentWithRelations[];
  timezone: string;
  startKey: string;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(startKey, i));
  const byDay = new Map<string, AppointmentWithRelations[]>();
  for (const appointment of appointments) {
    const key = localDateKeyFromISO(appointment.starts_at, timezone);
    const list = byDay.get(key) ?? [];
    list.push(appointment);
    byDay.set(key, list);
  }

  const todayKey = toDateKey(new Date());

  return (
    <div className="grid grid-cols-1 gap-3 overflow-x-auto sm:grid-cols-7">
      {days.map((dayKey, index) => {
        const dayAppointments = byDay.get(dayKey) ?? [];
        const isToday = dayKey === todayKey;
        return (
          <Card
            key={dayKey}
            className={cn(
              "flex min-w-[160px] flex-col gap-2 p-3",
              isToday && "border-zinc-900",
            )}
          >
            <div className="flex items-baseline justify-between">
              <p className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                {WEEKDAY_SHORT_LABELS_MON_FIRST[index]}
              </p>
              <p
                className={cn(
                  "text-sm font-semibold",
                  isToday ? "text-zinc-900" : "text-zinc-500",
                )}
              >
                {Number(dayKey.slice(8, 10))}
              </p>
            </div>
            {dayAppointments.length === 0 ? (
              <p className="text-xs text-zinc-400">Sem agendamentos</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {dayAppointments.map((appointment) => (
                  <li key={appointment.id}>
                    <Link
                      href={`/dashboard/appointments/${appointment.id}`}
                      className="block rounded-md bg-zinc-50 px-2 py-1.5 text-xs hover:bg-zinc-100"
                    >
                      <p className="font-medium text-zinc-900">
                        {formatTime(appointment.starts_at, timezone)}{" "}
                        {appointment.customer?.name ?? "Cliente"}
                      </p>
                      <p className="truncate text-zinc-500">
                        {appointment.service?.name}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        );
      })}
    </div>
  );
}

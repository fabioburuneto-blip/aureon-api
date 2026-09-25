import Link from "next/link";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import {
  addDays,
  daysInMonth,
  localDateKeyFromISO,
  parseDateKey,
  startOfWeekKey,
  toDateKey,
  WEEKDAY_SHORT_LABELS_MON_FIRST,
} from "@/lib/date-utils";
import type { AppointmentWithRelations } from "@/lib/appointments-data";

const MAX_CHIPS_PER_DAY = 3;

export function MonthView({
  appointments,
  timezone,
  monthStartKey,
  hrefFor,
}: {
  appointments: AppointmentWithRelations[];
  timezone: string;
  monthStartKey: string;
  hrefFor: (view: "day", date: string) => string;
}) {
  const monthEndKey = addDays(monthStartKey, daysInMonth(monthStartKey) - 1);
  const gridStart = startOfWeekKey(monthStartKey);
  const gridEnd = addDays(startOfWeekKey(monthEndKey), 6);

  const cells: string[] = [];
  for (let key = gridStart; key <= gridEnd; key = addDays(key, 1)) {
    cells.push(key);
  }

  const byDay = new Map<string, AppointmentWithRelations[]>();
  for (const appointment of appointments) {
    const key = localDateKeyFromISO(appointment.starts_at, timezone);
    const list = byDay.get(key) ?? [];
    list.push(appointment);
    byDay.set(key, list);
  }

  const todayKey = toDateKey(new Date());
  const currentMonth = parseDateKey(monthStartKey).getMonth();
  const weeks: string[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }

  return (
    <Card className="overflow-x-auto p-3 sm:p-4">
      <div className="grid min-w-[640px] grid-cols-7 gap-2">
        {WEEKDAY_SHORT_LABELS_MON_FIRST.map((label) => (
          <div
            key={label}
            className="px-2 text-center text-xs font-semibold tracking-wide text-zinc-500 uppercase"
          >
            {label}
          </div>
        ))}
        {weeks.map((week) =>
          week.map((dayKey) => {
            const inMonth = parseDateKey(dayKey).getMonth() === currentMonth;
            const dayAppointments = byDay.get(dayKey) ?? [];
            const isToday = dayKey === todayKey;
            return (
              <Link
                key={dayKey}
                href={hrefFor("day", dayKey)}
                className={cn(
                  "flex min-h-[92px] flex-col gap-1 rounded-lg border border-zinc-100 p-2 text-left hover:border-zinc-300",
                  !inMonth && "bg-zinc-50 opacity-50",
                  isToday && "border-zinc-900",
                )}
              >
                <span
                  className={cn(
                    "text-xs font-semibold",
                    isToday ? "text-zinc-900" : "text-zinc-500",
                  )}
                >
                  {Number(dayKey.slice(8, 10))}
                </span>
                <div className="flex flex-col gap-0.5">
                  {dayAppointments.slice(0, MAX_CHIPS_PER_DAY).map((appt) => (
                    <span
                      key={appt.id}
                      className="truncate rounded bg-zinc-100 px-1 py-0.5 text-[11px] text-zinc-700"
                    >
                      {appt.customer?.name ?? "Cliente"}
                    </span>
                  ))}
                  {dayAppointments.length > MAX_CHIPS_PER_DAY && (
                    <span className="text-[11px] text-zinc-400">
                      +{dayAppointments.length - MAX_CHIPS_PER_DAY} mais
                    </span>
                  )}
                </div>
              </Link>
            );
          }),
        )}
      </div>
    </Card>
  );
}

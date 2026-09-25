import Link from "next/link";
import { getCurrentBusiness } from "@/lib/auth";
import { fetchAppointmentsWithRelations } from "@/lib/appointments-data";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import {
  addDays,
  addMonths,
  daysInMonth,
  isValidDateKey,
  rangeISO,
  startOfMonthKey,
  startOfWeekKey,
  todayKeyInTimeZone,
} from "@/lib/date-utils";
import { DayView } from "./day-view";
import { WeekView } from "./week-view";
import { MonthView } from "./month-view";
import { ProfessionalFilter } from "./professional-filter";

type View = "day" | "week" | "month";

const VIEW_LABELS: Record<View, string> = {
  day: "Dia",
  week: "Semana",
  month: "Mês",
};

const MONTH_LABEL_FORMATTER = new Intl.DateTimeFormat("pt-BR", {
  month: "long",
  year: "numeric",
});
const DAY_LABEL_FORMATTER = new Intl.DateTimeFormat("pt-BR", {
  weekday: "long",
  day: "2-digit",
  month: "long",
});

export default async function AgendaPage(props: {
  searchParams: Promise<{
    view?: string;
    date?: string;
    professional?: string;
  }>;
}) {
  const searchParams = await props.searchParams;
  const view: View =
    searchParams.view === "week" || searchParams.view === "month"
      ? searchParams.view
      : "day";
  const professionalId = searchParams.professional || undefined;

  const { supabase, business } = await getCurrentBusiness();

  const dateKey = isValidDateKey(searchParams.date)
    ? searchParams.date
    : todayKeyInTimeZone(business.timezone);

  const { data: professionals } = await supabase
    .from("professionals")
    .select("*")
    .eq("business_id", business.id)
    .order("position", { ascending: true });

  const selectedProfessional = professionalId
    ? (professionals ?? []).find((p) => p.id === professionalId)
    : undefined;

  let rangeStartKey = dateKey;
  let rangeEndKey = dateKey;
  if (view === "week") {
    rangeStartKey = startOfWeekKey(dateKey);
    rangeEndKey = addDays(rangeStartKey, 6);
  } else if (view === "month") {
    rangeStartKey = startOfMonthKey(dateKey);
    rangeEndKey = addDays(rangeStartKey, daysInMonth(dateKey) - 1);
  }

  const { fromISO, toISO } = rangeISO(
    rangeStartKey,
    rangeEndKey,
    business.timezone,
  );

  const appointments = await fetchAppointmentsWithRelations(
    supabase,
    business.id,
    { fromISO, toISO, professionalId, excludeStatuses: ["cancelled"] },
  );

  function hrefFor(nextView: View, nextDate: string) {
    const params = new URLSearchParams();
    params.set("view", nextView);
    params.set("date", nextDate);
    if (professionalId) params.set("professional", professionalId);
    return `/dashboard/agenda?${params.toString()}`;
  }

  const prevDate =
    view === "day"
      ? addDays(dateKey, -1)
      : view === "week"
        ? addDays(dateKey, -7)
        : addMonths(dateKey, -1);
  const nextDate =
    view === "day"
      ? addDays(dateKey, 1)
      : view === "week"
        ? addDays(dateKey, 7)
        : addMonths(dateKey, 1);
  const todayKey = todayKeyInTimeZone(business.timezone);

  const rangeLabel =
    view === "month"
      ? MONTH_LABEL_FORMATTER.format(new Date(`${rangeStartKey}T12:00:00`))
      : view === "week"
        ? `${new Date(`${rangeStartKey}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} – ${new Date(`${rangeEndKey}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}`
        : DAY_LABEL_FORMATTER.format(new Date(`${dateKey}T12:00:00`));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900">Agenda</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Visualize os agendamentos por dia, semana ou mês. Para uma lista com
          filtros e busca, use{" "}
          <Link href="/dashboard/appointments" className="underline">
            Agendamentos
          </Link>
          .
        </p>
      </div>

      <Card className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-1 rounded-lg bg-zinc-100 p-1">
            {(Object.keys(VIEW_LABELS) as View[]).map((v) => (
              <Link
                key={v}
                href={hrefFor(v, dateKey)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium",
                  view === v
                    ? "bg-white text-zinc-900 shadow-sm"
                    : "text-zinc-500 hover:text-zinc-900",
                )}
              >
                {VIEW_LABELS[v]}
              </Link>
            ))}
          </div>
          <ProfessionalFilter
            professionals={professionals ?? []}
            defaultValue={professionalId ?? ""}
            view={view}
            date={dateKey}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Link href={hrefFor(view, prevDate)}>
            <Button variant="secondary">Anterior</Button>
          </Link>
          <span className="text-sm font-medium whitespace-nowrap text-zinc-700 capitalize">
            {rangeLabel}
          </span>
          <Link href={hrefFor(view, nextDate)}>
            <Button variant="secondary">Próximo</Button>
          </Link>
          {dateKey !== todayKey && (
            <Link
              href={hrefFor(view, todayKey)}
              className="text-sm text-zinc-500 hover:underline"
            >
              Hoje
            </Link>
          )}
        </div>
      </Card>

      {selectedProfessional && (
        <p className="text-sm text-zinc-500">
          Filtrando por: <strong>{selectedProfessional.name}</strong> ·{" "}
          <Link href={hrefFor(view, dateKey)} className="underline">
            limpar filtro
          </Link>
        </p>
      )}

      {view === "day" && (
        <DayView appointments={appointments} timezone={business.timezone} />
      )}
      {view === "week" && (
        <WeekView
          appointments={appointments}
          timezone={business.timezone}
          startKey={rangeStartKey}
        />
      )}
      {view === "month" && (
        <MonthView
          appointments={appointments}
          timezone={business.timezone}
          monthStartKey={rangeStartKey}
          hrefFor={hrefFor}
        />
      )}
    </div>
  );
}

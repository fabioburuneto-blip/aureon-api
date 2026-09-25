import { getCurrentBusiness } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { ConfirmSubmitButton } from "@/components/ui/confirm-submit-button";
import { formatDateTime } from "@/lib/format";
import { NewBlockedTimeForm } from "./new-blocked-time-form";
import { deleteBlockedTime } from "./actions";

export default async function BlockedTimesPage() {
  const { supabase, business } = await getCurrentBusiness();

  const [{ data: blockedTimeRows }, { data: professionals }] =
    await Promise.all([
      supabase
        .from("blocked_times")
        .select("*")
        .eq("business_id", business.id)
        .order("starts_at", { ascending: true }),
      supabase.from("professionals").select("*").eq("business_id", business.id),
    ]);

  const professionalById = new Map((professionals ?? []).map((p) => [p.id, p]));
  const blockedTimes = (blockedTimeRows ?? []).map((bt) => ({
    ...bt,
    professionals: bt.professional_id
      ? (professionalById.get(bt.professional_id) ?? null)
      : null,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900">
          Bloqueios e folgas
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Bloqueie horários para férias, feriados ou pausas. Bloqueios não
          aparecem como horários disponíveis na página pública.
        </p>
      </div>

      <Card>
        <h2 className="mb-3 font-medium text-zinc-900">Novo bloqueio</h2>
        <NewBlockedTimeForm professionals={professionals ?? []} />
      </Card>

      <Card>
        <h2 className="font-medium text-zinc-900">Bloqueios cadastrados</h2>
        {blockedTimes.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">
            Nenhum bloqueio cadastrado.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {blockedTimes.map((bt) => (
              <li
                key={bt.id}
                className="flex items-center justify-between gap-4 py-4"
              >
                <div>
                  <p className="font-medium text-zinc-900">
                    {formatDateTime(bt.starts_at, business.timezone)} —{" "}
                    {formatDateTime(bt.ends_at, business.timezone)}
                  </p>
                  <p className="text-sm text-zinc-500">
                    {bt.professionals?.name ?? "Toda a empresa"}
                    {bt.reason ? ` · ${bt.reason}` : ""}
                  </p>
                </div>
                <form action={deleteBlockedTime}>
                  <input type="hidden" name="id" value={bt.id} />
                  <ConfirmSubmitButton confirmMessage="Remover este bloqueio? O horário volta a ficar disponível.">
                    Remover
                  </ConfirmSubmitButton>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

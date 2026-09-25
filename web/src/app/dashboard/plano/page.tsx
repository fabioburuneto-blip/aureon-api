import { getCurrentBusiness } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmSubmitButton } from "@/components/ui/confirm-submit-button";
import { cn } from "@/lib/cn";
import { formatDateTime, formatPriceCents } from "@/lib/format";
import { DEFAULT_PLAN_ID, getPlan, PLAN_IDS, PLANS } from "@/lib/plans/config";
import type { SubscriptionStatus } from "@/types/database";
import { startCheckoutAction, cancelSubscriptionAction } from "./actions";

const STATUS_LABELS: Record<SubscriptionStatus, string> = {
  trialing: "Em período de teste",
  active: "Ativa",
  past_due: "Pagamento pendente",
  canceled: "Cancelada",
  incomplete: "Incompleta",
};

const STATUS_STYLES: Record<SubscriptionStatus, string> = {
  trialing: "bg-amber-100 text-amber-700",
  active: "bg-emerald-100 text-emerald-700",
  past_due: "bg-red-100 text-red-700",
  canceled: "bg-zinc-100 text-zinc-500",
  incomplete: "bg-zinc-100 text-zinc-500",
};

export default async function PlanoPage() {
  const { supabase, business, role } = await getCurrentBusiness();

  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("business_id", business.id)
    .maybeSingle();

  const currentPlan = getPlan(subscription?.plan_id ?? DEFAULT_PLAN_ID);
  const status = subscription?.status ?? "incomplete";
  const isCancelable = !!subscription && status !== "canceled";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900">Plano e assinatura</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Escolha o plano ideal para o tamanho do seu negócio.
        </p>
      </div>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm text-zinc-500">Plano atual</p>
            <p className="text-xl font-semibold text-zinc-900">{currentPlan.name}</p>
          </div>
          <span
            className={cn(
              "rounded-full px-3 py-1 text-sm font-medium",
              STATUS_STYLES[status],
            )}
          >
            {STATUS_LABELS[status]}
          </span>
        </div>

        {subscription?.current_period_end && (
          <p className="mt-3 text-sm text-zinc-500">
            {status === "trialing" ? "Teste termina em " : "Renova em "}
            {formatDateTime(subscription.current_period_end, business.timezone)}
            {subscription.cancel_at_period_end &&
              " · a assinatura será cancelada ao final deste período"}
          </p>
        )}

        <p className="mt-1 text-xs text-zinc-400">
          Cobrança:{" "}
          {subscription?.provider === "local"
            ? "modo local/desenvolvimento (sem cobrança real)"
            : (subscription?.provider ?? "não configurada")}
        </p>

        {role === "owner" && isCancelable && (
          <form action={cancelSubscriptionAction} className="mt-4">
            <ConfirmSubmitButton
              confirmMessage="Cancelar a assinatura? Você pode escolher um plano novamente a qualquer momento."
              className="rounded-lg border border-red-200 px-4 py-2"
            >
              Cancelar assinatura
            </ConfirmSubmitButton>
          </form>
        )}
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        {PLAN_IDS.map((id) => {
          const plan = PLANS[id];
          const isCurrent = plan.id === currentPlan.id && status !== "canceled";

          return (
            <Card
              key={id}
              className={cn("flex flex-col", isCurrent && "border-zinc-900")}
            >
              <p className="text-lg font-semibold text-zinc-900">{plan.name}</p>
              <p className="mt-1 text-sm text-zinc-500">{plan.description}</p>
              <p className="mt-4 text-2xl font-semibold text-zinc-900">
                {formatPriceCents(plan.priceCents)}
                <span className="text-sm font-normal text-zinc-500">/mês</span>
              </p>
              <ul className="mt-4 flex flex-1 flex-col gap-1.5 text-sm text-zinc-600">
                {plan.highlights.map((highlight) => (
                  <li key={highlight} className="flex items-start gap-2">
                    <span className="text-emerald-600">✓</span>
                    {highlight}
                  </li>
                ))}
              </ul>

              {role === "owner" &&
                (isCurrent ? (
                  <Button variant="secondary" disabled className="mt-6 w-full">
                    Plano atual
                  </Button>
                ) : (
                  <form action={startCheckoutAction} className="mt-6">
                    <input type="hidden" name="plan_id" value={plan.id} />
                    <Button type="submit" className="w-full">
                      Escolher {plan.name}
                    </Button>
                  </form>
                ))}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

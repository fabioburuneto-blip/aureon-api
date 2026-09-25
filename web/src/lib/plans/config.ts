/**
 * The single source of truth for every plan's price, limits and features.
 * Nothing about a plan is ever hardcoded in a component or a server
 * action -- they all read from here. Changing a limit or a price is a
 * one-line change in this file, not a hunt across the UI.
 *
 * `id` doubles as the value stored in `subscriptions.plan_id` (plain text
 * in the database, validated against PLAN_IDS at the application layer --
 * see supabase/migrations/20250924120008_billing.sql for why it isn't a
 * hard Postgres enum).
 */

export const PLAN_IDS = ["start", "pro", "business"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

/** Gates that other parts of the app check with canUseFeature() (see
 * src/lib/plans/limits.ts) instead of hardcoding "is this business on
 * pro or above?" checks inline. */
export type PlanFeatureKey =
  | "custom_public_page"
  | "agenda"
  | "services"
  | "customers"
  | "advanced_notifications"
  | "custom_domain"
  | "multiple_locations";

export interface PlanLimits {
  /** `null` means unlimited. */
  maxProfessionals: number | null;
  maxServices: number | null;
}

export interface PlanDefinition {
  id: PlanId;
  name: string;
  description: string;
  /** Monthly price in BRL cents -- the only place a price is defined. */
  priceCents: number;
  trialDays: number;
  limits: PlanLimits;
  features: PlanFeatureKey[];
  /** Marketing bullet points for the plan comparison UI. */
  highlights: string[];
}

export const PLANS: Record<PlanId, PlanDefinition> = {
  start: {
    id: "start",
    name: "Start",
    description: "Para quem está começando a organizar a agenda.",
    priceCents: 4990,
    trialDays: 14,
    limits: { maxProfessionals: 1, maxServices: 10 },
    features: ["custom_public_page", "agenda", "services", "customers"],
    highlights: [
      "1 profissional",
      "Página pública personalizada",
      "Agenda e agendamentos",
      "Serviços e clientes",
    ],
  },
  pro: {
    id: "pro",
    name: "Pro",
    description: "Para equipes em crescimento com mais de um profissional.",
    priceCents: 9990,
    trialDays: 14,
    limits: { maxProfessionals: 5, maxServices: 50 },
    features: [
      "custom_public_page",
      "agenda",
      "services",
      "customers",
      "advanced_notifications",
    ],
    highlights: [
      "Até 5 profissionais",
      "Notificações por WhatsApp e e-mail",
      "Tudo do plano Start",
    ],
  },
  business: {
    id: "business",
    name: "Business",
    description: "Para negócios com múltiplas unidades ou marca própria.",
    priceCents: 19990,
    trialDays: 14,
    limits: { maxProfessionals: null, maxServices: null },
    features: [
      "custom_public_page",
      "agenda",
      "services",
      "customers",
      "advanced_notifications",
      "custom_domain",
      "multiple_locations",
    ],
    highlights: [
      "Profissionais ilimitados",
      "Domínio próprio",
      "Múltiplas unidades (em breve)",
      "Tudo do plano Pro",
    ],
  },
};

export const DEFAULT_PLAN_ID: PlanId = "start";

export function isValidPlanId(value: string): value is PlanId {
  return (PLAN_IDS as readonly string[]).includes(value);
}

/** Never throws -- an unknown/legacy plan_id degrades to the default plan
 * instead of crashing a page that reads it (fail open, per the product
 * requirement that billing must never block the app). */
export function getPlan(planId: string): PlanDefinition {
  return isValidPlanId(planId) ? PLANS[planId] : PLANS[DEFAULT_PLAN_ID];
}

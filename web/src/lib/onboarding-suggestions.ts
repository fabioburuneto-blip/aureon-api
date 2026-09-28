import type { businessSegments } from "@/lib/validations";

export interface SuggestedService {
  name: string;
  duration_minutes: number;
  price: number;
}

/** Pre-fills the onboarding wizard's serviços step so a new owner isn't
 * staring at a blank form -- every suggestion stays fully editable
 * (name/price/duration) and removable before it's ever saved. */
export const SUGGESTED_SERVICES: Record<
  (typeof businessSegments)[number],
  SuggestedService[]
> = {
  barbershop: [
    { name: "Corte", duration_minutes: 30, price: 40 },
    { name: "Barba", duration_minutes: 20, price: 30 },
    { name: "Corte + Barba", duration_minutes: 50, price: 65 },
  ],
  hair_salon: [
    { name: "Corte", duration_minutes: 45, price: 60 },
    { name: "Escova", duration_minutes: 40, price: 50 },
    { name: "Coloração", duration_minutes: 90, price: 150 },
  ],
  nails: [
    { name: "Manicure", duration_minutes: 40, price: 35 },
    { name: "Pedicure", duration_minutes: 45, price: 40 },
    { name: "Manicure + Pedicure", duration_minutes: 80, price: 65 },
  ],
  aesthetics: [
    { name: "Limpeza de pele", duration_minutes: 60, price: 120 },
    { name: "Massagem relaxante", duration_minutes: 50, price: 100 },
    { name: "Design de sobrancelhas", duration_minutes: 30, price: 45 },
  ],
  tattoo: [
    { name: "Sessão pequena", duration_minutes: 60, price: 150 },
    { name: "Sessão média", duration_minutes: 120, price: 350 },
    { name: "Sessão grande", duration_minutes: 240, price: 700 },
  ],
  massage: [
    { name: "Massagem relaxante", duration_minutes: 60, price: 130 },
    { name: "Massagem terapêutica", duration_minutes: 50, price: 140 },
    { name: "Drenagem linfática", duration_minutes: 60, price: 150 },
  ],
  personal_trainer: [
    { name: "Avaliação física", duration_minutes: 60, price: 100 },
    { name: "Sessão individual", duration_minutes: 60, price: 90 },
    { name: "Sessão em dupla", duration_minutes: 60, price: 130 },
  ],
  other: [],
};

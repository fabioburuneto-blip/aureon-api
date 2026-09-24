import { getCurrentBusiness } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { HoursForm } from "./hours-form";

export default async function HoursPage() {
  const { supabase, business } = await getCurrentBusiness();

  const { data: hours } = await supabase
    .from("business_hours")
    .select("*")
    .eq("business_id", business.id);

  const hoursByDay = new Map((hours ?? []).map((h) => [h.day_of_week, h]));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900">
          Horários de funcionamento
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Define quando sua empresa aceita agendamentos. Profissionais podem ter
          horários próprios em casos específicos.
        </p>
      </div>

      <Card>
        <HoursForm hoursByDay={hoursByDay} />
      </Card>
    </div>
  );
}

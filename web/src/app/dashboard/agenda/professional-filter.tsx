"use client";

import { Select } from "@/components/ui/input";
import type { Database } from "@/types/database";

type Professional = Database["public"]["Tables"]["professionals"]["Row"];

export function ProfessionalFilter({
  professionals,
  defaultValue,
  view,
  date,
}: {
  professionals: Professional[];
  defaultValue: string;
  view: string;
  date: string;
}) {
  return (
    <form method="GET" className="flex items-center gap-2">
      <input type="hidden" name="view" value={view} />
      <input type="hidden" name="date" value={date} />
      <Select
        name="professional"
        defaultValue={defaultValue}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
        aria-label="Filtrar por profissional"
        className="w-auto"
      >
        <option value="">Todos os profissionais</option>
        {professionals.map((professional) => (
          <option key={professional.id} value={professional.id}>
            {professional.name}
          </option>
        ))}
      </Select>
    </form>
  );
}

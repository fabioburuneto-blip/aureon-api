"use client";

import { Input, Select, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { Database } from "@/types/database";

type Professional = Database["public"]["Tables"]["professionals"]["Row"];

const statusOptions = [
  { value: "", label: "Todos os status" },
  { value: "pending", label: "Pendente" },
  { value: "confirmed", label: "Confirmado" },
  { value: "completed", label: "Concluído" },
  { value: "cancelled", label: "Cancelado" },
  { value: "no_show", label: "Não compareceu" },
];

const rangeOptions = [
  { value: "upcoming", label: "Próximos" },
  { value: "past", label: "Anteriores" },
  { value: "all", label: "Todos" },
];

function autoSubmit(event: React.ChangeEvent<HTMLSelectElement>) {
  event.currentTarget.form?.requestSubmit();
}

export function AppointmentFilters({
  professionals,
  defaultValues,
}: {
  professionals: Professional[];
  defaultValues: {
    status: string;
    professional: string;
    range: string;
    q: string;
  };
}) {
  return (
    <form
      method="GET"
      className="flex flex-wrap items-end gap-3"
      aria-label="Filtrar agendamentos"
    >
      <div>
        <Label htmlFor="filter-status">Status</Label>
        <Select
          id="filter-status"
          name="status"
          defaultValue={defaultValues.status}
          onChange={autoSubmit}
        >
          {statusOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="filter-professional">Profissional</Label>
        <Select
          id="filter-professional"
          name="professional"
          defaultValue={defaultValues.professional}
          onChange={autoSubmit}
        >
          <option value="">Todos</option>
          {professionals.map((professional) => (
            <option key={professional.id} value={professional.id}>
              {professional.name}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="filter-range">Período</Label>
        <Select
          id="filter-range"
          name="range"
          defaultValue={defaultValues.range}
          onChange={autoSubmit}
        >
          {rangeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="min-w-[200px] flex-1">
        <Label htmlFor="filter-q">Buscar cliente</Label>
        <Input
          id="filter-q"
          name="q"
          defaultValue={defaultValues.q}
          placeholder="Nome ou telefone"
        />
      </div>
      <Button type="submit" variant="secondary">
        Filtrar
      </Button>
    </form>
  );
}

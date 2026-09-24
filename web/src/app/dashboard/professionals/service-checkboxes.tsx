import type { Database } from "@/types/database";

type Service = Database["public"]["Tables"]["services"]["Row"];

export function ServiceCheckboxes({
  idPrefix,
  services,
  selectedIds,
}: {
  idPrefix: string;
  services: Service[];
  selectedIds: string[];
}) {
  if (services.length === 0) {
    return (
      <p className="text-sm text-zinc-500">Cadastre um serviço primeiro.</p>
    );
  }

  return (
    <div className="flex flex-wrap gap-3">
      {services.map((service) => (
        <label
          key={service.id}
          htmlFor={`${idPrefix}-${service.id}`}
          className="flex items-center gap-1.5 text-sm text-zinc-700"
        >
          <input
            id={`${idPrefix}-${service.id}`}
            type="checkbox"
            name="service_ids"
            value={service.id}
            defaultChecked={selectedIds.includes(service.id)}
          />
          {service.name}
        </label>
      ))}
    </div>
  );
}

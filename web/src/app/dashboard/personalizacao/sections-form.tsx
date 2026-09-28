"use client";

import { useState, useTransition } from "react";
import { cn } from "@/lib/cn";
import {
  SECTION_LABELS,
  isSectionLocked,
  isSectionPositionLocked,
  reorderSection,
  toggleSection,
} from "@/lib/sections";
import { updateSectionsConfig } from "./actions";
import type { PublicPageSectionConfig } from "@/types/database";

export function SectionsForm({
  initialSections,
}: {
  initialSections: PublicPageSectionConfig[];
}) {
  const [sections, setSections] = useState(initialSections);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function persist(next: PublicPageSectionConfig[]) {
    const previous = sections;
    setSections(next);
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateSectionsConfig(next);
      if (result?.error) {
        setError(result.error);
        setSections(previous);
      } else {
        setSaved(true);
      }
    });
  }

  return (
    <div>
      <ul className="flex flex-col gap-2">
        {sections.map((section, index) => {
          const locked = isSectionLocked(section.key);
          const positionLocked = isSectionPositionLocked(section.key);
          return (
            <li
              key={section.key}
              className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 px-3 py-2"
            >
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-zinc-900">
                  {SECTION_LABELS[section.key]}
                </span>
                {locked && (
                  <span className="text-xs text-zinc-400">sempre visível</span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                {!positionLocked && (
                  <>
                    <button
                      type="button"
                      disabled={isPending || index <= 1}
                      onClick={() => persist(reorderSection(sections, section.key, "up"))}
                      className="rounded border border-zinc-200 px-2 py-1 text-xs text-zinc-600 disabled:opacity-30"
                      aria-label={`Mover ${SECTION_LABELS[section.key]} para cima`}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      disabled={isPending || index >= sections.length - 2}
                      onClick={() => persist(reorderSection(sections, section.key, "down"))}
                      className="rounded border border-zinc-200 px-2 py-1 text-xs text-zinc-600 disabled:opacity-30"
                      aria-label={`Mover ${SECTION_LABELS[section.key]} para baixo`}
                    >
                      ↓
                    </button>
                  </>
                )}
                <button
                  type="button"
                  disabled={isPending || locked}
                  onClick={() => persist(toggleSection(sections, section.key))}
                  className={cn(
                    "ml-2 rounded-full px-3 py-1 text-xs font-medium",
                    section.visible
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-zinc-100 text-zinc-500",
                    (isPending || locked) && "opacity-50",
                  )}
                >
                  {section.visible ? "Visível" : "Oculta"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {saved && !error && <p className="mt-3 text-sm text-emerald-600">Seções salvas.</p>}
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { cn } from "@/lib/cn";
import { THEME_PRESET_KEYS, THEME_PRESETS } from "@/lib/theme-presets";
import { updateThemePreset } from "./actions";
import type { ThemePreset } from "@/types/database";

export function PresetPicker({ currentPreset }: { currentPreset: ThemePreset }) {
  const [selected, setSelected] = useState(currentPreset);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function handleSelect(preset: ThemePreset) {
    if (preset === selected) return;
    setError(null);
    setSaved(false);
    setSelected(preset);
    startTransition(async () => {
      const result = await updateThemePreset(preset);
      if (result?.error) {
        setError(result.error);
        setSelected(currentPreset);
      } else {
        setSaved(true);
      }
    });
  }

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {THEME_PRESET_KEYS.map((key) => {
          const tokens = THEME_PRESETS[key];
          const isSelected = selected === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => handleSelect(key)}
              disabled={isPending}
              className={cn(
                "flex flex-col gap-2 rounded-xl border p-4 text-left transition-colors",
                isSelected
                  ? "border-zinc-900 ring-1 ring-zinc-900"
                  : "border-zinc-200 hover:border-zinc-400",
              )}
            >
              <div className="flex items-center justify-between">
                <span className={cn(tokens.fontHeading, tokens.headingWeight, "text-sm text-zinc-900")}>
                  {tokens.label}
                </span>
                {isSelected && (
                  <span className="text-xs font-medium text-emerald-600">Selecionado</span>
                )}
              </div>
              <p className="text-xs text-zinc-500">{tokens.description}</p>
              <div className="mt-1 flex items-center gap-1.5">
                <span className={cn("h-4 w-4 border border-zinc-300", tokens.radiusClass)} />
                <span className="text-[11px] uppercase tracking-wide text-zinc-400">
                  {tokens.heroVariant}
                </span>
              </div>
            </button>
          );
        })}
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {saved && !error && <p className="mt-3 text-sm text-emerald-600">Tema salvo.</p>}
    </div>
  );
}

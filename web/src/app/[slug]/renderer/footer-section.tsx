import type { ThemeTokens } from "@/lib/theme-presets";

export function FooterSection({ tokens }: { tokens: ThemeTokens }) {
  return (
    <footer className={`mt-4 ${tokens.dividerClassName} py-6`}>
      <p className="text-center text-sm text-zinc-400">Agenda por Aureon Agenda</p>
    </footer>
  );
}

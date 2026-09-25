"use client";

import { useEffect } from "react";

/**
 * Last-resort fallback for an error the root layout itself can't render
 * around (e.g. a crash while rendering app/layout.tsx). Must define its
 * own <html>/<body> -- it replaces the root layout, not just its
 * children. Deliberately minimal: no shared components, since those are
 * exactly what might have just failed to render.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="pt-BR">
      <body>
        <div
          style={{
            display: "flex",
            minHeight: "100vh",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "1rem",
            padding: "1.5rem",
            textAlign: "center",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <h1 style={{ fontSize: "1.25rem", fontWeight: 600, color: "#18181b" }}>
            Algo deu errado
          </h1>
          <p style={{ maxWidth: "24rem", fontSize: "0.875rem", color: "#71717a" }}>
            Não foi possível carregar a página. Tente novamente em instantes.
          </p>
          <button
            onClick={() => retry()}
            style={{
              borderRadius: "0.5rem",
              backgroundColor: "#18181b",
              color: "#fff",
              padding: "0.5rem 1rem",
              fontSize: "0.875rem",
              fontWeight: 500,
            }}
          >
            Tentar novamente
          </button>
        </div>
      </body>
    </html>
  );
}

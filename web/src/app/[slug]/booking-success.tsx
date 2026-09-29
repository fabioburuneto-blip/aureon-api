"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { formatDateLong, formatDuration, formatPriceCents, formatTime } from "@/lib/format";
import { buildIcsDataUrl } from "@/lib/ics";

export function BookingSuccess({
  businessName,
  serviceName,
  professionalName,
  durationMinutes,
  priceCents,
  startsAtIso,
  endsAtIso,
  timezone,
  clientToken,
  previewMode,
}: {
  businessName: string;
  serviceName: string;
  professionalName: string;
  durationMinutes: number;
  priceCents: number;
  startsAtIso: string;
  endsAtIso: string;
  timezone: string;
  clientToken: string | null;
  previewMode?: boolean;
}) {
  const [shareState, setShareState] = useState<"idle" | "copied">("idle");
  const manageUrl = clientToken ? `/agendamento/${clientToken}` : null;

  const icsUrl = buildIcsDataUrl({
    title: `${serviceName} - ${businessName}`,
    description: `Agendamento com ${professionalName} em ${businessName}.`,
    startsAtIso,
    endsAtIso,
  });

  async function handleShare() {
    const shareText = `Meu agendamento em ${businessName}: ${serviceName}, ${formatDateLong(startsAtIso, timezone)} às ${formatTime(startsAtIso, timezone)}.`;
    const shareUrl = manageUrl
      ? `${window.location.origin}${manageUrl}`
      : window.location.href;

    if (navigator.share) {
      try {
        await navigator.share({ title: businessName, text: shareText, url: shareUrl });
        return;
      } catch {
        // User cancelled the native share sheet -- fall through to clipboard.
      }
    }

    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareState("copied");
      setTimeout(() => setShareState("idle"), 2000);
    } catch {
      // Clipboard unavailable (e.g. insecure context) -- nothing else to do.
    }
  }

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6">
      <h3 className="text-lg font-medium text-emerald-900">
        {previewMode ? "Pré-visualização do agendamento" : "Agendamento confirmado!"}
      </h3>

      <dl className="mt-4 flex flex-col gap-1.5 text-sm text-emerald-900">
        <div className="flex justify-between gap-3">
          <dt className="text-emerald-700">Empresa</dt>
          <dd className="font-medium">{businessName}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-emerald-700">Serviço</dt>
          <dd className="font-medium">{serviceName}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-emerald-700">Profissional</dt>
          <dd className="font-medium">{professionalName}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-emerald-700">Data</dt>
          <dd className="font-medium">{formatDateLong(startsAtIso, timezone)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-emerald-700">Horário</dt>
          <dd className="font-medium">{formatTime(startsAtIso, timezone)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-emerald-700">Duração</dt>
          <dd className="font-medium">{formatDuration(durationMinutes)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-emerald-700">Preço</dt>
          <dd className="font-medium">{formatPriceCents(priceCents)}</dd>
        </div>
      </dl>

      {previewMode ? (
        <p className="mt-4 text-sm text-emerald-700">
          Nenhum agendamento real foi criado -- isto é só uma prévia de como a
          confirmação aparece para o cliente.
        </p>
      ) : (
        <p className="mt-4 text-sm text-emerald-700">
          Você receberá a confirmação diretamente com a empresa.
        </p>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        <a href={icsUrl} download="agendamento.ics">
          <Button type="button" variant="secondary" className="h-9">
            Adicionar ao calendário
          </Button>
        </a>
        <Button type="button" variant="secondary" className="h-9" onClick={handleShare}>
          {shareState === "copied" ? "Link copiado!" : "Compartilhar"}
        </Button>
      </div>

      {manageUrl && (
        <div className="mt-4 border-t border-emerald-200 pt-4">
          <p className="text-sm text-emerald-800">
            Guarde este link para consultar, cancelar ou reagendar depois:
          </p>
          <Link
            href={manageUrl}
            className="mt-1 inline-block text-sm font-medium underline text-emerald-900"
          >
            Gerenciar meu agendamento
          </Link>
        </div>
      )}
    </div>
  );
}

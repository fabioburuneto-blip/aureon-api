import { createPublicClient } from "@/lib/supabase/public";
import { checkRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-ip";
import { AppointmentPortal } from "./appointment-portal";
import type { Metadata } from "next";

// Never indexed -- this page shows one specific customer's appointment
// behind an unguessable token, not public storefront content like
// /[slug]. Always dynamic (no revalidate export): a stale cached "can
// cancel" state served past the cancellation cutoff would be wrong, and
// this route is never linked from anywhere crawlable, so there's no
// traffic/caching benefit to weigh against that correctness risk.
export function generateMetadata(): Metadata {
  return { robots: { index: false, follow: false } };
}

const READ_LIMIT = 30;
const READ_WINDOW_MS = 10 * 60 * 1000;

export default async function AppointmentTokenPage(props: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await props.params;

  const ip = await getClientIp();
  const withinLimit = checkRateLimit(`lookup:${ip}`, READ_LIMIT, READ_WINDOW_MS);

  if (!withinLimit) {
    return (
      <NoticeCard message="Muitas tentativas. Tente novamente em alguns minutos." />
    );
  }

  const supabase = createPublicClient();
  const { data, error } = await supabase.rpc("get_public_appointment", {
    p_token: token,
  });

  // Same generic message regardless of *why* the lookup failed --
  // malformed token, well-formed but unknown token, or any other
  // database error -- never a message that lets a caller distinguish
  // those cases from one another.
  if (error || !data || data.length === 0) {
    return (
      <NoticeCard message="Este link de agendamento não é válido ou expirou." />
    );
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 py-10">
      <AppointmentPortal appointment={data[0]!} token={token} />
    </div>
  );
}

function NoticeCard({ message }: { message: string }) {
  return (
    <div className="mx-auto w-full max-w-md px-4 py-10">
      <div className="rounded-xl border border-zinc-200 p-6 text-center">
        <p className="text-sm text-zinc-600">{message}</p>
      </div>
    </div>
  );
}

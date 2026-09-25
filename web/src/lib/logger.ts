type LogContext = Record<string, string | number | boolean | null | undefined>;

type SupabaseLikeError = {
  message?: unknown;
  code?: unknown;
  // Deliberately not read: Postgres constraint-violation errors put the
  // actual offending value in `details` (e.g. `Key (phone)=(+5511...)
  // already exists`), not in `message`. Logging `.details`/`.hint` would
  // leak customer PII into server logs -- only `.message` and `.code` are
  // ever safe to write out.
};

/**
 * Structured, PII-free server-side error logging. Vercel captures
 * stdout/stderr as log entries automatically -- no external logging
 * service is wired in yet (see docs/DEPLOY.md "Observabilidade" for the
 * upgrade path to one). `context` must only ever carry ids/codes/booleans
 * (business_id, appointment_id, provider, http_status, ...), never a
 * customer's name/phone/email/notes.
 */
export function logError(event: string, context: LogContext, error?: unknown): void {
  console.error(
    JSON.stringify({
      level: "error",
      event,
      ...context,
      ...describeError(error),
      timestamp: new Date().toISOString(),
    }),
  );
}

function describeError(error: unknown): { error_message?: string; error_code?: string } {
  if (error instanceof Error) {
    return { error_message: error.message };
  }
  if (error && typeof error === "object") {
    const { message, code } = error as SupabaseLikeError;
    return {
      error_message: typeof message === "string" ? message : undefined,
      error_code: typeof code === "string" ? code : undefined,
    };
  }
  if (typeof error === "string") return { error_message: error };
  return {};
}

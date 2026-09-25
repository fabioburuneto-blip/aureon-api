"use client";

import { cn } from "@/lib/cn";
import type { ButtonHTMLAttributes } from "react";

/**
 * Drop-in replacement for a plain <button type="submit"> inside a
 * server-action <form> when the action is destructive. Blocks the native
 * submit with a confirm() prompt -- no client state needed, so it still
 * works with forms bound directly to a server action.
 */
export function ConfirmSubmitButton({
  confirmMessage,
  className,
  tone = "danger",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  confirmMessage: string;
  tone?: "danger" | "muted";
}) {
  return (
    <button
      type="submit"
      className={cn(
        "text-sm font-medium",
        tone === "danger"
          ? "text-red-600 hover:text-red-700"
          : "text-zinc-600 hover:text-zinc-900",
        className,
      )}
      onClick={(event) => {
        if (!window.confirm(confirmMessage)) {
          event.preventDefault();
        }
      }}
      {...props}
    />
  );
}

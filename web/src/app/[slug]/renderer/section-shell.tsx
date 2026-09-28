import type { ReactNode } from "react";
import Image from "next/image";
import { cn } from "@/lib/cn";
import type { ThemeTokens } from "@/lib/theme-presets";

export function SectionShell({
  tokens,
  id,
  className,
  children,
  fullBleed = false,
}: {
  tokens: ThemeTokens;
  id?: string;
  className?: string;
  children: ReactNode;
  fullBleed?: boolean;
}) {
  return (
    <section
      id={id}
      className={cn(tokens.sectionPaddingClassName, fullBleed ? "w-full" : undefined, className)}
    >
      <div
        className={cn(
          fullBleed ? "w-full" : `mx-auto w-full px-4 ${tokens.containerWidthClassName}`,
        )}
      >
        {children}
      </div>
    </section>
  );
}

export function SectionHeading({
  tokens,
  eyebrow,
  title,
  align = "left",
}: {
  tokens: ThemeTokens;
  eyebrow?: string;
  title: string;
  align?: "left" | "center";
}) {
  return (
    <div className={cn("mb-6", align === "center" && "text-center")}>
      {eyebrow && <p className={tokens.eyebrowClassName}>{eyebrow}</p>}
      <h2
        className={cn(
          tokens.fontHeading,
          tokens.headingWeight,
          tokens.headingTracking,
          tokens.headingTransform,
          "mt-1 text-2xl text-zinc-900 sm:text-3xl",
        )}
      >
        {title}
      </h2>
    </div>
  );
}

export function LogoAvatar({
  logoUrl,
  name,
  size = 64,
  rounded = "rounded-2xl",
}: {
  logoUrl: string | null;
  name: string;
  size?: number;
  rounded?: string;
}) {
  if (logoUrl) {
    return (
      <Image
        src={logoUrl}
        alt={name}
        width={size}
        height={size}
        className={cn(rounded, "border-4 border-white bg-white object-cover shadow-sm")}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className={cn(
        rounded,
        "flex items-center justify-center border-4 border-white text-2xl font-semibold text-white shadow-sm",
      )}
      style={{ width: size, height: size, backgroundColor: "var(--brand-primary)" }}
    >
      {name.slice(0, 1).toUpperCase()}
    </div>
  );
}

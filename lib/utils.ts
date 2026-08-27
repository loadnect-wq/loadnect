import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge Tailwind classes safely, resolving conflicts. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format a number as a localised currency string. */
export function formatCurrency(
  amount: number,
  currency = "SAR",
  locale = "ar-SA"
): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

/** Format a Date as a short locale string. */
export function formatDate(date: Date | string, locale = "en-US"): string {
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(date));
}

/** Clamp a number between min and max. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Return initials from a full name (max 2 characters). */
export function getInitials(name: string): string {
  return name
    .split(" ")
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

/** Build a URL-safe slug from any string. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Returns a URL only if it is a plain http(s) link, otherwise null.
 *
 * For any URL that came from a USER and ends up in an href. `javascript:`,
 * `data:` and `vbscript:` hrefs execute on click, so a stored value like
 * `javascript:fetch('/admin/...')` becomes stored XSS the moment a privileged
 * user clicks it. Callers render nothing when this returns null.
 *
 * This is the render-side half of a two-layer defence; the authoritative half
 * is a DB CHECK constraint, because RLS insert policies do not constrain
 * columns and PostgREST is directly reachable.
 */
export function safeHttpUrl(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

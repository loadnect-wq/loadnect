// Shared ad types, constants, and validators.
// PURE: this file MUST NOT import server-only modules (next/headers, the
// supabase server client, etc.) because client components import it for
// the placement list and URL validators. Server reads live in `lib/ads-server.ts`.
//
// Validators are used by both the admin server actions (before write) and
// the client preview (instant feedback). The server action is the source
// of truth — it re-runs them.

// ── Types ─────────────────────────────────────────────────────────────────────

export type AdPlacement =
  | "homepage_banner"
  | "search_page_banner"
  | "hall_detail_sidebar"
  | "booking_confirmation";

export const AD_PLACEMENTS: { value: AdPlacement; label: string; description: string }[] = [
  { value: "homepage_banner",      label: "Homepage banner",       description: "Top of the home screen, full-width." },
  { value: "search_page_banner",   label: "Search page banner",    description: "Above the search results list." },
  { value: "hall_detail_sidebar",  label: "Hall detail sidebar",   description: "Sidebar of a hall detail page." },
  { value: "booking_confirmation", label: "Booking confirmation",  description: "Shown after a successful booking." },
];

export type PublicAd = {
  id:              string;
  title:           string;
  image_url:       string | null;
  target_url:      string | null;
  advertiser_name: string | null;
  placement:       AdPlacement;
};

// ── Validators ────────────────────────────────────────────────────────────────

const UNSAFE_SCHEMES = /^\s*(javascript|data|vbscript|file):/i;
const MAX_URL_LEN = 2048;

// Strip control chars + HTML angle brackets. React already escapes text nodes,
// but we still neutralize tags so a partial DOM serialization elsewhere stays
// safe. NOT a substitute for output escaping — defense in depth.
const TAG_OR_CTRL = /[<> -]/g;

export function sanitizeAdText(input: unknown, maxLen = 200): string {
  if (typeof input !== "string") return "";
  return input.replace(TAG_OR_CTRL, "").trim().slice(0, maxLen);
}

export type UrlValidationResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

export function validateTargetUrl(raw: unknown): UrlValidationResult {
  if (typeof raw !== "string") return { ok: false, error: "URL is required." };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: "URL is required." };
  if (trimmed.length > MAX_URL_LEN) return { ok: false, error: "URL is too long." };
  if (UNSAFE_SCHEMES.test(trimmed)) return { ok: false, error: "URL uses an unsafe scheme." };

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: "URL is not a valid absolute URL (must start with http:// or https://)." };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "Only http:// and https:// links are allowed." };
  }
  if (!parsed.hostname) return { ok: false, error: "URL has no host." };

  return { ok: true, url: parsed.toString() };
}

/**
 * The hosts a creative may be served from.
 *
 * THE CSP DECIDES THIS, NOT TASTE. next.config.ts sets
 * `img-src 'self' data: blob: <supabase origin> https://*.supabase.co <ga>`,
 * so a creative on any other host is BLOCKED BY THE BROWSER — the ad renders as
 * a blank box and nothing anywhere reports it. The admin field is free text, so
 * until now an admin could paste an imgur link, see it save cleanly, and never
 * learn that the ad they sold was invisible.
 *
 * Checked at save time so the failure is an error message, not a silent no-op.
 * `img-src` also permits `self`, which is why a same-origin path is allowed.
 */
export function isDisplayableAdImageHost(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== "https:") return false;
    // Any Supabase project host — matching the CSP's own https://*.supabase.co.
    return hostname === "supabase.co" || hostname.endsWith(".supabase.co");
  } catch {
    return false;
  }
}

export function validateImageUrl(raw: unknown): UrlValidationResult {
  if (typeof raw !== "string" || !raw.trim()) {
    return { ok: false, error: "Image URL is required." };
  }
  const base = validateTargetUrl(raw);
  if (!base.ok) return base;

  if (!isDisplayableAdImageHost(base.url)) {
    return {
      ok: false,
      error:
        "Creative images must be uploaded to Hallnect's own storage. " +
        "An image hosted anywhere else is blocked by the site's content security " +
        "policy and the ad would show an empty box.",
    };
  }
  return base;
}

export function isValidPlacement(p: unknown): p is AdPlacement {
  return typeof p === "string" && AD_PLACEMENTS.some((x) => x.value === p);
}

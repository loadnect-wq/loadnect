// ─────────────────────────────────────────────────────────────────────────────
// lib/app-url.ts — canonical public origin, safe to import from CLIENT code.
//
// WHY THIS EXISTS (production incident: "Log in to Vercel" during Google login).
// Vercel SSO protection guards preview/branch/per-deployment URLs. Verified
// cookie-free:
//     https://hallnect5.vercel.app/login                      -> 200  (public)
//     https://hallnect5-git-main-…vercel.app/login            -> 302 vercel.com/sso-api
//     https://hallnect5-<hash>-…vercel.app/login              -> 302 vercel.com/sso-api
//
// The OAuth call sites previously built redirectTo from `window.location.origin`.
// If a customer arrived on a branch/deployment URL (stale bookmark, shared link,
// a link from the Vercel dashboard), OAuth sent them straight back to that
// PROTECTED origin — so they hit Vercel's login wall instead of Hallnect.
// Pinning the return to the canonical public origin rescues that customer, and
// makes redirect_to exactly match the value allow-listed in Supabase so Supabase
// never has to fall back to its Site URL.
//
// NOTE: this is deliberately NOT lib/env.ts — that file is server-only
// (`requireEnv` would throw in the browser). NEXT_PUBLIC_APP_URL is inlined at
// build time, so it is readable in client components.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The canonical public origin, e.g. "https://hallnect5.vercel.app" — absolute,
 * no trailing slash. Tolerates a scheme-less env value (a common deploy typo:
 * "hallnect5.vercel.app"), which would otherwise be treated as a RELATIVE path
 * by Supabase and produce ".../supabase.co/hallnect5.vercel.app/?code=…".
 *
 * Falls back to the current browser origin (then localhost) when the env var is
 * absent, so local development and previews still work.
 */
export function getCanonicalAppUrl(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL;

  if (typeof raw === "string" && raw.trim() !== "") {
    const trimmed = raw.trim();
    const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    try {
      const url = new URL(candidate);
      if (url.protocol === "http:" || url.protocol === "https:") return url.origin;
    } catch {
      // fall through to the runtime origin below
    }
  }

  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return "http://localhost:3000";
}

/**
 * Absolute OAuth/email return URL on the canonical public origin.
 *
 * `next` must be a root-relative internal path; anything else is ignored. The
 * callback re-validates it against an allow-list (safeNext), so this is the
 * outer layer of that defence, not a replacement for it.
 */
export function buildAuthCallbackUrl(next?: string): string {
  const base = `${getCanonicalAppUrl()}/auth/callback`;
  if (!next) return base;
  const safe = next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\");
  return safe ? `${base}?next=${encodeURIComponent(next)}` : base;
}

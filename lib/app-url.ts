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

/** Short-lived cookie carrying the post-login destination across OAuth. */
export const AUTH_NEXT_COOKIE = "hn_auth_next";

/**
 * Absolute OAuth/email return URL on the canonical public origin.
 *
 * ⚠️  RETURNS A BARE URL WITH NO QUERY STRING — deliberately.
 *
 * Supabase only honours `redirect_to` when it MATCHES an entry in the project's
 * Redirect URL allow-list; otherwise it silently falls back to the Site URL.
 * The allow-list holds the exact path `…/auth/callback` (no wildcard), so
 * appending `?next=…` broke the match. Proven against the live project:
 *
 *   redirect_to=…/auth/callback                  -> honoured
 *   redirect_to=…/auth/callback?next=/auth/redirect
 *                                                -> fell back to the Site URL
 *
 * and that Site URL is the team-scoped deployment host, which Vercel SSO
 * protects — so every Google sign-in landed on "Log in to Vercel".
 *
 * The destination now travels in a cookie instead (see rememberAuthNext), which
 * the callback route reads server-side and re-validates against its allow-list.
 */
export function buildAuthCallbackUrl(): string {
  return `${getCanonicalAppUrl()}/auth/callback`;
}

/**
 * Records where to land after authentication, in a short-lived cookie.
 *
 * SECURITY: this is exactly as trusted as the old `?next=` query param — i.e.
 * NOT trusted. The callback re-validates it with safeNext() (same-origin,
 * root-relative, allow-listed prefixes) before ever redirecting to it. Scoped
 * to this site, SameSite=Lax so it survives the top-level OAuth return, and
 * expires in 10 minutes.
 */
export function rememberAuthNext(next: string | null | undefined): void {
  if (typeof document === "undefined") return;
  const secure = typeof window !== "undefined" && window.location.protocol === "https:" ? "; Secure" : "";
  if (!next) {
    document.cookie = `${AUTH_NEXT_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax${secure}`;
    return;
  }
  document.cookie =
    `${AUTH_NEXT_COOKIE}=${encodeURIComponent(next)}; Max-Age=600; Path=/; SameSite=Lax${secure}`;
}

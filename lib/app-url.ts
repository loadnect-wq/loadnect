// ─────────────────────────────────────────────────────────────────────────────
// lib/app-url.ts — canonical public origin, safe to import from CLIENT code.
//
// WHY THIS EXISTS (production incident: "Log in to Vercel" during Google login).
// Vercel SSO protection guards preview/branch/per-deployment URLs; only the
// custom domain (www.hallnect.com) is public. Verified cookie-free:
//     https://www.hallnect.com/login                          -> 200  (public)
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

// Hosts that must never be adopted from an env override because they are not
// the origin that actually serves the app.
// 2026-08-19: the project moved to the custom domain hallnect.com and the
// hallnect5.vercel.app alias was RELEASED — it now returns DEPLOYMENT_NOT_FOUND.
// A stale NEXT_PUBLIC_APP_URL still pointing there (env vars are inlined at
// build time and easy to forget) must never win: an OAuth return or a Cashfree
// return_url aimed at a dead host strands the user mid-flow. Any env value
// whose host is in this set is ignored as poison.
//
// 2026-08-25: www.hallnect.com joins the list for the same reason, one step
// removed. It is not dead — it 301s to the apex — but it is NO LONGER THE
// SERVING HOST, and a canonical, an OAuth redirect_to or a Cashfree return_url
// aimed at a redirect is a bug: the canonical fights the server, and the
// gateway round-trip takes an extra hop it does not need. The production env
// vars still hold the old www value (they are typed as Secrets, so Vercel will
// not let them be edited in place), which is exactly the stale-override case
// this guard exists to neutralise.
//
// KEEP IN SYNC WITH THE VERCEL PRIMARY DOMAIN. If the primary is ever switched
// back to www, remove www from this set and update PRODUCTION_ORIGIN in the
// same change — otherwise the app would ignore a host that genuinely serves.
const RETIRED_HOSTS = new Set(["hallnect5.vercel.app", "www.hallnect.com"]);

// The production origin used when no (valid, non-retired) env override exists.
//
// 2026-08-25: the apex cut-over happened. hallnect.com is now the Production
// domain in Vercel and www.hallnect.com 301s to it (path-preserving), the
// reverse of the previous arrangement. Verified live after the change:
//     https://hallnect.com/halls      -> 200
//     https://www.hallnect.com/halls  -> 301 https://hallnect.com/halls
// This constant must name the host that actually SERVES, because it is the
// canonical every page advertises, the OAuth redirect_to, and the Cashfree
// return_url. Both /auth/callback variants are in the Supabase redirect
// allow-list, so this switch does not disturb Google sign-in.
const PRODUCTION_ORIGIN = "https://hallnect.com";

/** Parses an env value into an http(s) origin; tolerates a missing scheme
 *  (the common deploy typo "hallnect.com", which third parties would otherwise
 *  resolve as a RELATIVE path, e.g. ".../supabase.co/hallnect.com/?code=…"). */
function parseOrigin(raw: string | undefined): string | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const trimmed = raw.trim();
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * The canonical public origin — absolute, no trailing slash.
 *
 * Resolution order:
 *   1. NEXT_PUBLIC_SITE_URL   — explicit override, always wins
 *   2. NEXT_PUBLIC_APP_URL    — legacy variable, honoured unless it points at
 *                               a RETIRED host (see above)
 *   3. production builds      — PRODUCTION_ORIGIN, so a stale or missing env
 *                               var can never route auth to a dead domain
 *   4. the browser origin / localhost — local development
 */
export function getCanonicalAppUrl(): string {
  const site = parseOrigin(process.env.NEXT_PUBLIC_SITE_URL);
  if (site) return site;

  const app = parseOrigin(process.env.NEXT_PUBLIC_APP_URL);
  if (app && !RETIRED_HOSTS.has(new URL(app).host)) return app;

  if (process.env.NODE_ENV === "production") return PRODUCTION_ORIGIN;

  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return "http://localhost:3000";
}

/** Short-lived cookie carrying the post-login destination across OAuth. */
export const AUTH_NEXT_COOKIE = "hn_auth_next";

/**
 * Short-lived cookie marking an OWNER-REGISTRATION sign-in.
 *
 * SECURITY — why this is separate from AUTH_NEXT_COOKIE. Owner intent used to
 * ride inside the general-purpose `next` value. But `next` is populated from a
 * ?next= QUERY PARAM on the login page, so anyone could send a victim
 *   https://<site>/login?next=/auth/set-owner-role
 * and that victim's ordinary Google sign-in would silently promote them to
 * owner_approved. The OAuth code was genuine, so "the code is unforgeable" did
 * not help: the victim supplied the code themselves.
 *
 * This cookie is written ONLY by the owner-registration page and is never
 * derived from a URL, so a crafted link cannot set it.
 */
export const OWNER_INTENT_COOKIE = "hn_owner_intent";

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
 * Marks the current sign-in as an owner registration. Written only from
 * /owner/register — never from a URL-supplied value.
 */
export function rememberOwnerIntent(): void {
  if (typeof document === "undefined") return;
  const secure = typeof window !== "undefined" && window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${OWNER_INTENT_COOKIE}=1; Max-Age=600; Path=/; SameSite=Lax${secure}`;
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

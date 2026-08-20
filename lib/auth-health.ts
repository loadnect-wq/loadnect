// ─────────────────────────────────────────────────────────────────────────────
// lib/auth-health.ts — live Supabase OAuth redirect configuration check.
//
// WHY THIS EXISTS (production incident, 2026-08-19/20). Supabase honours an
// OAuth `redirect_to` ONLY when it exactly matches an entry in the project's
// Redirect URL allow-list. When it does not match, Supabase does not error —
// it SILENTLY falls back to the project's Site URL. After Hallnect moved to
// hallnect.com, the allow-list still held only the retired hallnect5.vercel.app
// callback, so every Google sign-in was redirected to the Site URL, which is a
// Vercel-SSO-protected host: the "Log in to Vercel" page customers reported.
//
// That failure is invisible from inside the app — the code is correct, the env
// is correct, and nothing throws. This module makes it visible by asking the
// live auth server what it would actually do, so the misconfiguration can be
// seen (and, once fixed, confirmed) from the admin dashboard.
//
// THE PROBE: GET /auth/v1/verify?token=probe&type=signup&redirect_to=<X>
// returns a Location header echoing <X> when X is allow-listed, and the Site
// URL when it is not. The token is deliberately invalid — the response carries
// an "otp_expired" error fragment, which is expected and harmless. Nothing is
// created, no email is sent, and no credential is used (this endpoint takes the
// anon key context only). Read-only by construction.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import { getCanonicalAppUrl } from "@/lib/app-url";

export type RedirectCheck = {
  url: string;
  allowListed: boolean;
  /** Where Supabase would actually send the browser. */
  actualDestination: string | null;
  /** True when the fallback destination is a Vercel-SSO-protected host. */
  landsOnProtectedHost: boolean;
};

export type AuthHealth = {
  reachable: boolean;
  /** The Site URL Supabase falls back to, inferred from a rejected probe. */
  siteUrlFallback: string | null;
  checks: RedirectCheck[];
  /** True when the origin the app actually uses is allow-listed. */
  healthy: boolean;
  canonicalOrigin: string;
};

/** Hosts that require a Vercel account to view — landing here breaks sign-in. */
function isVercelProtectedHost(url: string): boolean {
  try {
    const host = new URL(url).host;
    // Custom domains are public; *.vercel.app deployment/team hosts are walled
    // by the project's "all_except_custom_domains" SSO protection.
    return host.endsWith(".vercel.app");
  } catch {
    return false;
  }
}

async function probeRedirect(supabaseUrl: string, target: string): Promise<RedirectCheck> {
  const probe =
    `${supabaseUrl}/auth/v1/verify?token=probe&type=signup&redirect_to=${encodeURIComponent(target)}`;

  try {
    const res = await fetch(probe, {
      method: "GET",
      redirect: "manual",       // we want the Location header, not the page
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });

    const location = res.headers.get("location");
    if (!location) {
      return { url: target, allowListed: false, actualDestination: null, landsOnProtectedHost: false };
    }

    // Strip the error fragment the invalid token produces before comparing.
    const clean = location.split("#")[0];
    const allowListed = clean.startsWith(target);

    return {
      url: target,
      allowListed,
      actualDestination: clean,
      landsOnProtectedHost: !allowListed && isVercelProtectedHost(clean),
    };
  } catch {
    return { url: target, allowListed: false, actualDestination: null, landsOnProtectedHost: false };
  }
}

/**
 * Asks the live Supabase auth server which of our callback URLs it will honour.
 * Never throws — a failed probe reports `reachable: false` rather than breaking
 * the settings page.
 */
export async function checkAuthRedirectHealth(): Promise<AuthHealth> {
  const canonicalOrigin = getCanonicalAppUrl();
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");

  const empty: AuthHealth = {
    reachable: false, siteUrlFallback: null, checks: [], healthy: false, canonicalOrigin,
  };
  if (!supabaseUrl) return empty;

  // The origin the app actually uses first, then the sibling host so an apex /
  // www cut-over is covered without a code change.
  const targets = Array.from(new Set([
    `${canonicalOrigin}/auth/callback`,
    canonicalOrigin.includes("://www.")
      ? `${canonicalOrigin.replace("://www.", "://")}/auth/callback`
      : `${canonicalOrigin.replace("://", "://www.")}/auth/callback`,
  ]));

  const checks = await Promise.all(targets.map((t) => probeRedirect(supabaseUrl, t)));
  const reachable = checks.some((c) => c.actualDestination !== null);

  // A rejected probe's destination IS the Site URL — that is how we learn it.
  const rejected = checks.find((c) => !c.allowListed && c.actualDestination);
  const siteUrlFallback = rejected?.actualDestination ?? null;

  return {
    reachable,
    siteUrlFallback,
    checks,
    // Healthy = the origin this deployment actually sends is allow-listed.
    healthy: checks[0]?.allowListed === true,
    canonicalOrigin,
  };
}

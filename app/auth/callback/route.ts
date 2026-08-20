import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { AUTH_NEXT_COOKIE, OWNER_INTENT_COOKIE } from "@/lib/app-url";

// Path prefixes the OAuth flow may return a browser to after a successful
// sign-in. Deep links matter here: a signed-out customer sent to
// /login?next=/book/<slug> must land back on that booking page, not their
// dashboard. Anything not matching falls back to /auth/redirect (role router).
//
// SECURITY: this is a SECOND layer, not the primary one. safeNext() has already
// proven the value is a single-slash-rooted SAME-ORIGIN path (rejecting
// //evil.com, /\evil.com, @evil.com, .evil.com and any absolute URL), so it can
// only ever navigate within our own origin. This list additionally constrains
// WHICH of our own pages an OAuth return may land on.
const ALLOWED_REDIRECT_PREFIXES = [
  "/auth/redirect",
  "/book/",
  "/customer",
  "/owner",
  "/halls",
];

// Owner-registration intent now arrives in its OWN cookie (OWNER_INTENT_COOKIE),
// written only by /owner/register. It used to ride inside `next`, which the
// login page populates from a ?next= QUERY PARAM — so a link such as
//     /login?next=/auth/set-owner-role
// silently promoted any customer who completed a normal Google sign-in. The
// OAuth code was genuine (the victim supplied it), so the "unforgeable code"
// argument did not protect against it. A URL can no longer express this intent.

/**
 * Returns a SAFE same-origin relative path, or the default.
 *
 * SECURITY: `next` is attacker-controlled. Concatenating it onto `origin`
 * without validation is an open redirect — `?next=.evil.com` yields
 * `https://app.com.evil.com` and `?next=@evil.com` yields
 * `https://app.com@evil.com` (host = evil.com). A link on our own domain that
 * bounces to an attacker site is a phishing primitive, so we reject anything
 * that isn't a single-slash-rooted internal path and then restrict to a
 * known set of destinations.
 */
function safeNext(raw: string | null): string {
  const fallback = "/auth/redirect";
  if (!raw) return fallback;
  // Must be root-relative: one leading "/", and not "//" or "/\" (protocol-
  // relative or backslash tricks). Rejects "//evil.com", "/\evil.com",
  // "@evil.com", ".evil.com", and any absolute URL.
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) {
    return fallback;
  }
  // Belt-and-suspenders: parse against a dummy base; if the origin moved, the
  // value escaped the path. URL() normalizes backslashes and browser quirks.
  try {
    const u = new URL(raw, "https://internal.invalid");
    if (u.origin !== "https://internal.invalid") return fallback;
  } catch {
    return fallback;
  }
  const allowed = ALLOWED_REDIRECT_PREFIXES.some(
    (prefix) => raw === prefix || raw.startsWith(prefix),
  );
  return allowed ? raw : fallback;
}

/**
 * Upgrade a freshly-authenticated user customer → owner_approved (ACTIVE owner).
 *
 * Owner JOINING approval was removed (migration 0019): the hall is the only
 * approval gate. This still cannot reach admin/any elevated role.
 *
 * SECURITY — why this is now CSRF-safe:
 *   • This only runs INSIDE the callback, AFTER exchangeCodeForSession()
 *     succeeds. The OAuth `code` is single-use and unforgeable, so an attacker
 *     cannot trigger this with just a victim's session cookie (which is exactly
 *     what made the old standalone GET /auth/set-owner-role endpoint forgeable).
 *   • Privilege-safe: only ever customer → owner_approved. An owner can manage
 *     their own halls but publishes nothing on their own — every hall still
 *     requires admin approval before customers see it. This can never reach
 *     'admin' here.
 *   • Idempotent: a repeat run is a no-op once role != 'customer'.
 *
 * The service-role client is required because RLS + the prevent_role_change
 * trigger (0006) block self-role-changes for non-admins. This is a trusted
 * server step (is_trusted_backend() is true for service_role), which is the
 * intended escape hatch.
 */
async function handleOwnerIntent(userId: string): Promise<void> {
  const admin = getSupabaseAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adminAny = admin as any;

  // maybeSingle(): the profiles row is created by the handle_new_user trigger.
  // If it isn't visible yet, treat it as "no row" rather than throwing — the
  // caller routes through /auth/redirect, so a missed upgrade self-corrects on
  // a later sign-in instead of dumping the user somewhere wrong.
  const { data: profile } = await adminAny
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  // Only ever customer → owner_approved. Never touch an already-elevated role
  // (owner_approved/admin) — idempotent and privilege-safe.
  if ((profile as { role: string } | null)?.role === "customer") {
    await adminAny
      .from("profiles")
      .update({ role: "owner_approved" })
      .eq("id", userId);
  }
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  // Destination comes from a short-lived cookie. It USED to ride on
  // ?next=, but Supabase only honours redirect_to when it matches the
  // project's Redirect URL allow-list, and the allow-listed entry is the bare
  // path — so any query string broke the match and Supabase fell back to the
  // Site URL (a Vercel-SSO-protected host). Proven against the live project.
  // The query param is still read as a fallback for links already in flight.
  const jar = await cookies();
  const fromCookie = jar.get(AUTH_NEXT_COOKIE)?.value;
  // decodeURIComponent throws URIError on a malformed sequence (e.g. a stray
  // "%"), which would 500 the whole sign-in. Treat an undecodable cookie as
  // absent rather than failing the login.
  let decodedCookie: string | null = null;
  if (fromCookie) {
    try { decodedCookie = decodeURIComponent(fromCookie); }
    catch { decodedCookie = null; }
  }
  const rawNext = decodedCookie ?? searchParams.get("next");
  // Owner intent: a dedicated cookie only /owner/register writes. Never `next`.
  const wantsOwnerUpgrade = jar.get(OWNER_INTENT_COOKIE)?.value === "1";
  // Same validation as before: attacker-controlled either way, so safeNext()
  // remains the authority (same-origin, root-relative, allow-listed prefixes).
  const next = safeNext(rawNext);

  // Single-use: drop the cookie however this request ends.
  const clearNextCookie = (res: NextResponse) => {
    res.cookies.set(AUTH_NEXT_COOKIE, "", { path: "/", maxAge: 0 });
    res.cookies.set(OWNER_INTENT_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  };

  // No code → nothing to verify. Never act on intent or trust `next` here.
  if (!code) {
    return clearNextCookie(NextResponse.redirect(`${origin}/login?error=oauth_failed`));
  }

  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data?.user) {
    return clearNextCookie(NextResponse.redirect(`${origin}/login?error=oauth_failed`));
  }

  // Owner-registration intent: the code exchange just proved this is a genuine,
  // fresh OAuth completion, so this is the one place it's safe to mutate role.
  if (wantsOwnerUpgrade) {
    await handleOwnerIntent(data.user.id);
    // Route through the role router rather than hardcoding a destination: it
    // reads the user's ACTUAL role and sends them to the right place. If the
    // upgrade landed → owner_approved → /owner/dashboard; if it somehow didn't
    // → /customer.
    return clearNextCookie(NextResponse.redirect(`${origin}/auth/redirect`));
  }

  return clearNextCookie(NextResponse.redirect(`${origin}${next}`));
}

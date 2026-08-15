import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

// Internal destinations the OAuth flow may redirect a browser to after a
// successful sign-in. Anything else falls back to /auth/redirect (role router).
const ALLOWED_REDIRECTS = new Set(["/auth/redirect"]);

// Intent marker used by the owner-registration Google flow. This is NOT a
// redirect target — it's a signal that the just-authenticated user should be
// upgraded customer → owner_pending (see handleOwnerIntent). The owner-register
// page sends ?next=/auth/set-owner-role.
const OWNER_INTENT = "/auth/set-owner-role";

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
  // The owner-intent marker is allowed through here so the GET handler can act
  // on it; it is never used as a literal redirect target.
  if (raw === OWNER_INTENT) return raw;
  return ALLOWED_REDIRECTS.has(raw) ? raw : fallback;
}

/**
 * Upgrade a freshly-authenticated user customer → owner_pending.
 *
 * SECURITY — why this is now CSRF-safe:
 *   • This only runs INSIDE the callback, AFTER exchangeCodeForSession()
 *     succeeds. The OAuth `code` is single-use and unforgeable, so an attacker
 *     cannot trigger this with just a victim's session cookie (which is exactly
 *     what made the old standalone GET /auth/set-owner-role endpoint forgeable).
 *   • Privilege-safe: only ever customer → owner_pending. owner_pending grants
 *     nothing until an admin approves; it can never reach owner_approved/admin
 *     here.
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

  // Only ever customer → owner_pending. Never touch an already-elevated role
  // (owner_pending/owner_approved/admin) — idempotent and privilege-safe.
  if ((profile as { role: string } | null)?.role === "customer") {
    await adminAny
      .from("profiles")
      .update({ role: "owner_pending" })
      .eq("id", userId);
  }
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  // No code → nothing to verify. Never act on intent or trust `next` here.
  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=oauth_failed`);
  }

  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data?.user) {
    return NextResponse.redirect(`${origin}/login?error=oauth_failed`);
  }

  // Owner-registration intent: the code exchange just proved this is a genuine,
  // fresh OAuth completion, so this is the one place it's safe to mutate role.
  if (next === OWNER_INTENT) {
    await handleOwnerIntent(data.user.id);
    // Route through the role router rather than hardcoding /approval-pending:
    // it reads the user's ACTUAL role and sends them to the right place. If the
    // upgrade landed → owner_pending → /approval-pending; if it somehow didn't
    // → /customer, instead of bouncing off the owner_pending-only gate.
    return NextResponse.redirect(`${origin}/auth/redirect`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}

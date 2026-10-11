// ─────────────────────────────────────────────────────────────────────────────
// lib/auth/owner-upgrade.ts — the ONE place a customer becomes a venue owner.
//
// Two doors lead here, and both are fresh, verified sign-ins:
//   • Google: app/auth/callback/route.ts, after exchangeCodeForSession()
//     succeeds and the owner-intent cookie (written only by /owner/register)
//     is present.
//   • Mobile: app/(auth)/login/phone-actions.ts verifyPhoneSignIn, after MSG91
//     approves the code AND a session has been minted, when the call came from
//     /owner/register (intent "owner").
//
// WHY THAT IS SAFE. The thing that made the old GET /auth/set-owner-role
// forgeable was that it acted on an existing session: any link could promote
// whoever was signed in. Here the upgrade happens only inside an authentication
// the person just completed themselves — a single-use OAuth code, or an SMS
// code to a phone they hold — so nobody can trigger it for someone else.
//
// WHAT IT CAN DO, AND NO MORE: customer → owner_approved. Never admin, never a
// demotion, and a no-op for anyone who is not a customer, so it is idempotent.
// An owner_approved account can manage only its own halls, and every hall still
// needs admin approval before a family sees it.
//
// The service-role client is required: RLS and the prevent_role_change trigger
// (0006) block self-role-changes for non-admins, and is_trusted_backend() is
// true for service_role — the intended escape hatch.
// ─────────────────────────────────────────────────────────────────────────────

/** The admin (service-role) client, typed loosely as the rest of the auth code does. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any;

/**
 * Upgrade a just-authenticated customer to an active owner.
 * Returns true when the account is an owner (or admin) afterwards.
 */
export async function upgradeCustomerToOwner(admin: AdminClient, userId: string): Promise<boolean> {
  // maybeSingle(): the profile row comes from the handle_new_user trigger. If it
  // is not visible yet, report "not upgraded" rather than throwing — callers
  // route through /auth/redirect, which reads the real role.
  const { data: profile, error } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
  if (error) {
    console.error("[owner-upgrade] profile read failed:", error.message);
    return false;
  }
  const role = (profile as { role: string } | null)?.role;
  if (role === "owner_approved" || role === "admin") return true;
  if (role !== "customer") return false;

  const { error: updateErr } = await admin
    .from("profiles")
    .update({ role: "owner_approved" })
    .eq("id", userId)
    // Only ever FROM customer, in the write itself as well as the read above:
    // a role that changed in between is left alone.
    .eq("role", "customer");
  if (updateErr) {
    console.error("[owner-upgrade] role update failed:", updateErr.message);
    return false;
  }
  return true;
}

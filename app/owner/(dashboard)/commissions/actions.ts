"use server";

// ─────────────────────────────────────────────────────────────────────────────
// Owner commission actions — submit a manual UPI payment for a commission owed
// to Hallnect. This is the OWNER side of the two-party manual-UPI flow.
//
// SECURITY (all enforced server-side; never trust the client):
//   • Session role must be owner_approved.
//   • The commission must belong to a hall the owner owns (re-checked here AND
//     by RLS on the read).
//   • The amount is taken from the DB commission row, NOT from the form.
//   • The submission is recorded as a CLAIM (status=payment_submitted). It does
//     NOT mark the commission paid — only an admin can (see admin actions +
//     the guard_commission_writes trigger). This satisfies "owners cannot mark
//     commission paid directly".
//   • A partial unique index blocks a second open submission for the same
//     commission, so an owner can't spam duplicate claims.
// ─────────────────────────────────────────────────────────────────────────────

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { sanitizeError } from "@/lib/errors";
import { settledReason } from "@/lib/commission-payments";

type ActionResult = { success: true } | { error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// UPI reference IDs (RRN / UTR) are typically 12 alphanumerics; accept 6–40 to
// be provider-agnostic, but strictly restrict the character set.
const UPI_REF_RE = /^[A-Za-z0-9._-]{6,40}$/;

export async function submitCommissionUpiPayment(input: {
  commissionId: string;
  upiReference: string;
  screenshotUrl?: string | null;
}): Promise<ActionResult> {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  // Role check (server-side).
  const { data: profile } = await db
    .from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "owner_approved") {
    return { error: "Only approved hall owners can submit commission payments." };
  }

  // Input validation.
  if (!UUID_RE.test(input.commissionId ?? "")) return { error: "Invalid commission reference." };
  const upiRef = (input.upiReference ?? "").trim();
  if (!UPI_REF_RE.test(upiRef)) {
    return { error: "Enter a valid UPI reference / UTR (6–40 letters and digits)." };
  }
  const screenshot = input.screenshotUrl?.trim() || null;
  if (screenshot && !/^https?:\/\//i.test(screenshot)) {
    return { error: "Invalid screenshot link." };
  }

  // The owner's hall_owners row id.
  const { data: ownerRow } = await db
    .from("hall_owners").select("id").eq("profile_id", user.id).maybeSingle();
  if (!ownerRow?.id) return { error: "Owner profile not found." };

  // Load the commission (RLS already restricts owners to their own halls'
  // commissions). Re-verify ownership + that it is still owed, server-side.
  const { data: commission, error: cErr } = await db
    .from("commissions")
    .select("id, hall_owner_id, commission_amount, status")
    .eq("id", input.commissionId)
    .maybeSingle();

  if (cErr) return { error: sanitizeError(cErr, "owner") };
  if (!commission) return { error: "Commission not found." };
  if (commission.hall_owner_id !== ownerRow.id) {
    return { error: "You can only pay commission for your own halls." };
  }

  // Only genuinely owner-billed commissions can be paid. 'collected' means the
  // commission was already retained from the customer's advance, so accepting a
  // UPI transfer for it would collect the same money twice — the shared guard
  // in lib/commission-payments.ts is the single definition of that rule.
  const blocked = settledReason(commission.status);
  if (blocked) return { error: blocked };

  // Insert the submission. amount is from the DB, never the client. verified_*
  // are left null (owner cannot self-verify — guard trigger enforces this too).
  const { error: insErr } = await db
    .from("owner_commission_payments")
    .insert({
      owner_id:       ownerRow.id,
      commission_id:  commission.id,
      amount:         commission.commission_amount,
      method:         "upi_manual",
      upi_reference:  upiRef,
      screenshot_url: screenshot,
      status:         "payment_submitted",
    });

  if (insErr) {
    // 23505 = an open submission already exists for this commission.
    if (insErr.code === "23505") {
      return { error: "A payment for this commission is already awaiting admin verification." };
    }
    return { error: sanitizeError(insErr, "owner") };
  }

  revalidatePath("/owner/commissions");
  revalidatePath("/owner/revenue");
  return { success: true };
}

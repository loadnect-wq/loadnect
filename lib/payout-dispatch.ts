// ─────────────────────────────────────────────────────────────────────────────
// lib/payout-dispatch.ts — sending an owner their advance, and finding out what
// happened afterwards. SERVER-ONLY, service role only.
//
// THE ORDER OF OPERATIONS IS THE DESIGN. The owner_payouts row is written
// BEFORE the HTTP call, with a deterministic transfer_id and a partial unique
// index that permits at most one non-terminal transfer per booking. That insert
// IS the idempotency guard — Cashfree Payouts documents no idempotency header
// and their own SDK sends none, so the uniqueness has to be ours, in Postgres.
//
// The consequence worth stating: when a dispatch times out, we do not know
// whether money moved, and we never guess. The row exists with its transfer_id,
// so recovery is a GET /transfers, not a judgement call. Cashfree's own guidance
// on a 5XX is "do not initiate another transaction; check the status".
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { toPaise, PAISE_PER_RUPEE } from "@/lib/money";
import {
  isPayoutsConfigured, buildTransferId, toBeneficiaryId, toBeneficiaryName,
  createTransfer, getTransfer, upsertBeneficiary, getBeneficiary, classifyTransfer,
  destinationDigest as digestOf,
} from "@/lib/cashfree-payouts";
import { notifyAdminOperational } from "@/lib/notifications/events";

export type DispatchResult =
  | { state: "sent";        transferId: string; status: string }
  | { state: "in_flight";   transferId: string; status: string }
  | { state: "unknown";     transferId: string; reason: string }
  | { state: "refused";     reason: string }
  | { state: "failed";      reason: string };

/** Stable fingerprint of where the money is going, snapshotted at dispatch so a
 *  later change to the owner's bank details is a comparison, not a guess.
 *
 *  Lives in lib/cashfree-payouts.ts now, because the beneficiary id is derived
 *  from it and that module cannot import this one. Re-exported here so the
 *  existing call sites and the payout tests keep their import path. */
export { destinationDigest } from "@/lib/cashfree-payouts";

// ── Beneficiary registration ────────────────────────────────────────────────

export type BeneficiaryOutcome =
  | { ok: true; status: string | null }
  | { ok: false; error: string; conflict?: boolean };

/**
 * Registers (or re-reads) the owner's payout destination at Cashfree.
 *
 * Writes with the service role: hall_owners' destination columns had their
 * `authenticated` UPDATE grant revoked in 0068, because under Payouts they are
 * the machine-readable destination of real money.
 */
export async function registerBeneficiary(hallOwnerId: string): Promise<BeneficiaryOutcome> {
  if (!isPayoutsConfigured()) return { ok: false, error: "Cashfree Payouts is not configured." };

  const db = getSupabaseAdminClient() as unknown as {
    from: (t: string) => {
      select: (c: string) => { eq: (a: string, b: string) => { maybeSingle: () => Promise<{ data: Record<string, unknown> | null }> } };
      update: (v: Record<string, unknown>) => { eq: (a: string, b: string) => Promise<{ error: unknown }> };
    };
  };

  const { data: owner } = await db.from("hall_owners")
    .select("id, business_name, business_email, business_phone, payout_account_number, payout_ifsc, payout_account_holder")
    .eq("id", hallOwnerId).maybeSingle();
  if (!owner) return { ok: false, error: "Owner not found." };

  const account = String(owner.payout_account_number ?? "").trim();
  const ifsc    = String(owner.payout_ifsc ?? "").trim().toUpperCase();
  if (!account || !ifsc) return { ok: false, error: "The owner has not supplied an account number and IFSC." };

  // The bank-matching name first, the business name only as a fallback. A name
  // that passes Cashfree's charset filter but not the bank's record produces a
  // transfer that reports SUCCESS and reverses a day later (BENE_NAME_DIFFERS).
  const name = toBeneficiaryName(
    (owner.payout_account_holder as string | null) || (owner.business_name as string | null),
  );
  if (!name) {
    return { ok: false, error: "The account holder name has no letters in it — Cashfree accepts alphabets and spaces only." };
  }

  // THE ID FOLLOWS THE DESTINATION. See toBeneficiaryId: an owner-only id made
  // every re-registration collide with the first one, so a changed bank account
  // was discarded at Cashfree while we recorded it as live.
  const digest = digestOf(account, ifsc);
  const beneficiaryId = toBeneficiaryId(hallOwnerId, digest);
  const res = await upsertBeneficiary({
    beneficiaryId,
    name,
    email: (owner.business_email as string | null) ?? null,
    phone: String(owner.business_phone ?? "").replace(/\D/g, "").slice(-10) || null,
    bankAccount: account,
    ifsc,
  });

  const now = new Date().toISOString();
  if (!res.ok) {
    // Two owners claiming one bank account. Never auto-resolve this.
    const conflict = res.status === 409 && res.code === "beneficiary_already_exists";
    // A FAILED REGISTRATION MUST NOT LOOK LIKE A FRESH SYNC. This used to stamp
    // payout_beneficiary_synced_at on the way out, which is precisely the value
    // dispatchOwnerPayout compares against payout_details_changed_at to refuse
    // a destination changed after verification — so a failure here silently
    // re-armed the very interlock it should have tripped. The status and digest
    // are cleared instead, which makes dispatch refuse on both counts.
    await db.from("hall_owners").update({
      payout_beneficiary_last_error: conflict
        ? "This bank account is already registered to a different owner."
        : res.error,
      payout_beneficiary_status: null,
      payout_beneficiary_digest: null,
    }).eq("id", hallOwnerId);
    if (conflict) {
      await notifyAdminOperational({
        key:       `payout.bene_conflict:${hallOwnerId}`,
        eventType: "payout.bene_conflict",
        event:     "Two owners claim one bank account",
        details:   "A payout account is already registered elsewhere.",
        reference: "Check the owner in /admin/owners before paying",
      }).catch(() => {});
    }
    return { ok: false, error: res.error, conflict };
  }

  // The digest is stored ALONGSIDE the id, and it is what dispatch compares.
  // Recording which destination this registration actually covers is the whole
  // point: a timestamp only says when we last talked to Cashfree, never what
  // we talked about.
  await db.from("hall_owners").update({
    payout_beneficiary_id:         beneficiaryId,
    payout_beneficiary_digest:     digest,
    payout_beneficiary_status:     res.data.status,
    payout_beneficiary_synced_at:  now,
    payout_beneficiary_last_error: null,
  }).eq("id", hallOwnerId);

  return { ok: true, status: res.data.status };
}

/** Re-reads a beneficiary's status without changing it. */
export async function refreshBeneficiary(hallOwnerId: string): Promise<BeneficiaryOutcome> {
  if (!isPayoutsConfigured()) return { ok: false, error: "Cashfree Payouts is not configured." };

  const db = getSupabaseAdminClient() as unknown as {
    from: (t: string) => {
      select: (c: string) => { eq: (a: string, b: string) => { maybeSingle: () => Promise<{ data: Record<string, unknown> | null }> } };
      update: (v: Record<string, unknown>) => { eq: (a: string, b: string) => Promise<{ error: unknown }> };
    };
  };

  // READ THE STORED ID, never re-derive it. The id now encodes the destination,
  // so re-deriving it here would ask Cashfree about whatever bank details the
  // row happens to hold right now — which, after an edit that has not been
  // registered yet, is an id that does not exist. That would report the owner's
  // working payout account as missing.
  const { data: owner } = await db.from("hall_owners")
    .select("id, payout_beneficiary_id").eq("id", hallOwnerId).maybeSingle();
  const beneficiaryId = String(owner?.payout_beneficiary_id ?? "").trim();
  if (!beneficiaryId) {
    return { ok: false, error: "This owner has no registered payout account yet." };
  }

  const res = await getBeneficiary(beneficiaryId);
  if (!res.ok) {
    await db.from("hall_owners").update({
      payout_beneficiary_last_error: res.error,
    }).eq("id", hallOwnerId);
    return { ok: false, error: res.error };
  }
  // Status only. The id and digest are not touched here, because a read cannot
  // change which destination is registered and must not appear to.
  await db.from("hall_owners").update({
    payout_beneficiary_status:    res.data.status,
    payout_beneficiary_synced_at: new Date().toISOString(),
    payout_beneficiary_last_error: null,
  }).eq("id", hallOwnerId);
  return { ok: true, status: res.data.status };
}

// ── Dispatch ────────────────────────────────────────────────────────────────

/**
 * Sends one owner their advance for one booking. Every guard is re-run here
 * regardless of what the calling screen believed.
 */
export async function dispatchOwnerPayout(
  bookingId: string,
  requestedBy: string | null,
): Promise<DispatchResult> {
  if (!isPayoutsConfigured()) return { state: "refused", reason: "Cashfree Payouts is not configured." };

  const admin = getSupabaseAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = admin as any;

  // 1. The funding payment, and every reason not to send.
  const { data: payment, error: payErr } = await db
    .from("payments").select("*")
    .eq("booking_id", bookingId).eq("status", "payment_success")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (payErr) return { state: "failed", reason: "Could not read the payment for this booking." };
  if (!payment) return { state: "refused", reason: "No gateway payment for this booking." };
  if (payment.split_status === "done") return { state: "refused", reason: "Already paid out." };
  if (payment.split_status === "in_flight") return { state: "refused", reason: "A transfer is already on its way for this booking." };

  // THE ADVANCE IS THE CUSTOMER'S WHILE A REFUND IS LIVE. Both sides of the
  // same capture must never go out at once.
  if (["owed", "processing", "completed"].includes(String(payment.refund_state ?? ""))) {
    return { state: "refused", reason: "A refund is owed or in progress — the advance belongs to the customer." };
  }

  const { data: booking } = await db.from("bookings")
    .select("id, status, hall_id, owner_net_advance").eq("id", bookingId).maybeSingle();
  const bStatus = String(booking?.status ?? "");
  if (!["owner_confirmed", "completed"].includes(bStatus)) {
    return { state: "refused", reason: `Booking is ${bStatus || "missing"} — only a confirmed or completed booking pays out.` };
  }

  // 2. The amount. NEVER commissions.owner_payout_amount — that is the owner's
  //    share across the advance AND the venue-collected balance, roughly four
  //    times what is owed here.
  const stored = payment.split_owner_amount;
  const snapshot = booking?.owner_net_advance;
  const amountRupees = stored != null && Number.isFinite(Number(stored)) ? Number(stored)
                     : snapshot != null && Number.isFinite(Number(snapshot)) ? Number(snapshot)
                     : null;
  if (amountRupees == null || amountRupees <= 0) {
    // A machine must not send an estimate. The manual queue exists for this.
    return { state: "refused", reason: "The owner's exact share is not recorded for this booking — settle it by hand." };
  }
  const amountPaise = toPaise(amountRupees);

  // 3. The destination, and that it is the one Cashfree verified.
  const { data: owner } = await db.from("hall_owners")
    .select("id, payout_account_number, payout_ifsc, payout_beneficiary_id, payout_beneficiary_digest, payout_beneficiary_status, payout_beneficiary_synced_at, payout_details_changed_at")
    .eq("id", (await db.from("halls").select("owner_id").eq("id", booking.hall_id).maybeSingle()).data?.owner_id)
    .maybeSingle();
  if (!owner) return { state: "refused", reason: "The venue has no owner record." };
  if (String(owner.payout_beneficiary_status ?? "").toUpperCase() !== "VERIFIED") {
    return {
      state: "refused",
      reason: `The owner's payout account is ${owner.payout_beneficiary_status ?? "not registered"} — it must be VERIFIED before money can be sent.`,
    };
  }
  // NO FALLBACK. This used to read `?? toBeneficiaryId(owner.id)`, which
  // fabricated an id for an owner who had never been registered and sent it to
  // Cashfree as a destination. An unregistered owner is a refusal, not a guess.
  const beneficiaryId = String(owner.payout_beneficiary_id ?? "").trim();
  if (!beneficiaryId) {
    return { state: "refused", reason: "The owner has no registered payout account — register it before sending money." };
  }
  const digest = digestOf(owner.payout_account_number, owner.payout_ifsc);

  // THE REGISTERED DESTINATION MUST BE THE CURRENT ONE. This is the direct
  // form of the check the two below approximate: payout_beneficiary_digest
  // records the account and IFSC that payout_beneficiary_id was actually
  // registered with, so a mismatch means Cashfree is holding a destination
  // that is not the one in our row — whatever the timestamps say.
  const registered = String(owner.payout_beneficiary_digest ?? "").trim();
  if (!registered || registered !== digest) {
    return {
      state: "refused",
      reason: "The owner's bank details are not the ones registered with Cashfree. Re-register the payout account before sending money.",
    };
  }

  // Two further checks, kept as defence in depth BEHIND the digest comparison
  // above. They are timestamp- and history-based, so each can be defeated by a
  // write that merely looks like progress — which is exactly what happened:
  // registerBeneficiary stamped payout_beneficiary_synced_at even when the
  // registration failed or silently no-opped, which re-armed the first check
  // every time. They are retained because they catch things the digest cannot:
  //   • changed AFTER the beneficiary was last synced with Cashfree — an edit
  //     racing a sync that has not finished writing its digest yet;
  //   • different from what the last completed transfer actually paid — which
  //     catches a destination that changed between two payouts even if both
  //     were registered correctly at the time.
  const changedAt = owner.payout_details_changed_at ? Date.parse(String(owner.payout_details_changed_at)) : null;
  const syncedAt  = owner.payout_beneficiary_synced_at ? Date.parse(String(owner.payout_beneficiary_synced_at)) : null;
  if (changedAt != null && syncedAt != null && changedAt > syncedAt) {
    return {
      state: "refused",
      reason: "The owner changed their bank details after Cashfree verified them. Re-register the payout account before sending money.",
    };
  }

  const { data: lastPaid } = await db.from("owner_payouts")
    .select("destination_digest")
    .eq("hall_owner_id", owner.id)
    .eq("status", "SUCCESS")
    .order("created_at", { ascending: false })
    .limit(1).maybeSingle();
  if (lastPaid?.destination_digest && lastPaid.destination_digest !== digest) {
    return {
      state: "refused",
      reason: "The destination account differs from the one this owner was last paid at. Re-register the payout account to confirm the change is theirs.",
    };
  }

  // 4. Next attempt number, then INSERT BEFORE SENDING. The partial unique
  //    index refuses if anything non-terminal already exists for this booking,
  //    so two admins clicking Send at once cannot produce two transfers.
  const { data: prior } = await db.from("owner_payouts")
    .select("attempt").eq("booking_id", bookingId)
    .order("attempt", { ascending: false }).limit(1).maybeSingle();
  const attempt = Number(prior?.attempt ?? 0) + 1;
  const transferId = buildTransferId(bookingId, attempt);

  const request = {
    transfer_id: transferId,
    transfer_amount: amountPaise / PAISE_PER_RUPEE,
    beneficiary_id: beneficiaryId,
  };

  const { data: row, error: insErr } = await db.from("owner_payouts").insert({
    booking_id: bookingId,
    payment_id: payment.id,
    hall_owner_id: owner.id,
    attempt,
    transfer_id: transferId,
    amount_paise: amountPaise,
    beneficiary_id: beneficiaryId,
    destination_digest: digest,
    status: "RECEIVED_LOCAL",          // ours, deliberately not a Cashfree value
    is_terminal: false,
    requested_by: requestedBy,
    request_snapshot: request,
  }).select("id").single();

  if (insErr) {
    const msg = String((insErr as { message?: string }).message ?? "");
    if (msg.includes("owner_payouts_one_live_per_booking") || msg.includes("duplicate key")) {
      return { state: "refused", reason: "A transfer for this booking is already in progress." };
    }
    return { state: "failed", reason: "Could not record the payout before sending it, so nothing was sent." };
  }

  await db.from("payments")
    .update({ split_status: "pending", split_owner_amount: amountRupees, split_payout_id: row.id, split_error: null })
    .eq("id", payment.id);

  // 5. Send.
  const res = await createTransfer({
    transferId,
    beneficiaryId,
    amountRupees: amountPaise / PAISE_PER_RUPEE,
    remarks: "Hallnect advance payout",
  });

  const now = new Date().toISOString();

  if (!res.ok) {
    // UNREACHABLE OR 5XX MEANS UNKNOWN, NOT FAILED. Cashfree may have accepted
    // it. The row stays non-terminal so reconcile asks rather than assuming,
    // and payments reads in_flight so issueRefund refuses in the meantime.
    const unknown = res.status === null || res.status >= 500;
    await db.from("owner_payouts").update({
      status: unknown ? "UNKNOWN_LOCAL" : "REJECTED",
      status_description: res.error,
      status_code: res.code,
      is_terminal: !unknown,
      dispatched_at: now,
      last_checked_at: now,
      last_response: { error: res.error, code: res.code, status: res.status },
      updated_at: now,
    }).eq("id", row.id);

    await db.from("payments").update({
      split_status: unknown ? "in_flight" : "failed",
      split_error: res.error,
      ...(unknown ? {} : { split_at: null }),
    }).eq("id", payment.id);

    if (unknown) {
      await notifyAdminOperational({
        key:       `payout.unknown:${transferId}`,
        eventType: "payout.unknown",
        event:     "A payout did not confirm",
        details:   "We could not tell if the money left. Do not resend.",
        reference: "Press Reconcile on the payout in /admin/payments",
        bookingId,
      }).catch(() => {});
      return { state: "unknown", transferId, reason: res.error };
    }
    return { state: "failed", reason: res.error };
  }

  const cls = classifyTransfer(res.data.status);
  // The send itself: stamp dispatched_at, and this is necessarily the first
  // time the row could settle.
  await applyTransferState(db, row.id, payment.id, res.data, cls, now, {
    isDispatch: true,
    existingSettledAt: null,
  });

  return cls.summary === "done"
    ? { state: "sent", transferId, status: res.data.status }
    : { state: "in_flight", transferId, status: res.data.status };
}

// ── Reconciliation — the primary status source ──────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
async function applyTransferState(
  db: any,
  payoutId: string,
  paymentId: string,
  t: { status: string; statusCode: string | null; statusDescription: string | null; cfTransferId: string | null; utr: string | null; serviceChargePaise: number | null; serviceTaxPaise: number | null; raw: Record<string, unknown> },
  cls: { terminal: boolean; summary: string },
  now: string,
  // WHICH CALLER THIS IS, because two of these columns record an EVENT and not
  // a reading. Both used to be stamped unconditionally, which was harmless
  // while reconcile ran once a night and corrosive at any real cadence.
  opts: { isDispatch: boolean; existingSettledAt: string | null },
): Promise<void> {
  await db.from("owner_payouts").update({
    status: t.status,
    status_code: t.statusCode,
    status_description: t.statusDescription,
    cf_transfer_id: t.cfTransferId,
    transfer_utr: t.utr,
    service_charge_paise: t.serviceChargePaise,
    service_tax_paise: t.serviceTaxPaise,
    is_terminal: cls.terminal,
    last_checked_at: now,
    // "When we sent it" — so only the send writes it. Reconcile re-stamping
    // this made every transfer look freshly dispatched, and "how long has this
    // been in flight?" unanswerable. last_checked_at above is the reading.
    ...(opts.isDispatch ? { dispatched_at: now } : {}),
    last_response: t.raw,
    updated_at: now,
    // FIRST settlement only. Re-stamping this on every reconcile kept SUCCESS
    // rows permanently inside the 48h reversal window in reconcileOpenPayouts,
    // where — ordered oldest-first with limit 50 — they starved newly
    // dispatched transfers out of the sweep entirely.
    ...(cls.summary === "done" && !opts.existingSettledAt ? { settled_at: now } : {}),
    ...(cls.summary === "reversed" ? { reversed_at: now } : {}),
  }).eq("id", payoutId);

  // The summary on payments. `done` is the only value that means money left,
  // and it is issueRefund's double-spend guard — do not weaken it.
  await db.from("payments").update({
    split_status: cls.summary,
    split_payout_id: payoutId,
    split_error: cls.summary === "done" ? null : (t.statusDescription ?? t.statusCode ?? null),
    ...(cls.summary === "done" ? { split_at: now } : {}),
    // A reversal un-pays the owner: the money came back, so the booking
    // returns to the payable queue and split_at must stop claiming otherwise.
    ...(cls.summary === "reversed" ? { split_at: null } : {}),
  }).eq("id", paymentId);
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export type ReconcileResult =
  | { ok: true; status: string; summary: string }
  | { ok: false; error: string };

/** Asks Cashfree what actually happened to one transfer, and records it. */
export async function reconcilePayout(payoutId: string): Promise<ReconcileResult> {
  if (!isPayoutsConfigured()) return { ok: false, error: "Cashfree Payouts is not configured." };
  const admin = getSupabaseAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = admin as any;

  // settled_at is read so applyTransferState can tell a first settlement from
  // the ninety-sixth confirmation of the same one.
  const { data: row } = await db.from("owner_payouts")
    .select("id, transfer_id, payment_id, booking_id, status, settled_at").eq("id", payoutId).maybeSingle();
  if (!row) return { ok: false, error: "That payout no longer exists." };

  const res = await getTransfer(row.transfer_id);
  if (!res.ok) {
    await db.from("owner_payouts")
      .update({ last_checked_at: new Date().toISOString() }).eq("id", payoutId);
    return { ok: false, error: res.error };
  }

  const cls = classifyTransfer(res.data.status);
  await applyTransferState(db, row.id, row.payment_id, res.data, cls, new Date().toISOString(), {
    isDispatch: false,
    existingSettledAt: (row as { settled_at?: string | null }).settled_at ?? null,
  });
  return { ok: true, status: res.data.status, summary: cls.summary };
}

/**
 * Sweeps every non-terminal transfer. Safe to run on a schedule.
 *
 * `cooldownSeconds` makes CONCURRENT SWEEPS SAFE, which they now have to be.
 * There are two schedulers: this route's own cron, and the booking sweep's
 * inline backstop call. Vercel also documents that cron delivery "can
 * occasionally invoke the same scheduled run more than once". Nothing here
 * takes a lock, so two overlapping sweeps would select the same head rows
 * (neither has stamped last_checked_at yet), both ask Cashfree, and both
 * last-write-wins into payments.split_status. If Cashfree flips SUCCESS ->
 * REVERSED between the two reads and the stale write lands second,
 * split_status goes back to 'done' — and that is the interlock issueRefund
 * reads to refuse a customer's refund and dispatchOwnerPayout reads to refuse a
 * re-send. Narrow window, worst possible outcome.
 *
 * Skipping rows checked in the last couple of minutes closes it: the second
 * sweep simply finds nothing to do. This is a sweep-level guard only — the
 * admin's per-payout Reconcile button calls reconcilePayout() directly and is
 * deliberately never throttled.
 */
export async function reconcileOpenPayouts(
  limit = 50,
  cooldownSeconds = 120,
): Promise<{ checked: number; settled: number; errors: number }> {
  const summary = { checked: 0, settled: 0, errors: 0 };
  if (!isPayoutsConfigured()) return summary;

  const admin = getSupabaseAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = admin as any;
  // NOT JUST THE NON-TERMINAL ONES. Cashfree documents REVERSED as a state a
  // transfer reaches AFTER SUCCESS — the beneficiary bank sends the money back,
  // typically within 24 hours (BENE_NAME_DIFFERS, ACCOUNT_BLOCKED,
  // RETURNED_FROM_BENEFICIARY). classifyTransfer marks SUCCESS terminal, so
  // sweeping `is_terminal = false` alone meant a reversal was never noticed:
  // payments would still read split_status='done', the owner would be unpaid
  // and believe otherwise, and issueRefund would refuse the customer's refund
  // forever on the grounds that the owner had already been paid.
  //
  // So settled rows stay in the sweep for 48h past settlement. That is the
  // window Cashfree describes, with margin.
  const reversalWindow = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const cooldownCutoff = new Date(Date.now() - cooldownSeconds * 1000).toISOString();
  const { data: open } = await db.from("owner_payouts")
    .select("id")
    .or(`is_terminal.eq.false,and(status.eq.SUCCESS,settled_at.gte.${reversalWindow})`)
    // Second .or() — PostgREST ANDs them. Rows another sweep just looked at are
    // not looked at again, which is what makes two concurrent sweeps safe.
    // `is.null` is kept in the clause because a null last_checked_at must sort
    // and select FIRST, not be filtered out by the comparison.
    .or(`last_checked_at.is.null,last_checked_at.lt.${cooldownCutoff}`)
    // LEAST-RECENTLY-CHECKED FIRST, not oldest-first. Ordered by created_at,
    // `limit` stopped being a throughput cap and became a starvation trap: the
    // head of the queue is occupied by long-lived rows — settled ones inside
    // the 48h window, and any UNKNOWN_LOCAL whose transfer Cashfree never
    // resolves — so the same rows were re-read every run and a transfer
    // dispatched today might never be asked about at all. Rotating on
    // last_checked_at guarantees every open transfer is reached in at most
    // ceil(open / limit) runs.
    // created_at breaks the tie: last_checked_at is not unique (a sweep stamps a
    // whole batch within the same second), and without a stable second key the
    // page returned at `limit` is not deterministic between runs.
    .order("last_checked_at", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: true })
    .limit(limit);

  for (const row of (open ?? []) as { id: string }[]) {
    summary.checked += 1;
    const r = await reconcilePayout(row.id);
    if (!r.ok) summary.errors += 1;
    else if (r.summary === "done") summary.settled += 1;
  }
  return summary;
}

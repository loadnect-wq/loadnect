// ─────────────────────────────────────────────────────────────────────────────
// lib/easy-split.ts — Cashfree Easy Split: owner (vendor) onboarding and the
// automatic owner payout that fires when a booking is ACCEPTED.  SERVER-ONLY.
//
// MONEY FLOW
//   customer pays advance  → funds sit in Hallnect's Cashfree account, unsplit
//   owner ACCEPTS          → splitOnBookingAccepted() assigns the owner's share
//                            to their vendor balance; Hallnect keeps the 5%
//                            commission by simply NOT splitting it
//   owner DECLINES/expires → no split was created, so the customer refund is
//                            clean and there is nothing to recover
//
// WHY SPLIT ON ACCEPTANCE, NOT ON PAYMENT: once a vendor share settles,
// Cashfree offers no automatic clawback. Paying an owner before they commit
// would turn every decline into debt collection against a third party.
//
// SAFE WHEN UNCONFIGURED: Easy Split is a separately-activated Cashfree product
// and every owner must pass vendor KYC before they can be settled. Until both
// are true this module records WHY the split did not happen and returns a
// non-fatal result — a booking must never fail because payout plumbing is
// incomplete.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import { getCashfreeConfig } from "@/lib/cashfree";

/** Easy Split is a distinct Cashfree product; keep it behind an explicit flag
 *  so enabling live vendor money movement is always a deliberate act. */
/** Must be one of Cashfree's accepted business types — an unrecognised value
 *  is rejected with HTTP 400 at vendor creation. Wedding/event venue hire is
 *  categorised as Travel and Hospitality. */
const VENDOR_BUSINESS_TYPE = "Travel and Hospitality";

/**
 * Cashfree requires vendor_id to be ALPHANUMERIC. Our hall_owners id is a UUID,
 * whose hyphens are rejected outright:
 *   "vendor_id : should be alpha numeric. Value received: ef52cf9c-717e-..."
 * Stripping the hyphens keeps all 32 hex characters, so the mapping back to the
 * owner row stays exact and collision-free — it is the same identifier, just in
 * the shape Cashfree accepts.
 */
export function toVendorId(hallOwnerId: string): string {
  return hallOwnerId.replace(/[^a-zA-Z0-9]/g, "");
}

export function isEasySplitEnabled(): boolean {
  return process.env.CASHFREE_EASY_SPLIT_ENABLED?.trim().toLowerCase() === "true";
}

type CfResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** Shared authed call to the Easy Split endpoints. Logs status codes only —
 *  never credentials, never response bodies (they carry vendor bank details). */
async function cfFetch<T>(path: string, init: RequestInit): Promise<CfResult<T>> {
  let cfg;
  try {
    cfg = getCashfreeConfig();
  } catch {
    return { ok: false, error: "Cashfree is not configured." };
  }

  try {
    const res = await fetch(`${cfg.baseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "x-api-version": "2023-08-01",
        "x-client-id": cfg.appId,
        "x-client-secret": cfg.secretKey,
        ...(init.headers ?? {}),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });

    const text = await res.text();
    let body: unknown = null;
    try { body = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }

    if (!res.ok) {
      const message =
        (body as { message?: string } | null)?.message ?? `Cashfree returned HTTP ${res.status}`;
      console.error(`[easy-split] ${path} failed: HTTP ${res.status}`);
      return { ok: false, error: message };
    }

    return { ok: true, data: body as T };
  } catch (e) {
    console.error("[easy-split] request failed:", e instanceof Error ? e.message : "unknown");
    return { ok: false, error: "Could not reach Cashfree. Please try again." };
  }
}

// ── Vendor onboarding ────────────────────────────────────────────────────────

export type VendorInput = {
  /** Our stable id for the vendor — the hall_owners row id. */
  vendorId: string;
  name: string;
  email: string;
  phone: string;
  /** Bank payout details. Verified against the live sandbox: this account has
   *  UPI settlements DISABLED, so a bank account is the working payout route
   *  ("UPI settlements are not enabled for your account"). UPI is still sent
   *  when present, for accounts where it is enabled. */
  bankAccountNumber?: string | null;
  bankIfsc?: string | null;
  upiVpa?: string | null;
  pan?: string | null;
};

export type VendorStatus = {
  vendorId: string;
  /** Cashfree's own status, e.g. ACTIVE / IN_BENE_VERIFICATION / BLOCKED. */
  status: string;
  /** True only when Cashfree will actually settle money to this vendor. */
  settleable: boolean;
};

function readVendorStatus(vendorId: string, data: unknown): VendorStatus {
  const status = String((data as { status?: string } | null)?.status ?? "UNKNOWN").toUpperCase();
  return {
    vendorId,
    status,
    // Cashfree blocks settlement for vendors that have not cleared validation,
    // so only an explicitly ACTIVE vendor is treated as payable. A freshly
    // created vendor sits in IN_BANK_VALIDATION until the account is verified.
    settleable: status === "ACTIVE",
  };
}

/** Creates (or refreshes) the Cashfree vendor record for a hall owner. */
export async function upsertVendor(input: VendorInput): Promise<CfResult<VendorStatus>> {
  if (!isEasySplitEnabled()) {
    return { ok: false, error: "Easy Split is not enabled (CASHFREE_EASY_SPLIT_ENABLED)." };
  }
  const hasBank = !!(input.bankAccountNumber && input.bankIfsc);
  if (!hasBank && !input.upiVpa) {
    return { ok: false, error: "Add a payout bank account (account number + IFSC) before onboarding." };
  }
  if (!input.pan) {
    return { ok: false, error: "PAN is required by Cashfree before payouts can be enabled." };
  }

  // Normalise here too, so a caller that passes a raw UUID cannot reintroduce
  // the rejected format.
  const vendorId = toVendorId(input.vendorId);

  const payload: Record<string, unknown> = {
    vendor_id: vendorId,
    status: "ACTIVE",
    name: input.name,
    email: input.email,
    phone: input.phone,
    // schedule_option is deliberately OMITTED so the account's default
    // settlement cycle applies. Verified against the live sandbox: requesting
    // the instant cycles (8/9) is rejected unless they are enabled for the
    // merchant ("ScheduleId: 8 not enable for merchantId"). This account
    // defaults to T+2.
    ...(hasBank
      ? { bank: { account_number: input.bankAccountNumber, account_holder: input.name, ifsc: input.bankIfsc } }
      : {}),
    ...(!hasBank && input.upiVpa ? { upi: { vpa: input.upiVpa, account_holder: input.name } } : {}),
    // Cashfree validates business_type against a fixed list and rejects
    // anything else outright ("Others" is NOT accepted). Venue hire sits under
    // Travel and Hospitality.
    ...(input.pan
      ? { kyc_details: { account_type: "INDIVIDUAL", business_type: VENDOR_BUSINESS_TYPE, pan: input.pan } }
      : {}),
  };

  // Create is idempotent enough for our purposes: an existing vendor_id returns
  // a conflict, in which case we update instead.
  const created = await cfFetch<unknown>("/easy-split/vendors", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (created.ok) return { ok: true, data: readVendorStatus(vendorId, created.data) };

  const updated = await cfFetch<unknown>(`/easy-split/vendors/${encodeURIComponent(vendorId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  if (updated.ok) return { ok: true, data: readVendorStatus(vendorId, updated.data) };

  return { ok: false, error: created.error };
}

/** Reads a vendor's current Cashfree status (KYC may still be in progress). */
export async function getVendorStatus(vendorId: string): Promise<CfResult<VendorStatus>> {
  const res = await cfFetch<unknown>(`/easy-split/vendors/${encodeURIComponent(vendorId)}`, {
    method: "GET",
  });
  if (!res.ok) return res;
  return { ok: true, data: readVendorStatus(vendorId, res.data) };
}

// ── The payout itself ────────────────────────────────────────────────────────

export type SplitResult =
  | { ok: true; ownerAmount: number; vendorId: string }
  | { ok: false; reason: "disabled" | "no_vendor" | "vendor_not_active" | "nothing_to_split" | "gateway_error"; error: string };

/**
 * Assigns the owner's share of an already-PAID order to their vendor balance.
 *
 * Cashfree's Split After Payment API is used rather than order_splits at
 * creation time, because at creation we do not yet know whether the owner will
 * accept. `disable_split: true` closes the order to further splits so this can
 * never be applied twice at the gateway, on top of our own DB guard.
 *
 * amountToOwner is computed by the caller from authoritative database values —
 * this function never derives money from anything client-supplied.
 */
export async function splitOrderToVendor(params: {
  cashfreeOrderId: string;
  vendorId: string;
  amountToOwner: number;
}): Promise<SplitResult> {
  if (!isEasySplitEnabled()) {
    return { ok: false, reason: "disabled", error: "Easy Split is not enabled." };
  }
  if (!params.vendorId) {
    return { ok: false, reason: "no_vendor", error: "Owner has no Cashfree vendor id." };
  }
  if (!(params.amountToOwner > 0)) {
    return { ok: false, reason: "nothing_to_split", error: "Owner's share is zero." };
  }

  // Refuse to move money to a vendor Cashfree will not settle — otherwise the
  // split silently parks funds in a blocked balance.
  const status = await getVendorStatus(toVendorId(params.vendorId));
  if (!status.ok) {
    return { ok: false, reason: "gateway_error", error: status.error };
  }
  if (!status.data.settleable) {
    return {
      ok: false,
      reason: "vendor_not_active",
      error: `Owner's Cashfree vendor is ${status.data.status} — KYC must be complete before payout.`,
    };
  }

  const res = await cfFetch<unknown>(
    `/easy-split/orders/${encodeURIComponent(params.cashfreeOrderId)}/split`,
    {
      method: "POST",
      body: JSON.stringify({
        split: [{ vendor_id: toVendorId(params.vendorId), amount: Number(params.amountToOwner.toFixed(2)) }],
        // Hallnect's commission is simply the unsplit remainder. Closing the
        // order prevents any later split against the same payment.
        disable_split: true,
      }),
    },
  );

  if (!res.ok) return { ok: false, reason: "gateway_error", error: res.error };
  return { ok: true, ownerAmount: params.amountToOwner, vendorId: params.vendorId };
}

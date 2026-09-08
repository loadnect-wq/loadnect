// ─────────────────────────────────────────────────────────────────────────────
// lib/cashfree-payouts.ts — Cashfree PAYOUTS (SERVER-ONLY).
//
// THIS IS NOT THE PAYMENT GATEWAY, AND SHARES NOTHING WITH IT BUT THE COMPANY.
// Different host (/payout, not /pg), different API version (2024-01-01, not
// 2023-08-01) and — the one that costs an afternoon if you miss it — a
// SEPARATE CLIENT ID AND SECRET. Cashfree issues credentials per product; the
// gateway pair will authenticate against nothing here. An account where Payouts
// has not been switched on answers 403 `apis_not_enabled`, which reads exactly
// like a bad-credentials bug.
//
// Never logs a credential, a bank account number or a response body: the
// beneficiary payloads carry account numbers and IFSC codes.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import { constants, publicEncrypt } from "node:crypto";
import { optionalEnv } from "@/lib/env";

const PAYOUT_API_VERSION = "2024-01-01";

export type PayoutConfig = {
  clientId:     string;
  clientSecret: string;
  env:          "production" | "sandbox";
  baseUrl:      string;
};

/** Payouts mode. Follows CASHFREE_ENV so the gateway and payouts can never be
 *  pointed at different environments by accident. */
export function getPayoutMode(): "production" | "sandbox" {
  return optionalEnv("CASHFREE_ENV", "sandbox") === "production" ? "production" : "sandbox";
}

/** True only when BOTH payout credentials are present. Never throws. */
export function isPayoutsConfigured(): boolean {
  const id     = process.env.CASHFREE_PAYOUT_CLIENT_ID;
  const secret = process.env.CASHFREE_PAYOUT_CLIENT_SECRET;
  return typeof id === "string" && id.trim() !== ""
      && typeof secret === "string" && secret.trim() !== "";
}

export function getPayoutConfig(): PayoutConfig {
  const clientId     = (process.env.CASHFREE_PAYOUT_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.CASHFREE_PAYOUT_CLIENT_SECRET ?? "").trim();
  if (!clientId || !clientSecret) {
    throw new Error("Cashfree Payouts is not configured (CASHFREE_PAYOUT_CLIENT_ID / CASHFREE_PAYOUT_CLIENT_SECRET).");
  }
  const env = getPayoutMode();
  return {
    clientId,
    clientSecret,
    env,
    baseUrl: env === "production"
      ? "https://api.cashfree.com/payout"
      : "https://sandbox.cashfree.com/payout",
  };
}

/**
 * Rebuilds a PEM from however it survived being pasted into an env var.
 *
 * A PEM is header line, base64 wrapped at 64 columns, footer line — and OpenSSL
 * is strict about all three. Every common paste damages one of them: Vercel's
 * single-line inputs turn the newlines into spaces, shells turn them into
 * literal backslash-n, Windows adds carriage returns, and copying from a viewer
 * can drop them entirely. All of those produce exactly one error,
 * "DECODER routines::unsupported", which says nothing about which one happened.
 *
 * So rather than trust the shape, take the base64 out and lay it back down
 * correctly. A key with no header at all is treated as a bare SPKI body, which
 * is what you get copying the middle of the file.
 */
function normalisePem(raw: string): string {
  const text = raw.trim().replace(/\\n/g, "\n").replace(/\r/g, "");
  const match = text.match(/-----BEGIN ([A-Z ]+)-----([\s\S]*?)-----END \1-----/);
  const label = match ? match[1] : "PUBLIC KEY";
  const body  = (match ? match[2] : text).replace(/\s+/g, "");
  const lines = body.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
}

/** Why the signature could not be built, or null when it can be. Rendered on
 *  /admin/settings, because "Signature missing in the request" coming back from
 *  Cashfree does not tell an operator that OUR key failed to parse. */
export function payoutSignatureError(): string | null {
  const raw = (process.env.CASHFREE_PAYOUT_PUBLIC_KEY ?? "").trim();
  if (!raw) return "No CASHFREE_PAYOUT_PUBLIC_KEY is set.";
  if (/PRIVATE KEY/i.test(raw)) {
    return "That is a PRIVATE key. Cashfree's 2FA uses the PUBLIC key it generated for you — the one in the downloaded file, not a key of your own.";
  }
  try {
    publicEncrypt(
      { key: normalisePem(raw), padding: constants.RSA_PKCS1_OAEP_PADDING },
      Buffer.from("probe", "utf8"),
    );
    return null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return /DECODER|unsupported|asn1|PEM/i.test(msg)
      ? `The key could not be parsed (${msg}). Paste the whole file including the BEGIN and END lines. If Cashfree's download is password-protected, open it with the password they emailed and copy the key out of it first.`
      : `The key could not be used (${msg}).`;
  }
}

/**
 * TWO-FACTOR SIGNATURE, WHICH IS HOW YOU AUTHENTICATE FROM A DYNAMIC IP.
 *
 * Cashfree Payouts refuses a request whose source IP is not on the account's
 * allowlist. Vercel functions have no fixed egress IP (static IPs are a Secure
 * Compute feature, i.e. Enterprise), so an allowlist can never be satisfied from
 * this deployment. Cashfree's alternative is a signature:
 *
 *   base64( RSA-OAEP-encrypt( "<clientId>.<unix seconds>", publicKey ) )
 *
 * sent as X-Cf-Signature, valid for 10 minutes. The public key is generated in
 * the Cashfree dashboard under Payouts > Developers > Two-Factor Authentication.
 *
 * Returns null when no key is configured or the key will not parse, and the
 * header is then omitted — Cashfree answers "Signature missing in the request",
 * which is why payoutSignatureError() exists to say what actually went wrong.
 * NEVER throws, and never logs the key.
 */
function payoutSignature(clientId: string): string | null {
  const raw = (process.env.CASHFREE_PAYOUT_PUBLIC_KEY ?? "").trim();
  if (!raw) return null;
  try {
    const payload = `${clientId}.${Math.floor(Date.now() / 1000)}`;
    return publicEncrypt(
      { key: normalisePem(raw), padding: constants.RSA_PKCS1_OAEP_PADDING },
      Buffer.from(payload, "utf8"),
    ).toString("base64");
  } catch (e) {
    console.error("[payouts] could not build X-Cf-Signature:", e instanceof Error ? e.message : "unknown");
    return null;
  }
}

function payoutHeaders(cfg: PayoutConfig): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type":    "application/json",
    "x-api-version":   PAYOUT_API_VERSION,
    "x-client-id":     cfg.clientId,
    "x-client-secret": cfg.clientSecret,
  };
  const signature = payoutSignature(cfg.clientId);
  if (signature) headers["X-Cf-Signature"] = signature;
  return headers;
}

/** Whether a 2FA public key is configured, for the admin readout. */
export function hasPayoutSignatureKey(): boolean {
  return (process.env.CASHFREE_PAYOUT_PUBLIC_KEY ?? "").trim() !== "";
}

// ── Identifier shaping — Cashfree's charsets are narrow and they differ ──────

/**
 * beneficiary_id: alphanumeric plus _ | . — NO HYPHEN, max 50.
 * Our hall_owners.id is a UUID, whose hyphens are rejected. Stripping them
 * keeps all 32 hex characters, so the mapping back to the owner row stays exact
 * and collision-free. Easy Split already learned this the hard way.
 */
export function toBeneficiaryId(hallOwnerId: string): string {
  return hallOwnerId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 50);
}

/**
 * transfer_id. Cashfree contradicts itself between the Standard Transfer page
 * ("alphabets, numbers, underscore, hyphen") and the Batch page
 * ("alphanumeric"), so we take the INTERSECTION and emit [A-Za-z0-9] only.
 * Deterministic on (booking, attempt), which is what makes it an idempotency
 * key: a retry of the same attempt cannot become a second transfer.
 */
export function buildTransferId(bookingId: string, attempt: number): string {
  const core = bookingId.replace(/[^a-zA-Z0-9]/g, "");
  return `hn${core}${String(attempt).padStart(2, "0")}`;
}

/**
 * beneficiary_name: "only alphabets and whitespaces are allowed", max 100.
 *
 * This is not merely a format check. BENE_NAME_DIFFERS is a documented REVERSED
 * status code, so a name that passes the charset filter but does not match the
 * bank record can produce a transfer that reports SUCCESS and unwinds a day
 * later. Returns null when nothing usable survives, so the caller refuses
 * rather than sending a name Cashfree will reject.
 */
export function toBeneficiaryName(raw: string | null | undefined): string | null {
  const cleaned = (raw ?? "")
    .replace(/[^A-Za-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
  return cleaned.length >= 2 ? cleaned : null;
}

/** transfer_remarks: "alphabets, numbers and space" only. Keep it boring. */
export function toTransferRemarks(raw: string): string {
  return raw.replace(/[^A-Za-z0-9 ]/g, " ").replace(/\s+/g, " ").trim().slice(0, 70);
}

// ── Transport ───────────────────────────────────────────────────────────────

export type PayoutResult<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; error: string; status: number | null; code: string | null };

async function payoutFetch<T>(
  path: string,
  init: RequestInit,
): Promise<PayoutResult<T>> {
  let cfg: PayoutConfig;
  try { cfg = getPayoutConfig(); }
  catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Payouts not configured", status: null, code: "not_configured" }; }

  try {
    const res = await fetch(`${cfg.baseUrl}${path}`, {
      ...init,
      headers: { ...payoutHeaders(cfg), ...(init.headers ?? {}) },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });

    const text = await res.text();
    let body: Record<string, unknown> = {};
    let unreadable = false;
    try { body = text ? JSON.parse(text) : {}; } catch { unreadable = true; }

    // Status code and Cashfree's own error text only — never a success body,
    // which carries bank details.
    if (!res.ok) {
      const code = typeof body.code === "string" ? body.code
                 : typeof body.type === "string" ? body.type : null;
      // WHETHER THE BODY WAS EVEN JSON IS DIAGNOSTIC. Cashfree's application
      // errors are JSON with a `code`; an HTML or empty body on a 403 means the
      // request was refused BEFORE reaching the API — an IP allowlist or WAF —
      // which is a completely different fix from "the product is not enabled".
      // Without this the two were indistinguishable and both read as "403".
      const message = typeof body.message === "string" && body.message
        ? body.message
        : unreadable
          ? `HTTP ${res.status} with a non-JSON body: ${text.slice(0, 160).replace(/\s+/g, " ").trim()}`
          : `Cashfree Payouts returned HTTP ${res.status} with no error message`;
      console.error(`[payouts] ${init.method ?? "GET"} ${path} -> HTTP ${res.status}`, code ?? "(no code)", unreadable ? "(non-JSON body)" : "");
      return { ok: false, error: message, status: res.status, code };
    }

    if (unreadable) {
      // A 2xx we could not parse is NOT a success. Claiming otherwise is how a
      // transfer of unknown state gets recorded as fine.
      console.error(`[payouts] ${path} -> HTTP ${res.status} with an unreadable body`);
      return { ok: false, error: "Cashfree's response could not be read.", status: res.status, code: "unreadable" };
    }

    return { ok: true, data: body as T, status: res.status };
  } catch (e) {
    // Timeout or network failure. The caller MUST treat this as unknown, never
    // as a failure to send — the transfer may well have been accepted.
    const msg = e instanceof Error ? e.message : "unknown";
    console.error(`[payouts] ${path} did not complete:`, msg);
    return { ok: false, error: "Could not reach Cashfree Payouts.", status: null, code: "unreachable" };
  }
}

// ── Beneficiary ─────────────────────────────────────────────────────────────

export type BeneficiaryInput = {
  beneficiaryId:   string;
  name:            string;   // already passed through toBeneficiaryName
  email?:          string | null;
  phone?:          string | null;
  bankAccount:     string;
  ifsc:            string;
  address?:        string | null;
};

export type BeneficiaryState = {
  beneficiaryId: string;
  status: string | null;      // VERIFIED | INVALID | INITIATED | CANCELLED | FAILED | DELETED
};

/**
 * Registers a payout destination. Idempotent from our side: a 409 for an id
 * that already exists is treated as success and followed by a read, because the
 * owner genuinely does have a beneficiary.
 *
 * The OTHER 409 is not a retry and must never be auto-resolved:
 * `beneficiary_already_exists` means this account+IFSC pair is already
 * registered to a DIFFERENT beneficiary — two owners claiming one bank account.
 * That is a fraud and data-integrity signal for a human.
 */
export async function upsertBeneficiary(input: BeneficiaryInput): Promise<PayoutResult<BeneficiaryState>> {
  const body: Record<string, unknown> = {
    beneficiary_id:   input.beneficiaryId,
    beneficiary_name: input.name,
    beneficiary_instrument_details: {
      // Mutually mandatory — one without the other is a 400.
      bank_account_number: input.bankAccount,
      bank_ifsc:           input.ifsc,
    },
  };
  const contact: Record<string, unknown> = {};
  if (input.email) contact.beneficiary_email = input.email;
  if (input.phone) contact.beneficiary_phone = input.phone;
  if (input.address) contact.beneficiary_address = input.address;
  if (Object.keys(contact).length > 0) body.beneficiary_contact_details = contact;

  const created = await payoutFetch<Record<string, unknown>>("/beneficiary", {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (created.ok) {
    return {
      ok: true,
      status: created.status,
      data: {
        beneficiaryId: input.beneficiaryId,
        status: typeof created.data.beneficiary_status === "string" ? created.data.beneficiary_status : null,
      },
    };
  }

  if (created.status === 409 && created.code === "beneficiary_id_already_exists") {
    return getBeneficiary(input.beneficiaryId);
  }

  return created;
}

export async function getBeneficiary(beneficiaryId: string): Promise<PayoutResult<BeneficiaryState>> {
  const res = await payoutFetch<Record<string, unknown>>(
    `/beneficiary?beneficiary_id=${encodeURIComponent(beneficiaryId)}`,
    { method: "GET" },
  );
  if (!res.ok) return res;
  return {
    ok: true,
    status: res.status,
    data: {
      beneficiaryId,
      status: typeof res.data.beneficiary_status === "string" ? res.data.beneficiary_status : null,
    },
  };
}

// ── Transfers ───────────────────────────────────────────────────────────────

export type TransferState = {
  transferId:        string;
  cfTransferId:      string | null;
  status:            string;              // stored RAW
  statusCode:        string | null;
  statusDescription: string | null;
  utr:               string | null;
  serviceChargePaise: number | null;
  serviceTaxPaise:    number | null;
  raw:               Record<string, unknown>;
};

function readTransfer(body: Record<string, unknown>, fallbackId: string): TransferState {
  const num = (v: unknown): number | null => {
    const n = Number(v);
    return v == null || !Number.isFinite(n) ? null : Math.round(n * 100);
  };
  return {
    transferId:        typeof body.transfer_id === "string" ? body.transfer_id : fallbackId,
    cfTransferId:      typeof body.cf_transfer_id === "string" ? body.cf_transfer_id
                       : body.cf_transfer_id != null ? String(body.cf_transfer_id) : null,
    status:            typeof body.status === "string" ? body.status : "UNKNOWN",
    statusCode:        typeof body.status_code === "string" ? body.status_code : null,
    statusDescription: typeof body.status_description === "string" ? body.status_description : null,
    utr:               typeof body.transfer_utr === "string" ? body.transfer_utr : null,
    serviceChargePaise: num(body.transfer_service_charge),
    serviceTaxPaise:    num(body.transfer_service_tax),
    raw:               body,
  };
}

/**
 * Sends money. `transferId` MUST already exist in owner_payouts — it is written
 * before this call precisely so that a timeout is recoverable by asking
 * Cashfree what happened rather than guessing.
 *
 * `amountRupees` is converted from paise by the caller, in one place, because
 * the API takes rupees and this is the only boundary where that conversion is
 * allowed to happen.
 */
export async function createTransfer(input: {
  transferId:    string;
  beneficiaryId: string;
  amountRupees:  number;
  remarks:       string;
  transferMode?: string;
}): Promise<PayoutResult<TransferState>> {
  const res = await payoutFetch<Record<string, unknown>>("/transfers", {
    method: "POST",
    body: JSON.stringify({
      transfer_id:     input.transferId,
      transfer_amount: input.amountRupees,
      transfer_mode:   input.transferMode ?? "banktransfer",
      transfer_remarks: toTransferRemarks(input.remarks),
      beneficiary_details: { beneficiary_id: input.beneficiaryId },
    }),
  });
  if (!res.ok) return res;
  return { ok: true, status: res.status, data: readTransfer(res.data, input.transferId) };
}

/** The primary status source. Lookup by transfer_id, which we always have. */
export async function getTransfer(transferId: string): Promise<PayoutResult<TransferState>> {
  const res = await payoutFetch<Record<string, unknown>>(
    `/transfers?transfer_id=${encodeURIComponent(transferId)}`,
    { method: "GET" },
  );
  if (!res.ok) return res;
  return { ok: true, status: res.status, data: readTransfer(res.data, transferId) };
}

// ── Classification — the ONLY place Cashfree's vocabulary becomes ours ───────

export type PayoutSummary = "pending" | "in_flight" | "done" | "failed" | "reversed";

/**
 * Cashfree status -> (is this final?, what payments.split_status should say).
 *
 * SUCCESS IS TERMINAL FOR THE TRANSFER AND PROVISIONAL FOR THE MONEY: a bad
 * transfer can reverse to the payouts balance within 24 hours, so a row can
 * move done -> reversed afterwards. That backward transition is deliberate.
 *
 * FAILED IS DELIBERATELY NOT AUTO-RETRYABLE. Cashfree lists
 * RETURNED_FROM_BENEFICIARY, IMPS_MODE_FAIL, NRE_ACCOUNT_FAIL, ACCOUNT_BLOCKED
 * and DEST_LIMIT_REACHED under BOTH FAILED and REVERSED, so a FAILED carrying
 * one of those codes may mean the debit never happened OR that it happened and
 * unwound. Until that is confirmed, a human decides. A wrong guess is a double
 * payment.
 */
export function classifyTransfer(status: string): { terminal: boolean; summary: PayoutSummary } {
  switch (status.toUpperCase()) {
    case "SUCCESS":
      return { terminal: true, summary: "done" };
    case "REVERSED":
      return { terminal: true, summary: "reversed" };
    case "REJECTED":
    case "MANUALLY_REJECTED":
    case "FAILED":
      return { terminal: true, summary: "failed" };
    case "RECEIVED":
    case "QUEUED":
    case "PENDING":
    case "VALIDATION_PENDING":
    case "APPROVAL_PENDING":
      return { terminal: false, summary: "in_flight" };
    default:
      // An unrecognised status is NOT terminal: leaving it open keeps it in the
      // reconcile sweep, where the truth eventually arrives. Marking it
      // terminal would strand it, and marking it failed could pay twice.
      console.warn(`[payouts] unrecognised transfer status ${JSON.stringify(status)} — treating as in flight`);
      return { terminal: false, summary: "in_flight" };
  }
}

// ── Live configuration probe, for /admin/settings ───────────────────────────

export type PayoutsHealth = {
  configured:          boolean;
  mode:                "production" | "sandbox" | null;
  apiBaseUrl:          string | null;
  clientIdMasked:      string | null;
  /** null = could not be determined (an outage proves nothing either way). */
  credentialsAccepted: boolean | null;
  error:               string | null;
  /** Cashfree answers 403 apis_not_enabled when Payouts is not switched on for
   *  the account. It reads exactly like a credentials bug, so name it. */
  notActivated:        boolean;
  /** A 2FA public key is configured, so requests carry X-Cf-Signature and do
   *  not depend on this server's IP being allowlisted. */
  signatureConfigured: boolean;
  /** Why the signature could not be built, when a key IS set but unusable.
   *  Without this, our own parse failure surfaced only as Cashfree's
   *  "Signature missing in the request", which points at the wrong thing. */
  signatureError: string | null;
};

/**
 * Asks Cashfree whether these Payouts credentials work, without moving money.
 *
 * The probe is a GET for a beneficiary that cannot exist: a 404 means we
 * authenticated fine and the record simply is not there. It creates nothing and
 * is safe on every page load — the same shape as the gateway probe, and it
 * exists for the same reason: the credentials are write-only in Vercel, so
 * "are we actually able to pay anyone?" is otherwise unanswerable.
 */
export async function checkPayoutsHealth(): Promise<PayoutsHealth> {
  const base: PayoutsHealth = {
    configured: false, mode: null, apiBaseUrl: null, clientIdMasked: null,
    credentialsAccepted: null, error: null, notActivated: false,
    signatureConfigured: hasPayoutSignatureKey(),
    signatureError: hasPayoutSignatureKey() ? payoutSignatureError() : null,
  };
  if (!isPayoutsConfigured()) return base;

  const cfg = getPayoutConfig();
  const health: PayoutsHealth = {
    ...base,
    configured: true,
    mode: cfg.env,
    apiBaseUrl: cfg.baseUrl,
    clientIdMasked: `${cfg.clientId.slice(0, 4)}…${cfg.clientId.slice(-4)}`,
  };

  const probe = await getBeneficiary("hallnect_healthcheck_nonexistent");
  if (probe.ok) return { ...health, credentialsAccepted: true };

  if (probe.status === 404) return { ...health, credentialsAccepted: true };
  if (probe.status === 401) {
    return { ...health, credentialsAccepted: false, error: "Cashfree rejected these Payouts credentials. They are a SEPARATE pair from the gateway keys." };
  }
  if (probe.status === 403) {
    return {
      ...health, credentialsAccepted: false, notActivated: true,
      // Cashfree's own words first, then the interpretation. Replacing their
      // message with ours threw away the only thing that says WHICH 403 this is.
      error:
        `Cashfree returned 403. Their message: ${probe.error}`
        + (probe.code ? ` (code ${probe.code})` : "")
        + (hasPayoutSignatureKey()
            ? " — a 2FA public key IS configured, so this is not the IP allowlist. Either Payouts is"
              + " not enabled for the account, or the V2 API does not accept X-Cf-Signature."
            : " — no 2FA public key is configured, so these requests are authenticated by IP alone."
              + " Vercel functions have no fixed egress IP, so an allowlist can never be satisfied"
              + " from here. Generate a public key in the Cashfree dashboard (Payouts > Developers >"
              + " Two-Factor Authentication) and set CASHFREE_PAYOUT_PUBLIC_KEY."),
    };
  }
  if (probe.status !== null && probe.status >= 500) {
    // An outage proves nothing about the credentials. Unknown is honest.
    return { ...health, credentialsAccepted: null, error: `Cashfree returned HTTP ${probe.status} — its API is having trouble, so this could not be checked.` };
  }
  return { ...health, credentialsAccepted: null, error: probe.error };
}

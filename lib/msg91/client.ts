// ─────────────────────────────────────────────────────────────────────────────
// lib/msg91/client.ts — the single HTTP path to MSG91 (SERVER-ONLY).
//
// THE TRAP THIS FILE EXISTS TO CLOSE
//   MSG91 answers HTTP 200 for logical failures. "OTP not match", "OTP
//   expired", "template not found", "insufficient balance" all arrive as
//     200 OK  {"message":"...","type":"error"}
//   Code that trusts `res.ok` therefore treats a WRONG OTP as a successful
//   verification. Every response is parsed and judged on the `type` field
//   here, in one place, so no caller can get that wrong.
//
// The 401 case is the only one decided by the status code, and it means the
// auth key is missing or invalid.
//
// RETRIES are deliberately narrow: network errors, timeouts, 5xx, and the two
// PROVIDER-STATE refusals (empty wallet, template awaiting DLT approval).
// A logical error is never retried — resending "flow id missing" five times
// just spends five times as long failing, and a send MSG91 accepted must never
// be replayed.
//
// LOGGING: status, endpoint and MSG91's own message. Never the auth key,
// never a full URL (it carries the key and the recipient), never an OTP.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import { MSG91_API_BASE, MSG91_TIMEOUT_MS, msg91AuthKey } from "./config";

/** How MSG91 failed, in terms a caller can branch on. */
export type Msg91ErrorKind =
  | "not_configured"   // no auth key on this deployment
  | "auth"             // 401 — key rejected
  | "invalid_request"  // bad number, missing template, malformed params
  | "rejected"         // MSG91 understood and refused (DLT, blacklist)
  | "balance"          // wallet empty — refused now, identical message sends after a top-up
  | "template_state"   // DLT template not approved/found YET — sends unchanged once approval lands
  | "rate_limited"
  | "timeout"
  | "network"
  | "server"           // 5xx
  | "unknown";

export type Msg91Response =
  | { ok: true; message: string; raw: unknown }
  | { ok: false; kind: Msg91ErrorKind; detail: string; raw?: unknown };

/**
 * True when retrying could plausibly succeed. Anything MSG91 has already
 * judged (auth, invalid, rejected) is permanent — attemptSend marks those rows
 * so the admin UI does not offer a retry that is guaranteed to fail again.
 *
 * "balance" and "template_state" are the two refusals that are NOT the
 * provider's final word: both describe an account state that someone else
 * changes on their own timetable (a top-up, a DLT approval), after which the
 * byte-identical message goes out.
 */
export function isTransientMsg91Error(kind: Msg91ErrorKind): boolean {
  return kind === "timeout" || kind === "network" || kind === "server"
    || kind === "rate_limited" || kind === "balance" || kind === "template_state";
}

/** Inverse of the above, for readability at call sites. */
export function isPermanentMsg91Error(kind: Msg91ErrorKind): boolean {
  return !isTransientMsg91Error(kind);
}

/**
 * Maps MSG91's human-readable error text onto a kind.
 *
 * Substring matching is unavoidable — these endpoints carry no stable error
 * code — so the DEFAULT is what matters: anything unrecognised is "rejected",
 * i.e. permanent. Defaulting to transient would put unknown failures into a
 * retry loop that spends the account balance.
 */
function classifyMessage(message: string): Msg91ErrorKind {
  const m = message.toLowerCase();
  // BALANCE IS NOT A PERMANENT REFUSAL. Most of what MSG91 "judges" stays
  // judged: a malformed request is malformed on the tenth attempt too. An
  // empty wallet is different — the message is refused now and the
  // byte-identical message sends the moment the account is topped up. Left in
  // the default "rejected" bucket it marked the row permanent_failure, and the
  // admin UI then said "Retry will not help", which is the exact opposite of
  // the truth. Every booking confirmation queued while the balance sat at zero
  // would have been silently abandoned with no way to send it afterwards.
  // Checked first, because "insufficient" would otherwise never be reached.
  if (m.includes("balance") || m.includes("insufficient") || m.includes("credit")) return "balance";
  if (m.includes("authkey") || m.includes("authentication") || m.includes("unauthorized")) return "auth";
  // THE SAME ARGUMENT AS BALANCE, FOR THE OTHER THING WE DO NOT CONTROL.
  // "template not found" / "template not approved" is what MSG91 answers while
  // a DLT template is still working through operator approval — a queue run by
  // the telco, on nobody's schedule but their own. Left in the "rejected"
  // default it marked the row permanent_failure and the admin UI said "Retry
  // will not help", so every message queued during the approval wait was
  // abandoned even though the identical body sends the moment approval lands.
  // Checked BEFORE the "not found"/"invalid" line below, which would otherwise
  // swallow it as invalid_request.
  //
  // The cost of being wrong here is bounded and small: a template id that is
  // genuinely wrong stays retryable, and MAX_SEND_ATTEMPTS in
  // lib/notifications/service.ts stops the row after five tries.
  if (m.includes("template") || m.includes("dlt")) {
    if (m.includes("not approved") || m.includes("unapproved") || m.includes("not found")
      || m.includes("not registered") || m.includes("not active") || m.includes("inactive")
      || m.includes("pending") || m.includes("approval") || m.includes("under review")) {
      return "template_state";
    }
  }
  if (m.includes("expired") || m.includes("not match") || m.includes("mismatch")) return "invalid_request";
  if (m.includes("invalid") || m.includes("missing") || m.includes("not found") || m.includes("required")) {
    return "invalid_request";
  }
  if (m.includes("limit") || m.includes("too many") || m.includes("max retry")) return "rate_limited";
  return "rejected";
}

/** MSG91's envelope. On success `message` doubles as the request id. */
type Envelope = { message?: unknown; type?: unknown };

function readEnvelope(body: unknown): { type: string; message: string } | null {
  if (typeof body !== "object" || body === null) return null;
  const e = body as Envelope;
  if (typeof e.type !== "string") return null;
  const message =
    typeof e.message === "string"
      ? e.message
      : e.message === undefined || e.message === null
        ? ""
        : JSON.stringify(e.message);
  return { type: e.type.toLowerCase(), message };
}

export type Msg91RequestInit = {
  /** Path under /api/v5 — "otp", "otp/verify", "otp/retry", "flow". */
  path: string;
  method: "GET" | "POST";
  /** Query parameters. Undefined and empty values are dropped. */
  query?: Record<string, string | undefined>;
  /** JSON body for POST. */
  body?: unknown;
  /**
   * Also put the auth key in the query string. The header form works on every
   * v5 endpoint; the OTP endpoints additionally document the query form, and
   * sending both costs nothing.
   */
  authInQuery?: boolean;
  /** Retries for TRANSIENT failures only. 0 disables. */
  retries?: number;
};

/** One MSG91 call. Never throws — every outcome is a value. */
export async function msg91Request(init: Msg91RequestInit): Promise<Msg91Response> {
  const authkey = msg91AuthKey();
  if (!authkey) {
    return { ok: false, kind: "not_configured", detail: "MSG91_AUTH_KEY is not set" };
  }

  const url = new URL(`${MSG91_API_BASE}/${init.path.replace(/^\/+/, "")}`);
  for (const [k, v] of Object.entries(init.query ?? {})) {
    if (v !== undefined && v !== "") url.searchParams.set(k, v);
  }
  if (init.authInQuery) url.searchParams.set("authkey", authkey);

  const maxAttempts = Math.max(1, (init.retries ?? 1) + 1);
  let last: Msg91Response = { ok: false, kind: "unknown", detail: "no attempt was made" };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    last = await once(url, init, authkey);
    if (last.ok) return last;
    if (!isTransientMsg91Error(last.kind)) return last;
    if (attempt < maxAttempts) {
      // Linear back-off, short: this runs inside a request a customer is
      // waiting on.
      await new Promise((r) => setTimeout(r, 300 * attempt));
    }
  }
  return last;
}

async function once(
  url: URL,
  init: Msg91RequestInit,
  authkey: string,
): Promise<Msg91Response> {
  try {
    const res = await fetch(url, {
      method: init.method,
      headers: {
        authkey,
        accept: "application/json",
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(MSG91_TIMEOUT_MS),
      cache: "no-store",
    });

    if (res.status === 401 || res.status === 403) {
      console.error(`[msg91] ${init.path}: credentials rejected (HTTP ${res.status})`);
      return { ok: false, kind: "auth", detail: "MSG91 rejected the auth key" };
    }
    if (res.status === 429) {
      return { ok: false, kind: "rate_limited", detail: "MSG91 rate limit reached" };
    }
    if (res.status >= 500) {
      console.error(`[msg91] ${init.path}: HTTP ${res.status}`);
      return { ok: false, kind: "server", detail: `MSG91 returned HTTP ${res.status}` };
    }

    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      // A non-JSON 2xx is not a success we can act on: there is no request id
      // to read, so a later delivery report could never be matched to a row.
      console.error(`[msg91] ${init.path}: unreadable response (HTTP ${res.status})`);
      return { ok: false, kind: "unknown", detail: "MSG91 returned an unreadable response" };
    }

    const env = readEnvelope(parsed);
    if (!env) {
      console.error(`[msg91] ${init.path}: unexpected response shape (HTTP ${res.status})`);
      return { ok: false, kind: "unknown", detail: "MSG91 returned an unexpected response", raw: parsed };
    }

    // THE POINT OF THIS FILE: judged on type, never on res.ok.
    if (env.type === "success") {
      return { ok: true, message: env.message, raw: parsed };
    }

    const kind = classifyMessage(env.message);
    return { ok: false, kind, detail: env.message || "MSG91 refused the request", raw: parsed };
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      return { ok: false, kind: "timeout", detail: "MSG91 did not respond in time" };
    }
    console.error(`[msg91] ${init.path}: network error`, e instanceof Error ? e.message : "unknown");
    return { ok: false, kind: "network", detail: "Could not reach MSG91" };
  }
}

/**
 * MSG91 wants a bare international number with no "+" — "919344040013".
 * Everything else in this codebase holds E.164 ("+919344040013"), because that
 * is what the database constraint and the other integrations use, so the
 * conversion happens here and only here.
 */
export function toMsg91Mobile(e164: string): string {
  return e164.replace(/\D/g, "");
}

// ─────────────────────────────────────────────────────────────────────────────
// lib/msg91/sms.ts — transactional SMS via the MSG91 Flow API (SERVER-ONLY).
//
// ENDPOINT (verified against docs.msg91.com and api.msg91.com/apidoc, 2026-08-30):
//   POST https://control.msg91.com/api/v5/flow
//   headers: authkey, content-type: application/json
//   body:    { template_id, sender, short_url, recipients: [{ mobiles, var1, … }] }
//   success: 200 {"message":"<request id>","type":"success"}
//   failure: 200 {"message":"flow id missing","type":"error"}   ← still HTTP 200
//
// WHY THERE IS NO FREE-TEXT SEND FUNCTION
//   Indian A2P SMS is governed by TRAI's DLT regime: every message body must be
//   pre-registered against the sender header, and anything that does not match
//   a registered template is dropped by the operator. A sendSms(phone, text)
//   helper would therefore be a function that silently does nothing in
//   production, so it does not exist. The only way to send is with a template
//   id, and lib/notifications/sms-templates.ts owns those.
//
// TEST MODE redirects the RECIPIENT and nothing else — same template, same
// variables — so what is exercised is the real send path, not a simulation.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import {
  isSmsEnabled,
  isSmsTestMode,
  msg91SenderId,
  smsTestRecipient,
  isMsg91Configured,
} from "./config";
import {
  msg91Request,
  toMsg91Mobile,
  isPermanentMsg91Error,
  type Msg91ErrorKind,
} from "./client";
import { normalizePhoneE164 } from "@/lib/notifications/phone";

export type SendSmsInput = {
  /** E.164, e.g. "+919344040013". */
  toE164: string;
  /** MSG91 template id (24 hex characters) for a DLT-approved body. */
  templateId: string;
  /** Positional values; index 0 becomes var1. */
  variables: readonly string[];
};

export type SendSmsResult =
  | {
      ok: true;
      /** MSG91's request id — the key delivery reports arrive under. */
      providerMessageId: string;
      /** Non-null when TEST MODE diverted this message. */
      redirectedTo: string | null;
    }
  | { ok: false; kind: Msg91ErrorKind; detail: string; permanent: boolean };

/**
 * Sends one templated SMS.
 *
 * Callers do not check isSmsEnabled() first — the guard lives here, so a new
 * call site cannot accidentally bypass the master switch.
 */
export async function sendTemplatedSms(input: SendSmsInput): Promise<SendSmsResult> {
  if (!isSmsEnabled()) {
    return {
      ok: false,
      kind: "not_configured",
      detail: "SMS is disabled (MSG91_SMS_ENABLED != true)",
      permanent: true,
    };
  }

  const sender = msg91SenderId();
  if (!isMsg91Configured() || !sender) {
    return {
      ok: false,
      kind: "not_configured",
      detail: "MSG91 auth key or sender ID is not configured",
      permanent: true,
    };
  }

  // ── Test-mode redirect ────────────────────────────────────────────────────
  // A test mode with no destination must FAIL LOUDLY. Falling through to the
  // real recipient would be the exact accident the flag exists to prevent.
  let destination = input.toE164;
  let redirectedTo: string | null = null;
  if (isSmsTestMode()) {
    const raw = smsTestRecipient();
    const test = raw ? normalizePhoneE164(raw) : null;
    if (!test) {
      return {
        ok: false,
        kind: "not_configured",
        detail: "MSG91_TEST_MODE is on but MSG91_TEST_TO is missing or not a valid number",
        permanent: true,
      };
    }
    destination = test;
    redirectedTo = test;
  }

  // Positional → named. MSG91 templates declare ##var1##, ##var2##, … and the
  // Flow API matches by NAME, case-sensitively. Generating the names from the
  // index keeps the template registry's positional contract and the wire
  // format mechanically in step: they cannot drift apart by hand.
  const recipient: Record<string, string> = { mobiles: toMsg91Mobile(destination) };
  input.variables.forEach((v, i) => {
    recipient[`var${i + 1}`] = String(v ?? "");
  });

  const res = await msg91Request({
    path: "flow",
    method: "POST",
    retries: 1,
    body: {
      template_id: input.templateId,
      sender,
      // Never shorten links. MSG91's shortener rewrites URLs to its own
      // domain, which breaks the exact body DLT approved and makes an official
      // message look like a redirector.
      short_url: "0",
      recipients: [recipient],
    },
  });

  if (res.ok) {
    return { ok: true, providerMessageId: res.message, redirectedTo };
  }

  return {
    ok: false,
    kind: res.kind,
    detail: res.detail,
    permanent: isPermanentMsg91Error(res.kind),
  };
}

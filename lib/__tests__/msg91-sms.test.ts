// ─────────────────────────────────────────────────────────────────────────────
// lib/__tests__/msg91-sms.test.ts — the transactional SMS send path.
//
// Three properties, in order of how much damage getting them wrong does:
//   1. TEST MODE WITH NO DESTINATION MUST FAIL, not fall through to the real
//      recipient. Falling through is precisely the accident the flag exists to
//      prevent, and it would be discovered by a customer, not by us.
//   2. The master switch is enforced INSIDE the transport, so a new call site
//      cannot bypass it.
//   3. Positional variables become var1..varN, matching what the template
//      registry generates for the MSG91 panel. A drift here mis-fills every
//      message with the right words in the wrong slots.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendTemplatedSms } from "@/lib/msg91/sms";

const ENV = [
  "MSG91_AUTH_KEY", "MSG91_SENDER_ID", "MSG91_SMS_ENABLED",
  "MSG91_TEST_MODE", "MSG91_TEST_TO",
] as const;
const saved: Record<string, string | undefined> = {};
const TEMPLATE = "0123456789abcdef01234567";
const PHONE = "+919344040013";

function stubFetch(status: number, body: unknown) {
  const spy = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", spy);
  return spy;
}

function bodyOf(spy: ReturnType<typeof stubFetch>) {
  const [, init] = spy.mock.calls[0] as unknown as [URL, RequestInit];
  return JSON.parse(String(init.body)) as {
    template_id: string;
    sender: string;
    short_url: string;
    recipients: Array<Record<string, string>>;
  };
}

beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  process.env.MSG91_AUTH_KEY = "test-auth-key";
  process.env.MSG91_SENDER_ID = "HLNECT";
  process.env.MSG91_SMS_ENABLED = "true";
  delete process.env.MSG91_TEST_MODE;
  delete process.env.MSG91_TEST_TO;
});

afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const send = (variables: string[] = ["Asha", "Grand Hall"]) =>
  sendTemplatedSms({ toE164: PHONE, templateId: TEMPLATE, variables });

describe("the master switch and configuration", () => {
  it("sends nothing when MSG91_SMS_ENABLED is unset (the default is OFF)", async () => {
    delete process.env.MSG91_SMS_ENABLED;
    const spy = stubFetch(200, { type: "success", message: "req" });
    const r = await send();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.permanent).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it.each(["false", "0", "no", "TRUEISH"])("treats MSG91_SMS_ENABLED=%s as off", async (v) => {
    process.env.MSG91_SMS_ENABLED = v;
    const spy = stubFetch(200, { type: "success", message: "req" });
    await send();
    expect(spy).not.toHaveBeenCalled();
  });

  it("refuses without a sender ID", async () => {
    delete process.env.MSG91_SENDER_ID;
    const spy = stubFetch(200, { type: "success", message: "req" });
    const r = await send();
    expect(r.ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("treats a sender ID that is not a valid header as MISSING", async () => {
    process.env.MSG91_SENDER_ID = "not a valid header!";
    const spy = stubFetch(200, { type: "success", message: "req" });
    const r = await send();
    expect(r.ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("upper-cases the sender header", async () => {
    process.env.MSG91_SENDER_ID = "hlnect";
    const spy = stubFetch(200, { type: "success", message: "req" });
    await send();
    expect(bodyOf(spy).sender).toBe("HLNECT");
  });
});

describe("test mode", () => {
  it("FAILS rather than messaging the real recipient when MSG91_TEST_TO is missing", async () => {
    process.env.MSG91_TEST_MODE = "true";
    const spy = stubFetch(200, { type: "success", message: "req" });
    const r = await send();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detail).toMatch(/MSG91_TEST_TO/);
    expect(spy).not.toHaveBeenCalled();
  });

  it("FAILS when MSG91_TEST_TO is not a valid number", async () => {
    process.env.MSG91_TEST_MODE = "true";
    process.env.MSG91_TEST_TO = "934404001";  // 9 digits — not a real number
    const spy = stubFetch(200, { type: "success", message: "req" });
    const r = await send();
    expect(r.ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("redirects the recipient and reports that it did", async () => {
    process.env.MSG91_TEST_MODE = "true";
    process.env.MSG91_TEST_TO = "+919999999999";
    const spy = stubFetch(200, { type: "success", message: "req" });
    const r = await send();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.redirectedTo).toBe("+919999999999");
    expect(bodyOf(spy).recipients[0].mobiles).toBe("919999999999");
  });

  it("goes to the real recipient when test mode is off, and says so", async () => {
    const spy = stubFetch(200, { type: "success", message: "req" });
    const r = await send();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.redirectedTo).toBeNull();
    expect(bodyOf(spy).recipients[0].mobiles).toBe("919344040013");
  });
});

describe("the wire format", () => {
  it("maps positional variables onto var1..varN", async () => {
    const spy = stubFetch(200, { type: "success", message: "req" });
    await send(["Asha", "Grand Hall", "12 Sep 2026"]);
    const recipient = bodyOf(spy).recipients[0];
    expect(recipient.var1).toBe("Asha");
    expect(recipient.var2).toBe("Grand Hall");
    expect(recipient.var3).toBe("12 Sep 2026");
    expect(recipient.var4).toBeUndefined();
  });

  it("never asks MSG91 to shorten links", async () => {
    // The shortener rewrites URLs to another domain, which breaks the exact
    // body DLT approved and makes an official message look like a redirector.
    const spy = stubFetch(200, { type: "success", message: "req" });
    await send();
    expect(bodyOf(spy).short_url).toBe("0");
  });

  it("posts the template id to /api/v5/flow", async () => {
    const spy = stubFetch(200, { type: "success", message: "req" });
    await send();
    const [url] = spy.mock.calls[0] as unknown as [URL];
    expect(url.pathname).toBe("/api/v5/flow");
    expect(bodyOf(spy).template_id).toBe(TEMPLATE);
  });

  it("returns MSG91's request id, which is how delivery reports are matched", async () => {
    stubFetch(200, { type: "success", message: "5762846b4f8d285d378b4567" });
    const r = await send();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.providerMessageId).toBe("5762846b4f8d285d378b4567");
  });
});

describe("failure classification", () => {
  it("marks an unrecognised refusal as PERMANENT so the admin UI offers no retry", async () => {
    stubFetch(200, { type: "error", message: "number is blacklisted" });
    const r = await send();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.permanent).toBe(true);
  });

  it("marks a template awaiting DLT APPROVAL as transient, so it survives the wait", async () => {
    // This assertion used to read the other way, with "template not found"
    // standing in for a permanent refusal. That was the bug: DLT approval is a
    // queue run by the operator, and a row marked permanent_failure says
    // "Retry will not help" — so every booking confirmation raised while a
    // template sat in review was abandoned, even though the identical body
    // sends the moment approval lands.
    for (const msg of [
      "template not found",
      "Template is not approved",
      "DLT template approval pending",
    ]) {
      stubFetch(200, { type: "error", message: msg });
      const r = await send();
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.permanent, `"${msg}" should be retryable`).toBe(false);
    }
  });

  it("marks a provider outage as TRANSIENT so it stays retryable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 502 })));
    const r = await send();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.permanent).toBe(false);
  });

  it("does not treat a 200 with type:error as sent", async () => {
    stubFetch(200, { type: "error", message: "insufficient balance" });
    const r = await send();
    expect(r.ok).toBe(false);
  });

  it("marks an EMPTY WALLET as transient, so the message survives a top-up", async () => {
    // The one refusal that is not permanent. A wrong template id is still
    // wrong on the tenth attempt; an empty wallet is not — the identical
    // message sends the moment the account is funded. Marked permanent, the
    // row reads "Retry will not help" and every booking confirmation queued
    // while the balance was zero is abandoned with no way to send it later.
    for (const msg of [
      "insufficient balance",
      "Insufficient Credits",
      "Your account balance is low",
    ]) {
      stubFetch(200, { type: "error", message: msg });
      const r = await send();
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.permanent, `"${msg}" should be retryable`).toBe(false);
    }
  });
});

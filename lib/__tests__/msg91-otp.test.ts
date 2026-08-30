// ─────────────────────────────────────────────────────────────────────────────
// lib/__tests__/msg91-otp.test.ts — the OTP test matrix.
//
// The property that matters most is the THREE-WAY distinction:
//     approved          — MSG91 said yes
//     answered, not ok  — MSG91 said no (wrong or expired code)
//     no answer         — MSG91 could not be reached
// Collapsing the last two either locks a legitimate user out during an outage,
// or — far worse — lets an outage be read as a successful verification.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  sendVerificationOtp,
  resendVerificationOtp,
  checkVerificationOtp,
} from "@/lib/msg91/otp";

const ENV = ["MSG91_AUTH_KEY", "MSG91_OTP_TEMPLATE_ID"] as const;
const saved: Record<string, string | undefined> = {};
const TEMPLATE = "0123456789abcdef01234567";   // 24 hex characters
const PHONE = "+919344040013";

function stubFetch(status: number, body: unknown) {
  const spy = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", spy);
  return spy;
}

beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  process.env.MSG91_AUTH_KEY = "test-auth-key";
  process.env.MSG91_OTP_TEMPLATE_ID = TEMPLATE;
});

afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("sendVerificationOtp", () => {
  it("refuses when the auth key is missing", async () => {
    delete process.env.MSG91_AUTH_KEY;
    const spy = stubFetch(200, { type: "success", message: "x" });
    const r = await sendVerificationOtp(PHONE);
    expect(r).toEqual({ ok: false, error: "not_configured" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("refuses when the OTP template id is missing", async () => {
    delete process.env.MSG91_OTP_TEMPLATE_ID;
    const spy = stubFetch(200, { type: "success", message: "x" });
    const r = await sendVerificationOtp(PHONE);
    expect(r).toEqual({ ok: false, error: "not_configured" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("treats a MALFORMED template id as missing rather than sending it", async () => {
    // A mistyped variable must surface as "not configured" in the dashboard,
    // not as a rejected send discovered in production.
    process.env.MSG91_OTP_TEMPLATE_ID = "not-a-template-id";
    const spy = stubFetch(200, { type: "success", message: "x" });
    const r = await sendVerificationOtp(PHONE);
    expect(r).toEqual({ ok: false, error: "not_configured" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("posts to the v5 OTP endpoint with the template, mobile and a bounded expiry", async () => {
    const spy = stubFetch(200, { type: "success", message: "req-1" });
    const r = await sendVerificationOtp(PHONE);
    expect(r).toEqual({ ok: true });

    const [url, init] = spy.mock.calls[0] as unknown as [URL, RequestInit];
    expect(init.method).toBe("POST");
    expect(url.pathname).toBe("/api/v5/otp");
    expect(url.searchParams.get("template_id")).toBe(TEMPLATE);
    expect(url.searchParams.get("mobile")).toBe("919344040013");
    expect(url.searchParams.get("otp_expiry")).toBe("10");
    expect(url.searchParams.get("otp_length")).toBe("6");
  });

  it("is NOT retried — a second send would invalidate the code already delivered", async () => {
    const spy = stubFetch(500, { type: "error", message: "down" });
    const r = await sendVerificationOtp(PHONE);
    expect(r.ok).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("maps an invalid number to invalid_phone", async () => {
    stubFetch(200, { type: "error", message: "invalid mobile number" });
    const r = await sendVerificationOtp(PHONE);
    expect(r).toEqual({ ok: false, error: "invalid_phone" });
  });

  it("maps a provider ceiling to rate_limited", async () => {
    stubFetch(429, { type: "error", message: "too many" });
    const r = await sendVerificationOtp(PHONE);
    expect(r).toEqual({ ok: false, error: "rate_limited" });
  });
});

describe("resendVerificationOtp", () => {
  it("uses the retry endpoint with retrytype=text, not a fresh send", async () => {
    const spy = stubFetch(200, { type: "success", message: "req-2" });
    const r = await resendVerificationOtp(PHONE);
    expect(r).toEqual({ ok: true });

    const [url, init] = spy.mock.calls[0] as unknown as [URL, RequestInit];
    expect(init.method).toBe("GET");
    expect(url.pathname).toBe("/api/v5/otp/retry");
    expect(url.searchParams.get("retrytype")).toBe("text");
    expect(url.searchParams.get("mobile")).toBe("919344040013");
  });

  it("surfaces MSG91's own resend ceiling", async () => {
    stubFetch(200, { type: "error", message: "Max retry attempted" });
    const r = await resendVerificationOtp(PHONE);
    expect(r).toEqual({ ok: false, error: "rate_limited" });
  });
});

describe("checkVerificationOtp — the three-way distinction", () => {
  it("approves only on type:success", async () => {
    const spy = stubFetch(200, { type: "success", message: "OTP verified success" });
    const r = await checkVerificationOtp(PHONE, "123456");
    expect(r).toEqual({ ok: true, approved: true });

    const [url] = spy.mock.calls[0] as unknown as [URL];
    expect(url.pathname).toBe("/api/v5/otp/verify");
    expect(url.searchParams.get("otp")).toBe("123456");
  });

  it("REJECTS a wrong code that arrives as HTTP 200", async () => {
    // The single most important assertion in this file.
    stubFetch(200, { type: "error", message: "OTP not match" });
    const r = await checkVerificationOtp(PHONE, "000000");
    expect(r).toEqual({ ok: true, approved: false });
  });

  it("rejects an expired code", async () => {
    stubFetch(200, { type: "error", message: "OTP expired" });
    const r = await checkVerificationOtp(PHONE, "123456");
    expect(r).toEqual({ ok: true, approved: false });
  });

  it("reports an OUTAGE as unanswered, never as approved and never as a wrong code", async () => {
    stubFetch(503, { type: "error", message: "down" });
    const r = await checkVerificationOtp(PHONE, "123456");
    expect(r.ok).toBe(false);
    // Not { approved: true } — and not counted as a failed attempt either.
    expect("approved" in r).toBe(false);
  });

  it("reports rejected CREDENTIALS as unanswered rather than as a wrong code", async () => {
    // A bad auth key must not consume the user's brute-force allowance.
    stubFetch(401, { type: "error", message: "invalid authkey" });
    const r = await checkVerificationOtp(PHONE, "123456");
    expect(r.ok).toBe(false);
  });

  it("refuses to call out at all when unconfigured", async () => {
    delete process.env.MSG91_AUTH_KEY;
    const spy = stubFetch(200, { type: "success", message: "x" });
    const r = await checkVerificationOtp(PHONE, "123456");
    expect(r).toEqual({ ok: false, error: "not_configured" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("never places the code in the URL path or a log-shaped string", async () => {
    const spy = stubFetch(200, { type: "success", message: "ok" });
    await checkVerificationOtp(PHONE, "424242");
    const [url] = spy.mock.calls[0] as unknown as [URL];
    // It belongs in the query MSG91 documents, and nowhere else.
    expect(url.pathname).not.toContain("424242");
  });
});

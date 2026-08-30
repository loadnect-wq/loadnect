// ─────────────────────────────────────────────────────────────────────────────
// lib/__tests__/msg91-client.test.ts — the HTTP-200-on-failure trap.
//
// MSG91 answers 200 OK for logical failures:
//     200 {"type":"error","message":"OTP not match"}
// Code that trusts `res.ok` therefore reads a WRONG OTP as a successful
// verification. That single property is what this file exists to pin down;
// everything else here defends the classification that follows from it.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  msg91Request,
  toMsg91Mobile,
  isTransientMsg91Error,
  isPermanentMsg91Error,
} from "@/lib/msg91/client";

const ENV = ["MSG91_AUTH_KEY"] as const;
const saved: Record<string, string | undefined> = {};

/** A fetch stub returning one canned response. */
function stubFetch(status: number, body: unknown, opts: { json?: boolean } = {}) {
  const text = opts.json === false ? String(body) : JSON.stringify(body);
  const spy = vi.fn(async () => new Response(text, { status }));
  vi.stubGlobal("fetch", spy);
  return spy;
}

beforeEach(() => {
  for (const k of ENV) { saved[k] = process.env[k]; }
  process.env.MSG91_AUTH_KEY = "test-auth-key-1234";
});

afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("msg91Request — success is decided by `type`, not by the HTTP status", () => {
  it("treats 200 + type:error as a FAILURE", async () => {
    stubFetch(200, { message: "OTP not match", type: "error" });
    const r = await msg91Request({ path: "otp/verify", method: "GET" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detail).toBe("OTP not match");
  });

  it("treats 200 + type:success as a success and returns the request id", async () => {
    stubFetch(200, { message: "3763646c3058373530393938", type: "success" });
    const r = await msg91Request({ path: "flow", method: "POST", body: {} });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.message).toBe("3763646c3058373530393938");
  });

  it("does not accept a 200 whose body is not JSON", async () => {
    stubFetch(200, "<html>maintenance</html>", { json: false });
    const r = await msg91Request({ path: "flow", method: "POST", body: {} });
    // A 2xx with no readable request id cannot be matched to a delivery report
    // later, so it is not a success we can act on.
    expect(r.ok).toBe(false);
  });

  it("does not accept a 200 with an unrecognised shape", async () => {
    stubFetch(200, { ok: true });
    const r = await msg91Request({ path: "flow", method: "POST", body: {} });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe("unknown");
  });
});

describe("msg91Request — configuration and transport", () => {
  it("refuses without an auth key, and never calls out", async () => {
    delete process.env.MSG91_AUTH_KEY;
    const spy = stubFetch(200, { message: "x", type: "success" });
    const r = await msg91Request({ path: "otp", method: "POST" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe("not_configured");
    expect(spy).not.toHaveBeenCalled();
  });

  it("sends the auth key as a header, and in the query only when asked", async () => {
    const spy = stubFetch(200, { message: "x", type: "success" });
    await msg91Request({ path: "otp", method: "POST", authInQuery: true, query: { mobile: "919000000000" } });

    const [url, init] = spy.mock.calls[0] as unknown as [URL, RequestInit];
    expect((init.headers as Record<string, string>).authkey).toBe("test-auth-key-1234");
    expect(url.searchParams.get("authkey")).toBe("test-auth-key-1234");
    expect(url.searchParams.get("mobile")).toBe("919000000000");
    expect(url.toString().startsWith("https://control.msg91.com/api/v5/otp")).toBe(true);
  });

  it("drops undefined and empty query parameters instead of sending them blank", async () => {
    const spy = stubFetch(200, { message: "x", type: "success" });
    await msg91Request({ path: "otp", method: "POST", query: { a: "1", b: undefined, c: "" } });
    const [url] = spy.mock.calls[0] as unknown as [URL];
    expect(url.searchParams.get("a")).toBe("1");
    expect(url.searchParams.has("b")).toBe(false);
    expect(url.searchParams.has("c")).toBe(false);
  });

  it("maps 401 to an auth failure", async () => {
    stubFetch(401, { message: "invalid authkey", type: "error" });
    const r = await msg91Request({ path: "flow", method: "POST", body: {} });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe("auth");
  });

  it("maps 5xx to a transient server failure", async () => {
    stubFetch(503, { message: "down", type: "error" });
    const r = await msg91Request({ path: "flow", method: "POST", body: {}, retries: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe("server");
  });
});

describe("msg91Request — retries", () => {
  it("retries a transient failure and returns the eventual success", async () => {
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      n++;
      return n === 1
        ? new Response("{}", { status: 500 })
        : new Response(JSON.stringify({ message: "req-1", type: "success" }), { status: 200 });
    }));
    const r = await msg91Request({ path: "flow", method: "POST", body: {}, retries: 1 });
    expect(r.ok).toBe(true);
    expect(n).toBe(2);
  });

  it("NEVER retries a logical error — a send MSG91 accepted must not be replayed", async () => {
    const spy = stubFetch(200, { message: "template not found", type: "error" });
    const r = await msg91Request({ path: "flow", method: "POST", body: {}, retries: 3 });
    expect(r.ok).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("error classification", () => {
  it("defaults an UNRECOGNISED message to permanent, not transient", async () => {
    // Defaulting the other way would put unknown failures into a retry loop
    // that spends the account balance one SMS at a time.
    stubFetch(200, { message: "some entirely novel refusal", type: "error" });
    const r = await msg91Request({ path: "flow", method: "POST", body: {}, retries: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe("rejected");
      expect(isPermanentMsg91Error(r.kind)).toBe(true);
    }
  });

  it.each([
    ["OTP expired", "invalid_request"],
    ["OTP not match", "invalid_request"],
    ["invalid mobile number", "invalid_request"],
    ["flow id missing", "invalid_request"],
    ["Max retry attempted", "rate_limited"],
    ["insufficient balance", "rejected"],
  ])("classifies %s as %s", async (message, kind) => {
    stubFetch(200, { message, type: "error" });
    const r = await msg91Request({ path: "flow", method: "POST", body: {}, retries: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe(kind);
  });

  it("agrees with itself about what is transient", () => {
    for (const k of ["timeout", "network", "server", "rate_limited"] as const) {
      expect(isTransientMsg91Error(k)).toBe(true);
      expect(isPermanentMsg91Error(k)).toBe(false);
    }
    for (const k of ["auth", "invalid_request", "rejected", "not_configured", "unknown"] as const) {
      expect(isPermanentMsg91Error(k)).toBe(true);
    }
  });
});

describe("toMsg91Mobile", () => {
  it("strips the plus and any formatting, keeping the country code", () => {
    expect(toMsg91Mobile("+919344040013")).toBe("919344040013");
    expect(toMsg91Mobile("+91 93440 40013")).toBe("919344040013");
    expect(toMsg91Mobile("+1 (555) 474-1132")).toBe("15554741132");
  });
});

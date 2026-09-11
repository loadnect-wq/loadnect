// ─────────────────────────────────────────────────────────────────────────────
// lib/__tests__/otp-lockout.test.ts
//
// THE CHECK-SIDE CEILING USED TO BE A LOCKOUT WEAPON. verifyPhoneOtp takes the
// phone FROM THE CLIENT, and the failed-check budget was scoped to the phone
// alone, so any signed-in account could submit five wrong codes for a
// stranger's number and consume the whole pool. The victim's own correct code
// was then refused for fifteen minutes — repeatable forever, against any number
// the attacker cared to name. A venue owner needs phone_verified to see a
// single lead, so that is a denial of their business, not an inconvenience.
//
// These tests pin the three ceilings apart, because one number could not
// express both "let a real person mistype" and "do not let a stranger spend
// their allowance".
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  // Failed 'check' counts, keyed by which filters the query carried.
  byUserAndPhone: 0,
  byPhone: 0,
  byUser: 0,
  sends: 0,
  error: null as { message: string } | null,
  throwOnClient: false,
}));

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdminClient: () => {
    if (state.throwOnClient) throw new Error("no service role configured");
    return {
      from: () => {
        const filters: Record<string, unknown> = {};
        const chain = {
          select: () => chain,
          gte:    () => chain,
          eq: (col: string, val: unknown) => { filters[col] = val; return chain; },
          then: (resolve: (r: { count: number | null; error: unknown }) => void) => {
            if (state.error) return resolve({ count: null, error: state.error });
            if (filters.kind === "send") return resolve({ count: state.sends, error: null });
            const hasPhone = "phone" in filters;
            const hasUser  = "user_id" in filters;
            const count = hasPhone && hasUser ? state.byUserAndPhone
                        : hasPhone            ? state.byPhone
                        :                       state.byUser;
            return resolve({ count, error: null });
          },
        };
        return chain;
      },
    };
  },
}));

const { failedCheckLimitReached, hasRecentSendFor, MAX_FAILED_CHECKS } =
  await import("@/lib/otp-guard");

const VICTIM   = "+919876543210";
const ATTACKER = "attacker-user-id";
const OWNER    = "victim-user-id";

beforeEach(() => {
  state.byUserAndPhone = 0;
  state.byPhone = 0;
  state.byUser = 0;
  state.sends = 1;
  state.error = null;
  state.throwOnClient = false;
});

describe("OTP check ceilings — the lockout the phone-only budget allowed", () => {
  it("does NOT lock the real owner out because a stranger burned the number", () => {
    // The regression, stated exactly. An attacker has failed five times against
    // the victim's number; the victim themselves has failed zero.
    state.byPhone = MAX_FAILED_CHECKS;
    state.byUserAndPhone = 0;
    return expect(failedCheckLimitReached(VICTIM, OWNER)).resolves.toBeNull();
  });

  it("still stops the person who is actually getting it wrong", async () => {
    state.byUserAndPhone = MAX_FAILED_CHECKS;
    expect(await failedCheckLimitReached(VICTIM, OWNER)).toMatch(/Too many incorrect attempts/);
  });

  it("keeps a brute-force fuse on the number across all accounts", async () => {
    // Raised, not removed. Twenty guesses against a million values is nowhere,
    // but it still refuses a distributed grind.
    state.byPhone = 20;
    expect(await failedCheckLimitReached(VICTIM, OWNER)).toMatch(/Too many incorrect attempts/);
    state.byPhone = 19;
    expect(await failedCheckLimitReached(VICTIM, OWNER)).toBeNull();
  });

  it("bounds one account walking a list of numbers", async () => {
    // Without this, the per-(account, phone) budget resets on every new number
    // and one account could grind an unbounded list.
    state.byUser = 15;
    expect(await failedCheckLimitReached("+919000000001", ATTACKER))
      .toMatch(/Too many incorrect attempts/);
  });

  it("says the same thing whichever ceiling was hit", async () => {
    // A different message per ceiling would tell an attacker what OTHER
    // accounts have been doing with that number.
    state.byUserAndPhone = 99;
    const a = await failedCheckLimitReached(VICTIM, OWNER);
    state.byUserAndPhone = 0; state.byPhone = 99;
    const b = await failedCheckLimitReached(VICTIM, OWNER);
    state.byPhone = 0; state.byUser = 99;
    const c = await failedCheckLimitReached(VICTIM, OWNER);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("fails OPEN when the counter cannot be read", async () => {
    // Matches every other ceiling in this module: a rate-limit table that
    // cannot be read must not lock a real user out of their own code.
    state.error = { message: "relation does not exist" };
    expect(await failedCheckLimitReached(VICTIM, OWNER)).toBeNull();
    state.throwOnClient = true;
    expect(await failedCheckLimitReached(VICTIM, OWNER)).toBeNull();
  });
});

describe("binding a check to a code this account actually requested", () => {
  it("refuses a check for a number this account never sent to", async () => {
    state.sends = 0;
    expect(await hasRecentSendFor(ATTACKER, VICTIM)).toBe(false);
  });

  it("allows a check for a number this account did send to", async () => {
    state.sends = 1;
    expect(await hasRecentSendFor(OWNER, VICTIM)).toBe(true);
  });

  it("fails OPEN when the table cannot be read, like every other ceiling", async () => {
    state.error = { message: "relation does not exist" };
    expect(await hasRecentSendFor(OWNER, VICTIM)).toBe(true);
    state.error = null;
    state.throwOnClient = true;
    expect(await hasRecentSendFor(OWNER, VICTIM)).toBe(true);
  });
});

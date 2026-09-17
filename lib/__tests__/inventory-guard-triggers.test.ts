import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// Owners can accept and complete paid bookings (migration 0099).
//
// "Accept booking" failed for the hall's own owner with "You don't have
// permission to do this." — Postgres 42501, permission denied for function
// assert_inventory_free. The bookings inventory guard trigger ran as the
// owner's session role, which 0057 had (correctly) barred from calling that
// function. Payments were unaffected (they write as service_role), so every
// paid booking would have stalled until its 48-hour window refunded it.
// Found by the end-to-end sandbox payment test; same class as 0096.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("inventory guard triggers run as their owner (0099)", () => {
  const sql = read("supabase/migrations/0099_inventory_guard_triggers_run_as_owner.sql");
  const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

  it("makes both inventory guard trigger functions SECURITY DEFINER", () => {
    expect(code).toContain("alter function public.guard_booking_against_blocks() security definer;");
    expect(code).toContain("alter function public.guard_block_against_bookings() security definer;");
  });

  it("keeps assert_inventory_free out of reach of the API roles", () => {
    expect(code).not.toMatch(/grant\s+execute[^;]*assert_inventory_free/i);
    expect(code).toContain("assert_inventory_free must stay revoked from authenticated");
  });

  it("does not loosen who may write bookings or availability", () => {
    expect(code).not.toMatch(/create\s+policy|drop\s+policy|alter\s+policy|disable\s+row\s+level\s+security|drop\s+trigger/i);
    expect(code).not.toMatch(/create\s+or\s+replace\s+function/i); // live bodies kept exactly
  });

  it("the accept action still writes through the owner's session, not the service role", () => {
    const actions = read("app/owner/(dashboard)/actions.ts");
    const fn = actions.slice(actions.indexOf("export async function acceptBooking"));
    const body = fn.slice(0, fn.indexOf("\nexport async function", 10));
    expect(body).toContain("await getAuthUser()");
    expect(body).toContain('.eq("status", "booking_requested")');
    expect(body).not.toContain("getSupabaseAdminClient");
  });
});

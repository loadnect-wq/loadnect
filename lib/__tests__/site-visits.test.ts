import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { addDaysToIsoDate, todayInBusinessTz } from "../dates";
import { MAX_OPEN_VISITS, partyLabel, visitState, visitWhen } from "../site-visits";
import { siteVisitAnswerSchema, siteVisitRequestSchema } from "../validation/schemas";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

// ── An in-memory service-role client, just enough for lib/site-visits.server ──

type Row = Record<string, unknown>;
let tables: Record<string, Row[]> = {};
let failNext: string | null = null;

class Q {
  private op: "select" | "insert" | "update" = "select";
  private filters: ((r: Row) => boolean)[] = [];
  private values: Row = {};
  private head = false;
  private one: "maybe" | "single" | null = null;
  private returning = false;
  constructor(private table: string) {}
  select(_c?: string, o?: { head?: boolean }) { if (this.op === "select") this.head = Boolean(o?.head); else this.returning = true; return this; }
  insert(v: Row) { this.op = "insert"; this.values = v; return this; }
  update(v: Row) { this.op = "update"; this.values = v; return this; }
  eq(c: string, v: unknown) { this.filters.push((r) => r[c] === v); return this; }
  in(c: string, vs: unknown[]) { this.filters.push((r) => vs.includes(r[c])); return this; }
  gte(c: string, v: string) { this.filters.push((r) => String(r[c]) >= v); return this; }
  order() { return this; }
  limit() { return this; }
  maybeSingle() { this.one = "maybe"; return this; }
  single() { this.one = "single"; return this; }
  then<T>(res: (v: { data: unknown; error: { code: string; message: string } | null; count?: number }) => T) {
    return Promise.resolve(this.run()).then(res);
  }
  private run() {
    if (failNext === this.table) { failNext = null; return { data: null, error: { code: "XX000", message: "boom" } }; }
    const rows = (tables[this.table] ??= []);
    const match = rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.op === "insert") {
      const v = this.values;
      if (this.table === "site_visits" && rows.some((r) => r.hall_id === v.hall_id && r.customer_id === v.customer_id
          && r.visit_date === v.visit_date && ["requested", "confirmed"].includes(String(r.status)))) {
        return { data: null, error: { code: "23505", message: "dup" } };
      }
      const row = { id: `v${rows.length + 1}`, status: "requested", ...v };
      rows.push(row);
      return { data: this.one ? { id: row.id } : null, error: null };
    }
    if (this.op === "update") {
      match.forEach((r) => Object.assign(r, this.values));
      return { data: this.returning ? match : null, error: null, count: match.length };
    }
    if (this.head) return { data: null, error: null, count: match.length };
    if (this.one) return { data: match[0] ?? null, error: null };
    return { data: match, error: null, count: match.length };
  }
}

vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdminClient: () => ({ from: (t: string) => new Q(t) }) }));

const {
  answerSiteVisit, cancelSiteVisit, countPendingVisits, fetchVisitsForOwner, isVisitableDate, requestSiteVisit,
} = await import("../site-visits.server");

const HALL = "fda1a579-57b5-4def-acc4-ee27b060a67f";
const OTHER_HALL = "0b6c2f4e-1d3a-4c5b-9e8f-7a6b5c4d3e2f";
const FAMILY = "11111111-1111-4111-8111-111111111111";
const OWNER = "22222222-2222-4222-8222-222222222222";
const today = todayInBusinessTz();
const day = (n: number) => addDaysToIsoDate(today, n);

function world() {
  tables = {
    profiles: [
      { id: FAMILY, role: "customer", phone: "+919876543210", phone_verified: true },
      { id: OWNER, role: "owner_approved", phone: "+919000000000", phone_verified: true },
    ],
    hall_owners: [{ id: "ho1", profile_id: OWNER }],
    halls: [
      { id: HALL, status: "approved", owner_id: "ho1" },
      { id: OTHER_HALL, status: "pending_review", owner_id: "ho1" },
    ],
    site_visits: [],
  };
  failNext = null;
}

const ask = (over: Partial<Parameters<typeof requestSiteVisit>[0]> = {}) =>
  requestSiteVisit({ hallId: HALL, customerId: FAMILY, date: day(3), window: "morning", partySize: 3, contactName: "Priya", note: null, ...over });

// ── The rules ────────────────────────────────────────────────────────────────

describe("wording and state", () => {
  it("says when, plainly", () => {
    expect(visitWhen("2026-11-14", "morning")).toBe("Sat, 14 Nov · Morning (10 am – 12 noon)");
    expect(partyLabel(1)).toBe("1 person");
    expect(partyLabel(4)).toBe("4 people");
  });

  it("calls a visit whose day has gone 'past', whatever it was", () => {
    expect(visitState("requested", "2026-10-01", "2026-10-04")).toBe("past");
    expect(visitState("confirmed", "2026-10-01", "2026-10-04")).toBe("past");
    expect(visitState("declined", "2026-10-01", "2026-10-04")).toBe("declined");
    expect(visitState("confirmed", "2026-10-04", "2026-10-04")).toBe("confirmed");
  });

  it("validates the form, coercing the party size", () => {
    const base = { hallId: HALL, date: "2026-11-14", window: "evening", partySize: "4", contactName: "Priya" };
    expect(siteVisitRequestSchema.parse(base).partySize).toBe(4);
    expect(siteVisitRequestSchema.safeParse({ ...base, window: "midnight" }).success).toBe(false);
    expect(siteVisitRequestSchema.safeParse({ ...base, partySize: "0" }).success).toBe(false);
    expect(siteVisitRequestSchema.safeParse({ ...base, partySize: "21" }).success).toBe(false);
    expect(siteVisitRequestSchema.safeParse({ ...base, contactName: " " }).success).toBe(false);
    expect(siteVisitRequestSchema.safeParse({ ...base, note: "x".repeat(301) }).success).toBe(false);
    // No phone field at all: the number is the profile's.
    expect(Object.keys(siteVisitRequestSchema.shape)).not.toContain("contactPhone");
    expect(siteVisitAnswerSchema.safeParse({ visitId: HALL, decision: "maybe" }).success).toBe(false);
  });

  it("takes visits from today to sixty days out", () => {
    expect(isVisitableDate(day(0), today)).toBe(true);
    expect(isVisitableDate(day(60), today)).toBe(true);
    expect(isVisitableDate(day(61), today)).toBe(false);
    expect(isVisitableDate(day(-1), today)).toBe(false);
  });
});

// ── The family ───────────────────────────────────────────────────────────────

describe("asking to visit", () => {
  beforeEach(world);

  it("records the request with the VERIFIED number from the profile", async () => {
    expect(await ask()).toEqual({ ok: true, visitId: "v1", already: false });
    expect(tables.site_visits[0]).toMatchObject({ contact_phone: "+919876543210", contact_name: "Priya", status: "requested" });
  });

  it("refuses an unverified number, and says how to fix it", async () => {
    tables.profiles[0].phone_verified = false;
    expect(await ask()).toMatchObject({ ok: false, needsVerification: true });
    expect(tables.site_visits).toHaveLength(0);
  });

  it("is for customer accounts only", async () => {
    expect(await ask({ customerId: OWNER })).toMatchObject({ ok: false });
    expect(tables.site_visits).toHaveLength(0);
  });

  it("refuses a hall that is not live, and days out of range", async () => {
    expect(await ask({ hallId: OTHER_HALL })).toMatchObject({ ok: false, error: "This hall is not taking visits on Hallnect." });
    expect((await ask({ date: day(-1) })).ok).toBe(false);
    expect((await ask({ date: day(61) })).ok).toBe(false);
  });

  it("one upcoming request per hall: the same day again is the same request, another day is refused", async () => {
    await ask();
    expect(await ask()).toEqual({ ok: true, visitId: "v1", already: true });
    const other = await ask({ date: day(5) });
    expect(other.ok).toBe(false);
    expect(!other.ok && other.error).toContain("Cancel that request first");
    expect(tables.site_visits).toHaveLength(1);
  });

  it(`stops at ${MAX_OPEN_VISITS} upcoming visits across halls`, async () => {
    tables.site_visits = Array.from({ length: MAX_OPEN_VISITS }, (_, i) => ({
      id: `x${i}`, hall_id: `hall-${i}`, customer_id: FAMILY, visit_date: day(2), visit_window: "morning", status: "requested",
    }));
    expect((await ask()).ok).toBe(false);
  });

  it("cancels only its own, upcoming visits", async () => {
    await ask();
    expect((await cancelSiteVisit({ visitId: "v1", customerId: OWNER })).changed).toBe(false);
    expect(await cancelSiteVisit({ visitId: "v1", customerId: FAMILY })).toEqual({ ok: true, changed: true });
    expect(tables.site_visits[0].status).toBe("cancelled");
    tables.site_visits.push({ id: "old", hall_id: HALL, customer_id: FAMILY, visit_date: day(-2), status: "confirmed" });
    expect((await cancelSiteVisit({ visitId: "old", customerId: FAMILY })).changed).toBe(false);
  });
});

// ── The owner ────────────────────────────────────────────────────────────────

describe("answering a visit", () => {
  beforeEach(world);

  it("only the hall's owner can answer, and a stranger cannot tell the visit exists", async () => {
    await ask();
    expect(await answerSiteVisit({ visitId: "v1", ownerProfileId: FAMILY, decision: "confirmed", message: null }))
      .toEqual({ ok: false, error: "Visit not found." });
    expect(await answerSiteVisit({ visitId: "nope", ownerProfileId: OWNER, decision: "confirmed", message: null }))
      .toEqual({ ok: false, error: "Visit not found." });
  });

  it("confirms with a message, once", async () => {
    await ask();
    expect(await answerSiteVisit({ visitId: "v1", ownerProfileId: OWNER, decision: "confirmed", message: "Come at 11" }))
      .toEqual({ ok: true, changed: true });
    expect(tables.site_visits[0]).toMatchObject({ status: "confirmed", owner_message: "Come at 11" });
    expect(await answerSiteVisit({ visitId: "v1", ownerProfileId: OWNER, decision: "confirmed", message: null }))
      .toEqual({ ok: true, changed: false });
    expect((await answerSiteVisit({ visitId: "v1", ownerProfileId: OWNER, decision: "declined", message: null })).ok).toBe(false);
  });

  it("cannot answer a withdrawn request, or one whose day has passed", async () => {
    await ask();
    await cancelSiteVisit({ visitId: "v1", customerId: FAMILY });
    expect((await answerSiteVisit({ visitId: "v1", ownerProfileId: OWNER, decision: "confirmed", message: null })).ok).toBe(false);
    tables.site_visits.push({ id: "old", hall_id: HALL, customer_id: FAMILY, visit_date: day(-1), status: "requested" });
    expect(await answerSiteVisit({ visitId: "old", ownerProfileId: OWNER, decision: "confirmed", message: null }))
      .toEqual({ ok: false, error: "This visit's day has passed." });
  });

  it("lists the owner's visits and counts the waiting ones; a failed read is null, not zero", async () => {
    await ask();
    expect((await fetchVisitsForOwner(OWNER))?.map((v) => v.id)).toEqual(["v1"]);
    expect(await fetchVisitsForOwner(FAMILY)).toEqual([]);
    expect(await countPendingVisits([HALL])).toBe(1);
    failNext = "site_visits";
    expect(await countPendingVisits([HALL])).toBeNull();
  });
});

// ── Guard rails ──────────────────────────────────────────────────────────────

describe("guard rails", () => {
  const migration = read("supabase/migrations/0109_site_visits.sql");

  it("no client can write a visit; the family, the hall's owner and admins can read it", () => {
    expect(migration).not.toMatch(/create policy \w+ on public\.site_visits\s+for (insert|update|delete)/);
    expect(migration).toContain("customer_id = auth.uid()");
    expect(migration).toContain("public.owns_hall(hall_id)");
    expect(migration).toContain("revoke all on public.site_visits from anon, authenticated;");
    expect(migration).toContain("grant all on public.site_visits to service_role;");
  });

  it("verify-phone can send the family back to the visit form", () => {
    expect(read("app/verify-phone/page.tsx")).toContain('"/visit/"');
  });

  it("the venue page offers a visit only on a live listing", () => {
    expect(read("app/halls/[slug]/_components/HallDetailView.tsx"))
      .toContain('!isPreview && hall.status === "approved" ? `/visit/${hall.slug}` : null');
  });

  it("both sides can find their visits", () => {
    expect(read("app/customer/_components/CustomerSidebarNav.tsx")).toContain('href: "/customer/visits"');
    expect(read("components/app/BottomNav.tsx")).toContain('p.startsWith("/customer/visits")');
    expect(read("app/customer/bookings/page.tsx")).toContain('href="/customer/visits"');
    expect(read("app/owner/(dashboard)/_components/OwnerSidebarNav.tsx")).toContain('href: "/owner/visits"');
    expect(read("app/owner/(dashboard)/more/page.tsx")).toContain('href: "/owner/visits"');
    expect(read("app/owner/(dashboard)/dashboard/page.tsx")).toContain("pendingVisits !== null && pendingVisits > 0");
  });

  it("the privacy policy says what a visit request shares, and with whom", () => {
    expect(read("app/(legal)/privacy/page.tsx")).toContain("when you ask to visit a hall, your name, verified phone number");
  });
});

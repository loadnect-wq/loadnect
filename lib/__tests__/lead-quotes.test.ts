import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Quotes before the number (0112): a venue quotes, the family accepts, and only
// then does the venue get the number; booked only after accepted.
// ─────────────────────────────────────────────────────────────────────────────

type Call = { table: string; op: string; values?: unknown; filters: [string, string, unknown][] };
type Reply = { data?: unknown; error?: { code: string; message: string } | null; count?: number };
let calls: Call[] = [];
let reply: (c: Call) => Reply = () => ({});

class Q {
  c: Call;
  constructor(table: string) { this.c = { table, op: "select", filters: [] }; }
  select() { return this; }
  update(v: unknown) { this.c.op = "update"; this.c.values = v; return this; }
  insert(v: unknown) { this.c.op = "insert"; this.c.values = v; return this; }
  eq(col: string, v: unknown) { this.c.filters.push(["eq", col, v]); return this; }
  in(col: string, v: unknown) { this.c.filters.push(["in", col, v]); return this; }
  gte(col: string, v: unknown) { this.c.filters.push(["gte", col, v]); return this; }
  lt(col: string, v: unknown) { this.c.filters.push(["lt", col, v]); return this; }
  order() { return this; }
  limit() { return this; }
  maybeSingle() { return this; }
  then<T>(res: (v: Reply) => T) {
    calls.push(this.c);
    return Promise.resolve({ data: null, error: null, ...reply(this.c) }).then(res);
  }
}

vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdminClient: () => ({ from: (t: string) => new Q(t) }) }));
vi.mock("@/lib/dates", async (orig) => ({ ...(await orig<typeof import("@/lib/dates")>()), todayInBusinessTz: () => "2026-10-05" }));

const leads = await import("../leads");
type LeadRow = import("../leads").LeadRow;
const { leadQuoteSchema } = await import("../validation/schemas");
const { ownerQuoteNotification, ownerLeadNotification } = await import("../notifications/events");

const LEAD = "11111111-1111-4111-8111-111111111111";
const OWNER_PROFILE = "22222222-2222-4222-8222-222222222222";
const CUSTOMER = "33333333-3333-4333-8333-333333333333";

function row(over: Record<string, unknown> = {}) {
  return {
    id: LEAD, hall_id: "h", owner_id: "o", customer_id: CUSTOMER, contact_name: "Priya", contact_phone: "+919876543210",
    phone_verified: true, event_date: "2027-02-10", event_type: "wedding", guest_count: 400, requirements: null,
    status: "pending", agreed_amount: null, confirmed_at: null, responded_at: null, owner_notes: null, cancel_reason: null,
    created_at: "2026-10-05T00:00:00Z", quote_amount: null, quote_advance: null, quote_includes: null, quote_note: null,
    quote_valid_until: null, quoted_at: null, accepted_at: null,
    hall_owners: { id: "o", profile_id: OWNER_PROFILE },
    ...over,
  };
}

const quote = { amount: 150000, advance: 25000, includes: "Full day, dining hall", note: null, validUntil: "2026-10-12" };
const find = (op: string) => calls.find((c) => c.op === op)!;
const filter = (c: Call, col: string) => c.filters.find((f) => f[1] === col);

beforeEach(() => {
  calls = [];
  reply = () => ({});
});

describe("the number", () => {
  it("is blank in the venue's view until the family accepts", () => {
    for (const status of ["pending", "quoted"] as const) {
      expect(leads.forVenue(row({ status }) as unknown as LeadRow).contact_phone).toBe("");
    }
    for (const status of ["accepted", "confirmed"] as const) {
      expect(leads.forVenue(row({ status }) as unknown as LeadRow).contact_phone).toBe("+919876543210");
    }
  });

  it("is blanked by the venue's list read", async () => {
    reply = (c) => (c.table === "leads" ? { data: [row({ status: "quoted", halls: { name: "Sri Mahal", slug: "sri" } }), row({ status: "accepted", halls: { name: "Sri Mahal", slug: "sri" } })] } : {});
    const list = await leads.fetchLeadsForHalls(["h"]);
    expect(list.map((l) => l.contact_phone)).toEqual(["", "+919876543210"]);
  });
});

describe("the venue's quote", () => {
  it("goes out from pending, and a second one is a revision", async () => {
    reply = (c) => (c.op === "select" ? { data: row() } : { data: row({ status: "quoted", quote_amount: 150000, quote_valid_until: "2026-10-12", quoted_at: "x" }) });
    const first = await leads.sendLeadQuote({ leadId: LEAD, ownerProfileId: OWNER_PROFILE, quote });
    expect(first).toMatchObject({ ok: true, revised: false });
    const upd = find("update");
    expect(upd.values).toMatchObject({ status: "quoted", quote_amount: 150000, quote_advance: 25000, quote_valid_until: "2026-10-12" });
    expect(filter(upd, "status")).toEqual(["in", "status", ["pending", "quoted"]]);

    reply = (c) => (c.op === "select" ? { data: row({ status: "quoted" }) } : { data: row({ status: "quoted" }) });
    expect(await leads.sendLeadQuote({ leadId: LEAD, ownerProfileId: OWNER_PROFILE, quote })).toMatchObject({ ok: true, revised: true });
  });

  it("is refused for someone else's enquiry, for a closed one, and when it does not add up", async () => {
    reply = () => ({ data: row({ hall_owners: { id: "o", profile_id: "someone-else" } }) });
    expect(await leads.sendLeadQuote({ leadId: LEAD, ownerProfileId: OWNER_PROFILE, quote })).toEqual({ ok: false, error: "That enquiry could not be found." });
    reply = () => ({ data: row({ status: "accepted" }) });
    expect((await leads.sendLeadQuote({ leadId: LEAD, ownerProfileId: OWNER_PROFILE, quote })).ok).toBe(false);
    reply = () => ({ data: row() });
    expect((await leads.sendLeadQuote({ leadId: LEAD, ownerProfileId: OWNER_PROFILE, quote: { ...quote, validUntil: "2026-10-01" } })).ok).toBe(false);
    expect((await leads.sendLeadQuote({ leadId: LEAD, ownerProfileId: OWNER_PROFILE, quote: { ...quote, validUntil: "2027-03-01" } })).ok).toBe(false);
    expect((await leads.sendLeadQuote({ leadId: LEAD, ownerProfileId: OWNER_PROFILE, quote: { ...quote, advance: 200000 } })).ok).toBe(false);
    expect(calls.some((c) => c.op === "update")).toBe(false);
  });

  it("reads amounts the way an owner types them", () => {
    expect(leadQuoteSchema.parse({ amount: "150000", advance: "25,000", validUntil: "2026-10-12" }))
      .toMatchObject({ amount: 150000, advance: 25000 });
    expect(leadQuoteSchema.safeParse({ amount: "", validUntil: "2026-10-12" }).success).toBe(false);
    expect(leadQuoteSchema.safeParse({ amount: "150000", validUntil: "next week" }).success).toBe(false);
  });
});

describe("the family's answer", () => {
  it("accepting is theirs alone, only while the quote is open, and only once", async () => {
    reply = (c) => (c.op === "update" ? { data: row({ status: "accepted", accepted_at: "now", quote_amount: 150000 }) } : {});
    const r = await leads.acceptLeadQuote({ leadId: LEAD, customerId: CUSTOMER });
    expect(r).toMatchObject({ ok: true, changed: true });
    const upd = find("update");
    expect(upd.values).toMatchObject({ status: "accepted" });
    expect(filter(upd, "customer_id")).toEqual(["eq", "customer_id", CUSTOMER]);
    expect(filter(upd, "status")).toEqual(["eq", "status", "quoted"]);
    expect(filter(upd, "quote_valid_until")).toEqual(["gte", "quote_valid_until", "2026-10-05"]);
  });

  it("says why when nothing moved", async () => {
    reply = (c) => (c.op === "update" ? { data: null } : { data: row({ status: "quoted", quote_valid_until: "2026-10-01" }) });
    expect(await leads.acceptLeadQuote({ leadId: LEAD, customerId: CUSTOMER })).toEqual({ ok: false, error: "This quote has expired. Ask the hall for a new one." });
    reply = (c) => (c.op === "update" ? { data: null } : { data: row({ status: "accepted" }) });
    expect(await leads.acceptLeadQuote({ leadId: LEAD, customerId: CUSTOMER })).toMatchObject({ ok: true, changed: false });
  });

  it("turning it down closes the enquiry; an expired one can be asked for again", async () => {
    reply = () => ({ data: row({ status: "cancelled" }) });
    await leads.declineLeadQuote({ leadId: LEAD, customerId: CUSTOMER, reason: "Over budget" });
    expect(find("update").values).toMatchObject({ status: "cancelled", cancel_reason: "Quote declined: Over budget" });
    calls = [];
    reply = () => ({ data: row({ status: "pending" }) });
    await leads.requestNewQuote({ leadId: LEAD, customerId: CUSTOMER });
    const upd = find("update");
    expect(upd.values).toEqual({ status: "pending" });
    expect(filter(upd, "quote_valid_until")).toEqual(["lt", "quote_valid_until", "2026-10-05"]);
  });
});

describe("booked", () => {
  it("only after the family accepted", async () => {
    for (const status of ["pending", "quoted"]) {
      reply = () => ({ data: row({ status }) });
      const r = await leads.confirmLead({ leadId: LEAD, ownerProfileId: OWNER_PROFILE, agreedAmount: 150000, ownerNotes: null });
      expect(r).toEqual({ ok: false, error: "You can mark it booked once the family accepts your quote." });
    }
    expect(calls.some((c) => c.op === "update")).toBe(false);
  });

  it("is what the venue is still waiting on, with sending a quote", () => {
    expect(leads.OPEN_LEAD_STATUSES).toEqual(["pending", "accepted"]);
  });
});

describe("messages", () => {
  it("tell the venue about a decision without a number, within DLT's 30 characters", () => {
    for (const accepted of [true, false]) {
      const n = ownerQuoteNotification({ hallName: "Sri Meenakshi Sundareswarar Mahal", contactName: "Priya Lakshmi Narayanan", dateLabel: "Wed, 10 Feb 2027", accepted });
      expect(n.templateKey).toBe("OWNER_ACCOUNT_STATUS");
      for (const v of n.templateVariables) {
        expect(v.length).toBeLessThanOrEqual(30);
        expect(v).not.toMatch(/\d{10}/);
      }
      expect(n.templateVariables[1]).toBe(accepted ? "Quote accepted" : "Quote declined");
    }
  });

  it("never put the number in a new-enquiry message", () => {
    const n = ownerLeadNotification({ hallName: "Sri Mahal", contactName: "Priya", dateLabel: "10 Feb 2027", guestLabel: "400", ref: "HN-1" });
    expect(JSON.stringify(n.templateVariables)).not.toMatch(/\+91|\d{10}/);
  });
});

describe("guard rails", () => {
  const root = join(__dirname, "..", "..");
  const read = (p: string) => readFileSync(join(root, p), "utf8");

  it("switches direct booking off in the database and in the code", () => {
    const sql = read("supabase/migrations/0112_quotes_before_number.sql");
    expect(sql).toContain("check (booking_mode = 'LEAD_GENERATION')");
    expect(sql).toContain("revoke update (booking_mode) on public.halls from authenticated;");
    expect(read("lib/booking-switch.ts")).toContain("export const DIRECT_BOOKING_ENABLED = false;");
  });

  it("reads the family's own enquiry with the service role, scoped to them", () => {
    const actions = read("app/enquiry/[slug]/actions.ts");
    const fn = actions.slice(actions.indexOf("async function loadOwnEnquiry"));
    expect(fn).toContain("getSupabaseAdminClient()");
    expect(fn).toContain('.eq("customer_id", customerId)');
  });
});

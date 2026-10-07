import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Reviews for halls booked through a quote (0113). With direct booking off no
// booking row ever exists, so before this no family could review any hall.
// The database rule was dry-run against production in a rolled-back
// transaction (own booked past enquiry: allowed; a second review, a future
// date, accepted-not-booked, someone else's enquiry, impersonation, no source,
// moving a review: all refused). These tests pin the app side.
// ─────────────────────────────────────────────────────────────────────────────

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

type Call = { table: string; op: string; values?: unknown; filters: [string, string, unknown][] };
type Reply = { data?: unknown; error?: { code: string; message: string } | null };

const h = vi.hoisted(() => ({
  user: { id: "11111111-1111-4111-8111-111111111111" } as { id: string } | null,
  calls: [] as Call[],
  reply: (() => ({})) as (c: Call) => Reply,
  revalidated: [] as string[],
}));

class Q {
  c: Call;
  constructor(table: string) { this.c = { table, op: "select", filters: [] }; }
  select() { return this; }
  insert(v: unknown) { this.c.op = "insert"; this.c.values = v; return this; }
  eq(col: string, v: unknown) { this.c.filters.push(["eq", col, v]); return this; }
  not(col: string, op: string, v: unknown) { this.c.filters.push(["not", col, [op, v]]); return this; }
  maybeSingle() { return this; }
  then<T>(res: (v: Reply) => T) {
    h.calls.push(this.c);
    return Promise.resolve({ data: null, error: null, ...h.reply(this.c) }).then(res);
  }
}

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user } }) },
    from: (t: string) => new Q(t),
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => { h.revalidated.push(p); } }));
vi.mock("@/lib/dates", async (orig) => ({ ...(await orig<typeof import("@/lib/dates")>()), todayInBusinessTz: () => "2026-10-07" }));
vi.mock("@/lib/availability-release", () => ({}));
vi.mock("@/lib/notifications/events", () => ({}));
vi.mock("@/lib/notifications/phone", () => ({}));
vi.mock("@/lib/refunds", () => ({}));

const { submitEnquiryReview } = await import("@/app/customer/actions");
const { enquiryReviewSchema } = await import("../validation/schemas");

const LEAD = "22222222-2222-4222-8222-222222222222";
const HALL = "33333333-3333-4333-8333-333333333333";
const OTHER_HALL = "44444444-4444-4444-8444-444444444444";

function leadRow(over: Record<string, unknown> = {}) {
  return { id: LEAD, hall_id: HALL, status: "confirmed", event_date: "2026-10-04", halls: { slug: "sri-mahal" }, ...over };
}

beforeEach(() => {
  h.user = { id: "11111111-1111-4111-8111-111111111111" };
  h.calls = [];
  h.revalidated = [];
  h.reply = (c) => (c.table === "leads" ? { data: leadRow() } : {});
});

const inserts = () => h.calls.filter((c) => c.op === "insert");

describe("submitEnquiryReview", () => {
  it("saves a review on the hall the family's own booked enquiry was for", async () => {
    const r = await submitEnquiryReview({ leadId: LEAD, rating: 5, comment: "  Lovely hall  ", serviceRating: 4 });
    expect(r).toEqual({ success: true });

    const leadRead = h.calls.find((c) => c.table === "leads")!;
    expect(leadRead.filters).toEqual(expect.arrayContaining([["eq", "id", LEAD], ["eq", "customer_id", h.user!.id]]));

    expect(inserts()).toHaveLength(1);
    const row = inserts()[0].values as Record<string, unknown>;
    expect(row).toMatchObject({ hall_id: HALL, lead_id: LEAD, customer_id: h.user!.id, rating: 5, comment: "Lovely hall", service_rating: 4 });
    expect(row).not.toHaveProperty("booking_id");
    expect(h.revalidated).toEqual(expect.arrayContaining(["/customer/enquiries", "/customer/reviews", "/halls/sri-mahal"]));
  });

  it("takes the hall from the enquiry, never from the caller", async () => {
    await submitEnquiryReview({ leadId: LEAD, rating: 4, hallId: OTHER_HALL } as Parameters<typeof submitEnquiryReview>[0]);
    expect((inserts()[0].values as Record<string, unknown>).hall_id).toBe(HALL);
  });

  it("allows the day of the function itself", async () => {
    h.reply = (c) => (c.table === "leads" ? { data: leadRow({ event_date: "2026-10-07" }) } : {});
    expect(await submitEnquiryReview({ leadId: LEAD, rating: 4 })).toEqual({ success: true });
  });

  it.each([
    ["not signed in",        () => { h.user = null; },                                                   "Not authenticated"],
    ["someone else's",       () => { h.reply = () => ({}); },                                            "That enquiry is not yours."],
    ["accepted, not booked", () => { h.reply = (c) => (c.table === "leads" ? { data: leadRow({ status: "accepted" }) } : {}); }, "You can rate a hall once it has marked your enquiry booked."],
    ["before the function",  () => { h.reply = (c) => (c.table === "leads" ? { data: leadRow({ event_date: "2026-10-08" }) } : {}); }, "You can rate this hall after your function."],
  ])("refuses an enquiry that is %s, without writing", async (_name, arrange, message) => {
    arrange();
    expect(await submitEnquiryReview({ leadId: LEAD, rating: 5 })).toEqual({ error: message });
    expect(inserts()).toHaveLength(0);
  });

  it("refuses a bad rating or id before reading anything", async () => {
    expect("error" in (await submitEnquiryReview({ leadId: LEAD, rating: 6 }))).toBe(true);
    expect("error" in (await submitEnquiryReview({ leadId: "nope", rating: 5 }))).toBe(true);
    expect(h.calls).toHaveLength(0);
  });

  it("says so when the enquiry already has a review", async () => {
    h.reply = (c) => (c.table === "leads" ? { data: leadRow() } : { error: { code: "23505", message: "duplicate key" } });
    expect(await submitEnquiryReview({ leadId: LEAD, rating: 5 })).toEqual({ error: "You have already rated this hall for this function." });
  });

  it("the schema names the enquiry, not the hall or a booking", () => {
    const parsed = enquiryReviewSchema.parse({ leadId: LEAD, rating: 3, hallId: OTHER_HALL, bookingId: LEAD });
    expect(parsed).not.toHaveProperty("hallId");
    expect(parsed).not.toHaveProperty("bookingId");
  });
});

describe("the database rule (0113)", () => {
  const sql = read("supabase/migrations/0113_reviews_for_quotes.sql");

  it("keeps the booking path and adds the enquiry path, never both on one review", () => {
    expect(sql).toContain("and b.status      = 'completed'");
    expect(sql).toContain("and public.lead_is_reviewable(reviews.lead_id, reviews.hall_id)");
    expect(sql).toContain("check (booking_id is null or lead_id is null)");
    expect(sql).toContain("create unique index if not exists uq_review_per_lead");
  });

  it("checks the caller's own booked enquiry, on that hall, after the date in India", () => {
    for (const rule of [
      "l.customer_id = auth.uid()",
      "l.hall_id     = p_hall",
      "l.status      = 'confirmed'",
      "l.event_date <= (now() at time zone 'Asia/Kolkata')::date",
    ]) expect(sql, rule).toContain(rule);
    expect(sql).toContain("revoke all on function public.lead_is_reviewable(uuid, uuid) from anon;");
  });

  it("keeps a review from being moved to another enquiry", () => {
    expect(sql).toContain("or new.lead_id     is distinct from old.lead_id then");
  });

  it("matches the expiry sweep, which never retires a booked enquiry", () => {
    expect(read("lib/lead-expiry.ts")).toContain('.in("status", ["pending", "quoted", "accepted"])');
  });
});

describe("where a family finds it", () => {
  it("My Enquiries offers it on a booked enquiry once the date has passed", () => {
    const page = read("app/customer/enquiries/page.tsx");
    expect(page).toContain('lead.status === "confirmed" && lead.event_date <= today && reviewed && (');
    expect(page).toContain("<ReviewForm leadId={lead.id} hallName={lead.hall_name} />");
    expect(page).toContain("You rated this hall.");
  });

  it("a failed read of past reviews offers no form, rather than a possible second review", () => {
    expect(read("lib/customer.ts")).toContain('if (error) { handleErr("fetchReviewedLeadIds", error); return null; }');
  });

  it("My Reviews is back in the menu, and its empty state points at enquiries", () => {
    expect(read("app/customer/_components/CustomerSidebarNav.tsx")).toContain('{ label: "My Reviews",  href: "/customer/reviews",      icon: Star },');
    expect(read("app/customer/reviews/page.tsx")).toContain("rate it from My Enquiries.");
  });

  it("the terms and the assistant describe the quote path", () => {
    expect(read("app/(legal)/terms/page.tsx")).toContain("an enquiry the venue has marked booked, once the date of the function has passed");
    expect(read("lib/ai/knowledge.server.ts")).toContain('the customer can rate the hall from My Enquiries ("Rate this hall")');
  });
});

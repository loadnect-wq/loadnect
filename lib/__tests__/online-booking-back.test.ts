import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Online booking with an advance is back (0114, 2026-10-07) — as each hall's
// own choice beside quotes, not instead of them. The database side was dry-run
// against production in a rolled-back transaction, as each real role: owner
// switches their hall (and cannot without a price, or to a made-up mode, or
// someone else's hall); a family cannot write a booking or its price; the
// server's insert, occasion, payment and owner acceptance all go through; a
// second family cannot take the same date; a non-standard commission and a
// missing fee are refused; and the new guard refuses a booking once the hall
// is back on quotes. These tests pin the app side.
// ─────────────────────────────────────────────────────────────────────────────

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const h = vi.hoisted(() => ({
  user: { id: "11111111-1111-4111-8111-111111111111" } as { id: string } | null,
  reply: { data: [] as unknown[] | null, error: null as { code: string; message: string } | null },
}));

class Q {
  select() { return this; }
  eq() { return this; }
  then<T>(res: (v: unknown) => T) { return Promise.resolve(h.reply).then(res); }
}

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user } }) },
    from: () => new Q(),
  }),
}));
vi.mock("@/lib/dates", async (orig) => ({ ...(await orig<typeof import("@/lib/dates")>()), todayInBusinessTz: () => "2026-10-07" }));

const { fetchCustomerStats } = await import("../customer");

beforeEach(() => {
  h.user = { id: "11111111-1111-4111-8111-111111111111" };
  h.reply = { data: [], error: null };
});

describe("the switch and the database", () => {
  it("is on, and 0114 lifts exactly what 0112 put in place", () => {
    expect(read("lib/booking-switch.ts")).toContain("export const DIRECT_BOOKING_ENABLED = true;");
    const sql = read("supabase/migrations/0114_online_booking_back.sql");
    expect(sql).toContain("drop constraint if exists halls_direct_booking_switched_off;");
    expect(sql).toContain("drop constraint if exists admin_hall_drafts_direct_booking_switched_off;");
    expect(sql).toContain("grant update (booking_mode) on public.halls to authenticated;");
    // It switches no hall, and does not touch the price rule or the default.
    expect(sql).not.toMatch(/update public\.halls/i);
    expect(sql).not.toMatch(/alter column booking_mode set default/i);
    expect(sql).toContain("halls_direct_booking_needs_price");
  });

  it("adds a database guard: a booking only for an approved hall that takes online bookings, on INSERT only", () => {
    const sql = read("supabase/migrations/0114_online_booking_back.sql");
    expect(sql).toContain("and h.booking_mode = 'DIRECT_BOOKING'");
    expect(sql).toContain("and h.status = 'approved'");
    expect(sql).toContain("before insert on public.bookings");
    expect(sql).not.toContain("before insert or update on public.bookings");
    expect(sql).toContain("revoke all on function public.guard_booking_hall_takes_online_booking() from anon, authenticated;");
  });

  it("keeps the server-side mode gate in front of it", () => {
    const action = read("app/book/[slug]/actions.ts");
    expect(action).toContain("if (isLeadGeneration(hall.booking_mode)) {");
    expect(action).toContain("This venue works on quotes rather than online booking.");
  });
});

describe("a hall takes money online only when its owner chooses it", () => {
  it("a new hall starts on quotes, in the form as in the database", () => {
    const form = read("app/owner/(dashboard)/halls/_components/HallForm.tsx");
    expect(form).toContain('useState<BookingMode>(hall ? toBookingMode(hall.booking_mode) : "LEAD_GENERATION")');
    expect(read("lib/validation/schemas.ts")).toContain('bookingMode:  bookingModeSchema.default("LEAD_GENERATION"),');
  });

  it("names the modes as families see them, and describes quotes as they work now", () => {
    const form = read("app/owner/(dashboard)/halls/_components/HallForm.tsx");
    expect(form).toContain('{isLead ? "Quotes" : "Online booking"}');
    expect(form).not.toContain("Customers send you an enquiry.");
  });
});

describe("an online-booking venue is told how it gets paid", () => {
  it("on the hall form, without a link that would lose the form", () => {
    const form = read("app/owner/(dashboard)/halls/_components/HallForm.tsx");
    expect(form).toContain("Add your payout account to be paid.");
    expect(form).not.toContain('href="/owner/profile"');
  });

  it("and on the dashboard until Cashfree has verified the account", () => {
    const dash = read("app/owner/(dashboard)/dashboard/page.tsx");
    expect(dash).toContain('DIRECT_BOOKING_ENABLED && hasDirectVenue && ownerRow.payout_beneficiary_status !== "VERIFIED";');
    expect(dash).toContain("Add your payout account to be paid for online bookings");
  });
});

describe("each owner's tab bar holds the inbox they actually use", () => {
  it("the layout asks, and More holds the other one", () => {
    const layout = read("app/owner/(dashboard)/layout.tsx");
    expect(layout).toContain("DIRECT_BOOKING_ENABLED && (await ownerTakesOnlinePayments()).takesOnlinePayments;");
    expect(layout).toContain("<OwnerBottomNav bookingsTab={bookingsTab} />");
    const nav = read("app/owner/(dashboard)/_components/OwnerBottomNav.tsx");
    expect(nav).toContain('? { href: "/owner/bookings", label: "Bookings",  Icon: CalendarDays }');
    expect(nav).toContain(': { href: "/owner/leads",    label: "Enquiries", Icon: Inbox },');
    expect(read("app/owner/(dashboard)/more/page.tsx")).toContain("DIRECT_BOOKING_ENABLED && (await ownerTakesOnlinePayments()).takesOnlinePayments,");
  });
});

describe("what families and owners are told", () => {
  it("About no longer says Hallnect takes no payment while it can", () => {
    const about = read("app/about/page.tsx");
    const on = about.slice(about.indexOf("const HOW_TO_BOOK = DIRECT_BOOKING_ENABLED"), about.indexOf("  : {", about.indexOf("const HOW_TO_BOOK")));
    expect(on).toContain("Book online, where a hall offers it");
    expect(on).not.toContain("takes no payment");
    expect(on).not.toContain("pay Hallnect nothing");
    expect(about).toContain("{HOW_TO_BOOK.charges}");
  });

  it("the terms describe both ways to book, and drop the not-offered sentence", () => {
    const terms = read("app/(legal)/terms/page.tsx");
    expect(terms).toContain('<Section title="4. Bookings, Advance Payment, Platform Fee and Requests for Quotes">');
    expect(terms).toContain("<strong>{platformFeeDisclosure()}</strong>");
    expect(terms).toContain("<strong>Requests for quotes.</strong>");
    expect(terms).not.toContain("must come back, reviewed, before");
    // The not-offered sentence survives only in the switched-off version,
    // which comes after the online-booking one.
    expect(terms.indexOf("is not currently offered")).toBeGreaterThan(
      terms.indexOf('<Section title="4. Requests for Quotes and Bookings">'),
    );
    expect(terms.indexOf('<Section title="4. Requests for Quotes and Bookings">')).toBeGreaterThan(
      terms.indexOf('<Section title="4. Bookings, Advance Payment, Platform Fee and Requests for Quotes">'),
    );
  });

  it("the owner sign-up page tells both money stories", () => {
    const page = read("app/owner/register/page.tsx");
    expect(page).toContain('title: "You choose how families book"');
    expect(page).toContain('lead: "Online bookings: never invoiced."');
    expect(page).toContain('lead: "Quotes: you pay only when you book."');
  });

  it("the assistant knows both, and when NOT to promise online booking", () => {
    const k = read("lib/ai/knowledge.server.ts");
    expect(k).toContain("## Two ways a venue takes bookings");
    expect(k).toContain("Never tell a customer they can book online at a hall unless the tool says DIRECT_BOOKING.");
    expect(k).not.toContain('Lead Generation (shown as "Send Enquiry")');
  });
});

describe("the family's upcoming-bookings count", () => {
  it("counts in India's date, and only active statuses", async () => {
    h.reply = {
      data: [
        { status: "booking_requested", event_date: "2026-10-07" },
        { status: "owner_confirmed",   event_date: "2026-12-01" },
        { status: "owner_confirmed",   event_date: "2026-10-06" },
        { status: "cancelled",         event_date: "2026-12-01" },
        { status: "completed",         event_date: "2026-09-01" },
        { status: "pending_payment",   event_date: "2026-12-02" },
      ],
      error: null,
    };
    expect(await fetchCustomerStats()).toEqual({ upcomingCount: 2, pendingCount: 1, completedCount: 1 });
  });

  it("is unknown, not zero, when the read fails", async () => {
    h.reply = { data: null, error: { code: "57014", message: "timeout" } };
    expect(await fetchCustomerStats()).toBeNull();
  });
});

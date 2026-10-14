import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isMonthKey, monthLabel, monthOf, monthRange, monthTimestamps, replyTimeLabel, shiftMonth, summarise,
  type InsightRows, type MonthKey,
} from "../owner-insights";
import { recordHallPageView } from "../page-views.server";
import { LEGAL_LAST_UPDATED } from "../content";

// ─────────────────────────────────────────────────────────────────────────────
// The owner's monthly Insights, and the page-view count it needed (0117,
// 2026-10-14). Every figure is a count of real rows; a read that failed shows
// as null ("couldn't load"), never as a zero that reads like a bad month.
// ─────────────────────────────────────────────────────────────────────────────

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");

describe("months", () => {
  it("shifts across a year boundary and spans the whole month", () => {
    expect(shiftMonth("2026-12" as MonthKey, 1)).toBe("2027-01");
    expect(shiftMonth("2026-01" as MonthKey, -1)).toBe("2025-12");
    expect(monthRange("2026-10" as MonthKey)).toEqual({ start: "2026-10-01", end: "2026-11-01" });
    expect(monthTimestamps("2026-10" as MonthKey)).toEqual({
      from: "2026-10-01T00:00:00+05:30", to: "2026-11-01T00:00:00+05:30",
    });
    expect(monthOf("2026-10-14")).toBe("2026-10");
    expect(monthLabel("2026-10" as MonthKey)).toBe("October 2026");
  });

  it("accepts only a real YYYY-MM from the address bar", () => {
    expect(isMonthKey("2026-10")).toBe(true);
    for (const bad of ["2026-13", "2026-1", "26-10", "2026-10-01", "../x", undefined, 202610]) {
      expect(isMonthKey(bad), String(bad)).toBe(false);
    }
  });
});

const ROWS: InsightRows = {
  views: [{ hall_id: "h1", views: 12 }, { hall_id: "h1", views: 3 }, { hall_id: "h2", views: 5 }],
  scans: [{ hall_id: "h1", scans: 2 }],
  leads: [
    { hall_id: "h1", status: "awaiting_verification", created_at: "2026-10-01T10:00:00Z", quoted_at: null, accepted_at: null },
    { hall_id: "h1", status: "pending", created_at: "2026-10-02T10:00:00Z", quoted_at: null, accepted_at: null },
    { hall_id: "h1", status: "quoted", created_at: "2026-10-03T10:00:00Z", quoted_at: "2026-10-03T12:00:00Z", accepted_at: null },
    { hall_id: "h1", status: "confirmed", created_at: "2026-10-04T10:00:00Z", quoted_at: "2026-10-04T16:00:00Z", accepted_at: "2026-10-05T09:00:00Z" },
    { hall_id: "h1", status: "rejected", created_at: "2026-10-05T10:00:00Z", quoted_at: null, accepted_at: null },
    { hall_id: "h2", status: "expired", created_at: "2026-10-06T10:00:00Z", quoted_at: null, accepted_at: null },
  ],
  visits: [{ hall_id: "h1", status: "confirmed" }, { hall_id: "h1", status: "requested" }],
  reviews: [{ hall_id: "h1", rating: 5 }, { hall_id: "h1", rating: 4 }],
  bookings: [{ hall_id: "h2", status: "owner_confirmed", total_amount: "150000" }],
};

describe("summarise", () => {
  it("counts one hall's month, leaving out enquiries the hall never saw", () => {
    const s = summarise(ROWS, ["h1"]);
    expect(s.views).toBe(15);
    expect(s.qrScans).toBe(2);
    expect(s.enquiries).toEqual({
      received: 4, awaitingReply: 1, quoted: 2, accepted: 1, booked: 1, declined: 1, expired: 0,
      medianReplyHours: 4, // replies took 2 h and 6 h
    });
    expect(s.visits).toEqual({ requested: 2, confirmed: 1 });
    expect(s.reviews).toEqual({ count: 2, average: 4.5 });
    expect(s.bookings).toEqual({ count: 0, value: 0 });
  });

  it("adds up every hall for the total", () => {
    const s = summarise(ROWS, ["h1", "h2"]);
    expect(s.views).toBe(20);
    expect(s.enquiries?.received).toBe(5);
    expect(s.enquiries?.expired).toBe(1);
    expect(s.bookings).toEqual({ count: 1, value: 150000 });
  });

  it("a section that failed to load stays null, never zero", () => {
    const s = summarise({ ...ROWS, views: null, leads: null }, ["h1"]);
    expect(s.views).toBeNull();
    expect(s.enquiries).toBeNull();
    expect(s.qrScans).toBe(2);
  });

  it("no reply time when nothing was quoted, and readable reply times", () => {
    expect(summarise({ ...ROWS, leads: [] }, ["h1"]).enquiries?.medianReplyHours).toBeNull();
    expect(replyTimeLabel(0.5)).toBe("under an hour");
    expect(replyTimeLabel(1)).toBe("1 hour");
    expect(replyTimeLabel(5.4)).toBe("5 hours");
    expect(replyTimeLabel(30)).toBe("1 day");
    expect(replyTimeLabel(60)).toBe("3 days");
  });
});

// ── Counting a view ──────────────────────────────────────────────────────────

function fakeDb(opts: { hall?: Record<string, unknown> | null; role?: string; ownerRowId?: string | null } = {}) {
  const rpcs: unknown[] = [];
  const db = {
    from(table: string) {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => {
          if (table === "halls") return { data: opts.hall === undefined ? { id: "h1", owner_id: "o1", status: "approved" } : opts.hall, error: null };
          if (table === "profiles") return { data: opts.role ? { role: opts.role } : null, error: null };
          if (table === "hall_owners") return { data: opts.ownerRowId ? { id: opts.ownerRowId } : null, error: null };
          return { data: null, error: null };
        },
      };
      return q;
    },
    rpc: async (name: string, args: unknown) => { rpcs.push({ name, args }); return { error: null }; },
  };
  return { db, rpcs };
}

const PHONE = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36";

describe("recordHallPageView", () => {
  it("counts a family's view of a live hall", async () => {
    const { db, rpcs } = fakeDb();
    expect(await recordHallPageView({ slug: "sri-mahal-madurai", userAgent: PHONE, viewerId: null, db })).toBe("counted");
    expect(rpcs).toEqual([{ name: "record_hall_page_view", args: { _hall_id: "h1" } }]);
  });

  it("ignores bots, bad slugs, halls that are not live, the hall's own owner and admins", async () => {
    const cases: [Parameters<typeof recordHallPageView>[0], string][] = [
      [{ slug: "sri-mahal", userAgent: "Googlebot/2.1", viewerId: null }, "bot"],
      [{ slug: "sri-mahal", userAgent: null, viewerId: null }, "bot"],
      [{ slug: "Sri Mahal!", userAgent: PHONE, viewerId: null }, "invalid"],
      [{ slug: "sri-mahal", userAgent: PHONE, viewerId: null, db: fakeDb({ hall: { id: "h1", owner_id: "o1", status: "pending_approval" } }).db }, "not_live"],
      [{ slug: "sri-mahal", userAgent: PHONE, viewerId: null, db: fakeDb({ hall: null }).db }, "not_live"],
      [{ slug: "sri-mahal", userAgent: PHONE, viewerId: "u1", db: fakeDb({ ownerRowId: "o1" }).db }, "own_hall"],
      [{ slug: "sri-mahal", userAgent: PHONE, viewerId: "u1", db: fakeDb({ role: "admin" }).db }, "own_hall"],
    ];
    for (const [input, outcome] of cases) {
      const { db, rpcs } = fakeDb();
      expect(await recordHallPageView({ db, ...input }), outcome).toBe(outcome);
      expect(rpcs, outcome).toEqual([]);
    }
  });

  it("another owner looking at this hall is a viewer like anyone else", async () => {
    const { db, rpcs } = fakeDb({ ownerRowId: "some-other-owner" });
    expect(await recordHallPageView({ slug: "sri-mahal", userAgent: PHONE, viewerId: "u2", db })).toBe("counted");
    expect(rpcs).toHaveLength(1);
  });
});

describe("the wiring", () => {
  it("the counter stores a number per hall per day, writable only by the server, live halls only", () => {
    const sql = read("supabase/migrations/0117_hall_page_views.sql");
    expect(sql).toContain("primary key (hall_id, view_date)");
    expect(sql).toContain("revoke all on function public.record_hall_page_view(uuid) from public, anon, authenticated;");
    expect(sql).toContain("h.status = 'approved'");
    expect(sql).toContain("public.owns_hall(hall_id) or public.is_admin()");
    expect(sql).not.toMatch(/\b(ip|user_agent|session|cookie)\b\s+(text|inet|uuid)/i);
  });

  it("the venue page counts once per browser per day, never on a preview, and the route always answers 204", () => {
    const beacon = read("components/halls/HallViewBeacon.tsx");
    expect(beacon).toContain("navigator.webdriver");
    expect(beacon).toContain("seen[slug] === today");
    expect(beacon).not.toMatch(/document\.cookie/);
    expect(read("app/halls/[slug]/_components/VenuePage.tsx")).toContain("{!isPreview && <HallViewBeacon slug={hall.slug} />}");
    const route = read("app/api/halls/view/route.ts");
    expect(route).toContain("status: 204");
    expect(route).not.toMatch(/status: (200|400|404)/);
  });

  it("owners can reach Insights from the sidebar, the More page and the dashboard", () => {
    expect(read("app/owner/(dashboard)/_components/OwnerSidebarNav.tsx")).toContain('href: "/owner/insights"');
    expect(read("app/owner/(dashboard)/more/page.tsx")).toContain('href: "/owner/insights"');
    expect(read("app/owner/(dashboard)/dashboard/page.tsx")).toContain('href="/owner/insights"');
    expect(read("app/owner/(dashboard)/insights/page.tsx")).toContain("asked <= thisMonth ? asked : thisMonth");
  });

  it("the privacy policy says what is now counted and stored, and its date moved", () => {
    const privacy = read("app/(legal)/privacy/page.tsx");
    expect(privacy).not.toContain("we store no page-view, search or IP log of our own");
    expect(privacy).toContain("how many browsers opened that venue");
    expect(privacy).toContain("turn on reminders for a plan");
    expect(LEGAL_LAST_UPDATED["/privacy"]).toBe("2026-10-14");
  });
});

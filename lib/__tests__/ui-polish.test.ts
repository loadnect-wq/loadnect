import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FOOTER_LINKS } from "../constants";
import { CHAT_ACTION_ROUTES, CHAT_HIDDEN_PREFIXES, QUICK_ACTIONS } from "../ai/chat-config";

// ─────────────────────────────────────────────────────────────────────────────
// The UI/UX pass of 2026-10-06: what a page-by-page inspection at phone and
// desktop widths found, pinned so it stays fixed. Each block names what was
// wrong before.
// ─────────────────────────────────────────────────────────────────────────────

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("text people can read", () => {
  it("the muted grey clears 4.5:1 on the ivory page (it was 4.27:1)", () => {
    expect(read("app/globals.css")).toContain("--muted-foreground: 22  5% 42%;");
  });

  it("the WhatsApp buttons use the darker green (white on the old one was 4.12:1)", () => {
    for (const f of [
      "components/share/ShareButtons.tsx",
      "components/budget/BudgetEstimate.tsx",
      "components/budget/BudgetCalculator.tsx",
    ]) {
      const src = read(f);
      expect(src, f).not.toContain("#1f8f4e");
      expect(src, f).toContain("bg-[#1a7f45]");
    }
  });

  it("small gold labels use gold-700 (gold-600 was 3.8:1, the 404 label 2.6:1)", () => {
    expect(read("app/page.tsx")).toContain('tracking-widest text-gold-700">{eyebrow}');
    expect(read("app/not-found.tsx")).toContain("text-gold-700\">✦ 404 ✦");
    expect(read("app/(legal)/terms/page.tsx")).toContain('text-gold-700">Hallnect Legal');
  });
});

describe("the footer", () => {
  it("lists each link once (three appeared twice, stacked on a phone)", () => {
    const all = Object.values(FOOTER_LINKS).flat().map((l) => l.href);
    expect(all.length).toBe(new Set(all).size);
  });

  it("is two columns of links on a phone, with section headings as h2", () => {
    const footer = read("components/layout/Footer.tsx");
    expect(footer).toContain('className="grid grid-cols-2 gap-x-6 gap-y-10 lg:grid-cols-5"');
    expect(footer).not.toContain("<h3");
  });
});

describe("signing in", () => {
  it("says why, from where the family was going", () => {
    const login = read("app/(auth)/login/page.tsx");
    expect(login).toContain("{signInReason(nextPath)}");
    expect(login).toContain("Sign in to ask this hall for a quote. It sees your request, not your number, until you accept its quote.");
  });

  it("has a tab title, and no assistant button over the form", () => {
    expect(read("app/(auth)/layout.tsx")).toContain('title: "Sign in"');
    expect(CHAT_HIDDEN_PREFIXES).toContain("/login");
  });
});

describe("saving a hall", () => {
  it("confirms it, with the way to the list", () => {
    const heart = read("app/_components/SaveHeart.tsx");
    expect(heart).toContain('title: "Saved to your shortlist"');
    expect(heart).toContain('{ label: "View", href: "/saved" }');
    expect(heart).toContain('title: "Could not save this hall"');
  });

  it("the saved page has a heading, and never says 'none saved' before it can know", () => {
    const view = read("app/saved/_components/SavedView.tsx");
    expect(view).toContain('<h1 className="font-serif text-2xl font-bold text-charcoal-900">Your saved halls</h1>');
    expect(view).toContain("!onClient ? null");
  });
});

describe("dead ends", () => {
  it("a city with no halls says so and offers the cities that have them", () => {
    const halls = read("app/halls/page.tsx");
    expect(halls).toContain("title={`No halls in ${city} yet`}");
    expect(halls).toContain("cityHasNoVenues && !hallsFailed");
  });

  it("the desktop featured row ends in a browse card instead of empty page", () => {
    expect(read("app/page.tsx")).toContain("{featured.length < 6 && (");
  });
});

describe("the owner page describes quotes while direct booking is off", () => {
  const page = read("app/owner/register/page.tsx");
  const off = page.slice(page.indexOf("    : {\n        hero:"), page.indexOf("      };", page.indexOf("    : {\n        hero:")));

  it("does not promise the old money story", () => {
    expect(off.length).toBeGreaterThan(200);
    for (const stale of ["collects the advance", "never sends you a bill", "never invoiced", "payouts"]) {
      expect(off, stale).not.toContain(stale);
    }
    expect(off).toContain("only on a booking you confirm");
  });
});

describe("the assistant offers the planning tools", () => {
  it("as starter questions and as buttons", () => {
    expect(QUICK_ACTIONS.map((q) => q.id)).toEqual(expect.arrayContaining(["muhurtham", "budget"]));
    expect(QUICK_ACTIONS.map((q) => q.id)).not.toContain("availability");
    expect(CHAT_ACTION_ROUTES.muhurtham_dates.href).toBe("/muhurtham-dates");
    expect(CHAT_ACTION_ROUTES.budget_calculator.href).toBe("/budget");
  });
});

describe("the admin area (reviewed signed in, 2026-10-06)", () => {
  it("never offers an admin a button to deactivate themselves", () => {
    const users = read("app/admin/users/page.tsx");
    expect(users).toContain("const me = await requireRole([\"admin\"]);");
    expect(users.match(/u\.id === me\.id \?/g)?.length).toBe(2);
  });

  it("counts read as English ('1 hall', not '1 all hall')", () => {
    expect(read("app/admin/users/page.tsx")).toContain("${activeFilter.value ? `${activeFilter.label.toLowerCase()} ` : \"\"}account");
    expect(read("app/admin/halls/page.tsx")).toContain("${activeFilter.value ? `${activeFilter.label.toLowerCase()} ` : \"\"}hall");
  });

  it("surfaces unread contact-form messages on the dashboard", () => {
    expect(read("lib/admin.ts")).toContain('db.from("contact_messages").select("id", { count: "exact", head: true }).eq("is_read", false)');
    expect(read("app/admin/dashboard/page.tsx")).toContain('label: "Unread contact messages"');
  });

  it("says the payment settings are dormant while direct booking is off", () => {
    expect(read("app/admin/settings/page.tsx")).toContain("{!DIRECT_BOOKING_ENABLED && (");
  });

  it("keeps the family links out of the dashboards' header", () => {
    const nav = read("components/layout/Navbar.tsx");
    expect(nav).toContain('(pathname.startsWith("/owner") && !pathname.startsWith("/owner/register"))');
    expect(nav).toContain("{!workspace && <SavedLink");
  });

  it("uses readable grey for text in the signed-in areas", () => {
    for (const f of ["app/admin/_components/AdminSidebarNav.tsx", "app/admin/owners/page.tsx", "app/owner/(dashboard)/_components/OwnerBottomNav.tsx"]) {
      expect(read(f), f).not.toMatch(/(^|[" {`])text-charcoal-400/);
    }
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import QRCode from "qrcode";
import { describe, expect, it } from "vitest";
import { DIRECT_BOOKING_ENABLED } from "@/lib/booking-switch";
import { STANDEE_SLUG, isLikelyBot, standeeCopy, standeePath } from "../standee";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("what the standee promises", () => {
  it("never tells a lead venue's visitors to pay online or check free dates", () => {
    const lead = standeeCopy("LEAD_GENERATION");
    expect(lead.en).not.toMatch(/pay|advance|free dates/i);
    expect(lead.ta).not.toContain("முன்பணம்");
    expect(lead.en).toMatch(/enquire/i);
  });

  it.runIf(DIRECT_BOOKING_ENABLED)("offers dates and the advance for a direct-booking venue", () => {
    const direct = standeeCopy("DIRECT_BOOKING");
    expect(direct.en).toMatch(/free dates/i);
    expect(direct.en).toMatch(/advance/i);
    expect(direct.ta).toMatch(/[஀-௿]/);
  });
});

describe("the code", () => {
  it("points at the short /q route, not the venue page", () => {
    expect(standeePath("ns-khalyaana-mahal-madurai")).toBe("/q/ns-khalyaana-mahal-madurai");
  });

  it("prints squares big enough to scan from across a desk", () => {
    // What decides whether a phone reads a code at a distance is the printed
    // size of one square. On the A5 card the code is 50cqw of 148 mm, less 3cqw
    // padding each side: 65.12 mm. Phones read 1.5 mm squares comfortably at
    // about a metre. Checked for today's real slug and a 60-character one.
    const codeMm = 148 * (0.50 - 2 * 0.03);
    for (const slug of ["ns-khalyaana-mahal-madurai", "a".repeat(60)]) {
      const qr = QRCode.create(`https://hallnect.com/q/${slug}`, { errorCorrectionLevel: "M" });
      expect(codeMm / qr.modules.size, slug).toBeGreaterThanOrEqual(1.5);
    }
  });

  it("accepts real slugs and nothing else", () => {
    expect(STANDEE_SLUG.test("ns-khalyaana-mahal-madurai")).toBe(true);
    for (const bad of ["", "../admin", "Hall", "a--b", "-a", "a b", "a/b"]) {
      expect(STANDEE_SLUG.test(bad), bad).toBe(false);
    }
  });
});

describe("what counts as a scan", () => {
  it("counts phone browsers", () => {
    expect(isLikelyBot("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")).toBe(false);
    expect(isLikelyBot("Mozilla/5.0 (Linux; Android 14; SM-A146B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36")).toBe(false);
  });

  it("does not count link previews, crawlers or scripts", () => {
    for (const ua of [null, "", "WhatsApp/2.24", "facebookexternalhit/1.1", "Googlebot/2.1", "curl/8.4", "python-requests/2.31", "TelegramBot (like TwitterBot)"]) {
      expect(isLikelyBot(ua), String(ua)).toBe(true);
    }
  });
});

describe("the wiring", () => {
  const route = read("app/q/[slug]/route.ts");
  const server = read("lib/standee.server.ts");
  const page = read("app/owner/(dashboard)/halls/[id]/standee/page.tsx");
  const migration = read("supabase/migrations/0107_hall_qr_scans.sql");

  it("redirects first and counts after, uncached", () => {
    expect(route).toContain("after(() => recordStandeeScan(hall.id))");
    expect(route).toContain('res.headers.set("Cache-Control", "no-store")');
    expect(route).toContain('target.searchParams.set("src", "qr")');
  });

  it("only lands a scan on an approved hall", () => {
    expect(server).toContain('.eq("status", "approved")');
    expect(page).toContain('const approved = hall.status === "approved"');
  });

  it("never lets a counting failure stop the redirect", () => {
    const record = server.slice(server.indexOf("export async function recordStandeeScan"));
    expect(record.slice(0, record.indexOf("\n}\n"))).toContain("catch");
  });

  it("says when the count could not be read, instead of showing zero", () => {
    expect(page).toContain("stats == null");
    expect(page).toContain("Couldn't load the scan count");
  });

  it("states every grant, and lets only the service role count", () => {
    expect(migration).toContain("grant all on public.hall_qr_scans to service_role;");
    expect(migration).toContain("revoke all on public.hall_qr_scans from anon, authenticated;");
    expect(migration).toContain("revoke all on function public.record_hall_qr_scan(uuid) from public, anon, authenticated;");
  });

  it("keeps crawlers off the scan route", () => {
    expect(read("app/robots.ts")).toContain('"/q/"');
  });

  it("keeps the card's code at the size the test above assumes", () => {
    expect(read("app/owner/(dashboard)/halls/[id]/standee/_components/StandeeCard.tsx")).toContain("w-[50cqw]");
  });

  it("prints one A5 sheet, not one per page", () => {
    // `position: fixed` made Chrome repeat the card on every printed page, and
    // the hidden rest of the page made three of them (measured with headless
    // print-to-pdf). Absolute + a one-sheet clamp on html/body prints one.
    const card = read("app/owner/(dashboard)/halls/[id]/standee/_components/StandeeCard.tsx");
    const css = card.slice(card.indexOf("STANDEE_PRINT_CSS"), card.indexOf("}`;"));
    expect(css).toContain("@page { size: A5 portrait; margin: 0; }");
    expect(css).toContain("position: absolute");
    expect(css).not.toContain("position: fixed");
    expect(css).toContain("height: 210mm !important");
    expect(css).toContain("print-color-adjust: exact");
  });

  it("is reachable from the owner's halls", () => {
    expect(read("app/owner/(dashboard)/halls/page.tsx")).toContain("/owner/halls/${hall.id}/standee");
  });
});

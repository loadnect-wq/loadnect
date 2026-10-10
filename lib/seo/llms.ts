// ─────────────────────────────────────────────────────────────────────────────
// lib/seo/llms.ts — the text of /llms.txt (https://llmstxt.org).
//
// A plain-language map of the site for AI answer engines: what Hallnect is, who
// runs it, how booking works, and links to the pages worth reading — written
// so that a model quoting it says only true things.
//
// FROM REAL DATA ONLY. Venue and city lines come from the live catalogue
// (approved halls, the same set the sitemap lists); nothing is listed that a
// visitor cannot open. The commission rate is NOT stated — it is not published
// anywhere public (business decision, 2026-09-17). The platform fee is, because
// every checkout discloses it.
//
// PURE: the route (app/llms.txt/route.ts) fetches, this formats, and a test
// pins the output.
// ─────────────────────────────────────────────────────────────────────────────

import { formatHallPrice, isLeadGeneration } from "@/lib/booking-mode";
import { FAMILY_TOOLS, TOOLS_PATH } from "@/lib/family-tools";
import { hallnectDefinition } from "./definition";

export type LlmsVenue = {
  name: string;
  slug: string;
  city: string;
  capacityMax: number | null;
  pricePerDay: number | null;
  bookingMode: string | null;
};

export type LlmsCity = { city: string; slug: string; venueCount: number };

export type LlmsInput = {
  siteUrl: string;
  /** YYYY-MM-DD, India time. */
  generatedOn: string;
  venues: LlmsVenue[];
  /** Cities whose page is indexable (enough live venues). */
  cities: LlmsCity[];
  directBookingEnabled: boolean;
  feeDisclosure: string;
  contact: { legalName: string; email: string; phone: string; address: string };
  supportHours: string;
};

/** The longest list of venues written out; the rest are reached from /halls. */
export const LLMS_VENUE_LIMIT = 100;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function buildLlmsTxt(input: LlmsInput): string {
  const u = (path: string) => `${input.siteUrl}${path}`;
  const { venues, cities, contact } = input;
  const lines: string[] = [];

  lines.push("# Hallnect", "");
  // The one definition the home and About pages also print (lib/seo/definition.ts).
  lines.push(
    `> ${hallnectDefinition({ directBookingEnabled: input.directBookingEnabled, legalName: contact.legalName })}`,
    "",
  );

  lines.push(`Facts, from the live catalogue on ${input.generatedOn}:`, "");
  const cityNames = cities.map((c) => c.city);
  lines.push(
    `- Live venues: ${plural(venues.length, "venue", "venues")}` +
      (cityNames.length ? ` (cities with a venue page: ${cityNames.join(", ")}).` : "."),
  );
  lines.push(
    "- Every listing is submitted by the venue's owner and checked by Hallnect for completeness " +
      "before it goes live. Hallnect does not visit venues; families should confirm details with the venue.",
  );
  lines.push(
    "- Quotes: a family tells the hall its date, occasion and guest count. The hall replies on Hallnect " +
      "with its price; it sees the family's phone number only if the family accepts the quote. Asking " +
      "for a quote is free, and the family pays the hall directly.",
  );
  if (input.directBookingEnabled) {
    lines.push(
      `- Online booking (on halls that offer it): the family pays an advance through Cashfree plus a ` +
        `${input.feeDisclosure}, and the booking is confirmed when the hall accepts it. The balance is ` +
        "paid to the hall.",
    );
  }
  lines.push(
    `- Contact: ${contact.email}, ${contact.phone} (${input.supportHours}). Address: ${contact.address}.`,
    "",
  );

  if (venues.length > 0) {
    lines.push("## Venues", "");
    for (const v of venues.slice(0, LLMS_VENUE_LIMIT)) {
      const facts = [
        v.capacityMax ? `up to ${v.capacityMax.toLocaleString("en-IN")} guests` : null,
        v.pricePerDay ? `${formatHallPrice(v.pricePerDay)} per day` : null,
        isLeadGeneration(v.bookingMode) || !input.directBookingEnabled ? "quotes" : "books online",
      ].filter(Boolean);
      lines.push(`- [${v.name}, ${v.city}](${u(`/halls/${v.slug}`)}): ${facts.join("; ")}`);
    }
    if (venues.length > LLMS_VENUE_LIMIT) {
      lines.push(`- [All ${venues.length} venues](${u("/halls")})`);
    }
    lines.push("");
  }

  lines.push("## Find a hall", "");
  lines.push(`- [Browse all halls](${u("/halls")}): every live venue, with filters for city, guests, budget and date`);
  for (const c of cities) {
    lines.push(`- [Wedding halls in ${c.city}](${u(`/wedding-halls/${c.slug}`)}): ${plural(c.venueCount, "venue", "venues")}, prices and a city guide`);
    lines.push(`- [Wedding halls in ${c.city}, in Tamil](${u(`/ta/wedding-halls/${c.slug}`)})`);
  }
  lines.push("");

  lines.push("## Plan a function", "");
  for (const t of FAMILY_TOOLS) {
    lines.push(`- [${t.title}](${u(t.href)}): ${t.blurb}${t.noSignIn ? "" : " (needs sign-in)"}`);
  }
  lines.push(`- [Muhurtham dates, in Tamil](${u("/ta/muhurtham-dates")})`);
  lines.push(`- [All planning tools](${u(TOOLS_PATH)})`, "");

  lines.push("## For venue owners", "");
  lines.push(`- [List your hall](${u("/owner/register")}): free listing, and how quotes, bookings and the commission work`);
  lines.push(`- [Premium plans](${u("/premium")}): paid placement plans for listed halls`, "");

  lines.push("## About Hallnect", "");
  lines.push(`- [About](${u("/about")})`);
  lines.push(`- [Contact](${u("/contact")})`);
  lines.push(`- [Terms and conditions](${u("/terms")})`);
  lines.push(`- [Privacy policy](${u("/privacy")})`);
  lines.push(`- [Refund policy](${u("/refund-policy")})`);
  lines.push(`- [Cancellation policy](${u("/cancellation-policy")})`);
  lines.push(`- [Grievance redressal](${u("/grievance-redressal")})`);
  lines.push(`- [Disclaimer](${u("/disclaimer")})`, "");

  lines.push("## Optional", "");
  lines.push(`- [Sitemap](${u("/sitemap.xml")}): every indexable page`);

  return lines.join("\n") + "\n";
}

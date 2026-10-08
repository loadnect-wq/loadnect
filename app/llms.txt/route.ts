// ─────────────────────────────────────────────────────────────────────────────
// /llms.txt — a plain-language map of Hallnect for AI answer engines
// (https://llmstxt.org). The text is built in lib/seo/llms.ts from the live
// catalogue; see there for what it does and does not say.
//
// ISR: rebuilt at most hourly, and at once when a hall goes live or changes
// (revalidateVenuePages). A failed database read throws, so Next keeps serving
// the last good file rather than one that says there are no venues.
// ─────────────────────────────────────────────────────────────────────────────

import { buildLlmsTxt } from "@/lib/seo/llms";
import { fetchIndexableCities } from "@/lib/seo/cities";
import { fetchLiveVenueFacts } from "@/lib/seo/sitemap-data";
import { SITE_URL } from "@/lib/seo/config";
import { CONTACT, SUPPORT_HOURS } from "@/lib/constants";
import { DIRECT_BOOKING_ENABLED } from "@/lib/booking-switch";
import { platformFeeDisclosure } from "@/lib/booking-payment";
import { todayInBusinessTz } from "@/lib/dates";

export const revalidate = 3600;

export async function GET(): Promise<Response> {
  const [cities, venues] = await Promise.all([fetchIndexableCities(), fetchLiveVenueFacts()]);

  const body = buildLlmsTxt({
    siteUrl: SITE_URL,
    generatedOn: todayInBusinessTz(),
    venues,
    cities: cities.map((c) => ({ city: c.city, slug: c.slug, venueCount: c.venueCount })),
    directBookingEnabled: DIRECT_BOOKING_ENABLED,
    feeDisclosure: platformFeeDisclosure(),
    contact: { legalName: CONTACT.legalName, email: CONTACT.email, phone: CONTACT.phone, address: CONTACT.address },
    supportHours: SUPPORT_HOURS.label,
  });

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

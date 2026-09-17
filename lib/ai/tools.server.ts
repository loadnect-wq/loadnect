// ─────────────────────────────────────────────────────────────────────────────
// lib/ai/tools.server.ts — the only ways the Hallnect Assistant can look at
// live data. SERVER-ONLY.
//
// READ-ONLY, AND THROUGH THE SAME DOORS AS THE WEBSITE. Every tool calls a
// function a page already uses — fetchHallsResult (/halls), fetchHallBySlug
// (/halls/[slug]), fetchHallAvailabilityWindow (/book/[slug]), fetchMyBookings
// (/customer/bookings) — with the public or the caller's own session client.
// No tool uses the service role, writes anything, or takes an id that could
// reach another person's records: "my bookings" is the session's own rows.
//
// WHAT A TOOL RETURNS IS WHAT THE MODEL MAY SAY. Outputs are trimmed to public
// listing fields; a failed lookup says so explicitly ("lookup_failed") so the
// model reports a problem instead of "no halls found".
//
// Built per request: the amenity list is read live, and getMyBookings answers
// only for a signed-in caller (role comes from the server session, never the
// request body).
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import { tool } from "ai";
import { z } from "zod";
import { fetchHallsResult, fetchHallBySlug, type HallsFilters } from "@/lib/halls";
import { fetchHallAvailabilityWindow } from "@/lib/availability";
import { fetchMyBookings } from "@/lib/customer";
import { LAUNCH_CITIES } from "@/lib/content";
import { formatHallPrice, isLeadGeneration, primaryCtaHref, primaryCtaLabel, BOOKING_MODE_LABEL } from "@/lib/booking-mode";
import { todayInBusinessTz, addDaysToIsoDate } from "@/lib/dates";
import { getSupabasePublicClient } from "@/lib/supabase/public";
import { CHAT_ACTION_KEYS, CHAT_ACTION_ROUTES, HALL_SLUG_PATTERN, type ChatActionKey } from "@/lib/ai/chat-config";
import type { ChatRole } from "@/lib/ai/knowledge.server";

const MAX_RESULTS = 6;
/** How far ahead availability is read — the booking calendar's own horizon. */
const AVAILABILITY_HORIZON_DAYS = 365;

export type ChatHallCard = {
  slug: string;
  name: string;
  city: string;
  area: string | null;
  capacity: number;
  price: string;
  bookingMode: string;
  coverUrl: string | null;
  amenities: string[];
  /** Present only when the hall has real reviews. */
  rating: { average: number; count: number } | null;
  primaryHref: string;
  primaryLabel: string;
};

async function amenityCatalogue(): Promise<{ slug: string; name: string }[]> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped Supabase client
    const db = getSupabasePublicClient() as any;
    const { data, error } = await db.from("amenities").select("slug, name").order("name");
    if (error || !data) return [];
    return data as { slug: string; name: string }[];
  } catch {
    return [];
  }
}

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function matchCity(raw: string | undefined): { city?: string; q?: string } {
  const v = (raw ?? "").trim().slice(0, 60);
  if (!v) return {};
  const hit = LAUNCH_CITIES.find((c) => normalise(c) === normalise(v));
  if (hit) return { city: hit };
  if (normalise(v) === "trichy") return { city: "Tiruchirappalli" };
  return { q: v };
}

export async function buildChatTools(role: ChatRole) {
  const amenities = await amenityCatalogue();
  const amenityNames = amenities.map((a) => a.name);

  const common = {
    searchHalls: tool({
      description:
        "Search Hallnect's live catalogue of approved halls. Use for any request to find, list or compare venues " +
        "(by city, area, guest capacity, amenity, budget, or date). Returns at most 6 halls, rendered to the user as cards. " +
        "An empty list means no approved hall matches — say so honestly and suggest widening the search.",
      inputSchema: z.object({
        city: z.string().max(60).optional().describe(`City name, e.g. ${LAUNCH_CITIES.join(", ")}`),
        area: z.string().max(60).optional().describe("Neighbourhood or locality within the address"),
        text: z.string().max(80).optional().describe("Free text matched against hall name, city and address"),
        minGuests: z.number().int().min(1).max(100000).optional().describe("Minimum guest capacity required"),
        maxPricePerDay: z.number().min(1).max(100000000).optional().describe("Budget: maximum full-day price in rupees"),
        amenity: z.string().max(60).optional().describe(
          amenityNames.length ? `One amenity, exactly one of: ${amenityNames.join(", ")}` : "One amenity name"),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
          .describe("YYYY-MM-DD. Excludes halls whose calendar is fully blocked that day. Ask for the year if unclear."),
        sort: z.enum(["recommended", "price-asc", "price-desc", "capacity"]).optional(),
      }),
      execute: async (input) => {
        const filters: HallsFilters = { ...matchCity(input.city) };
        if (input.text) filters.q = [filters.q, input.text.trim()].filter(Boolean).join(" ").slice(0, 80);
        if (input.area) filters.area = input.area.trim();
        if (input.minGuests) filters.capacity = String(input.minGuests);
        if (input.maxPricePerDay) filters.priceMax = String(input.maxPricePerDay);
        if (input.sort && input.sort !== "recommended") filters.sort = input.sort;
        if (input.date && input.date >= todayInBusinessTz()) filters.date = input.date;
        if (input.amenity) {
          const wanted = normalise(input.amenity);
          const hit = amenities.find((a) => normalise(a.name) === wanted || normalise(a.slug) === wanted)
            ?? amenities.find((a) => normalise(a.name).includes(wanted) || wanted.includes(normalise(a.name)));
          if (!hit) return { status: "unknown_amenity" as const, knownAmenities: amenityNames };
          filters.amenity = hit.slug;
        }

        const { halls, failed } = await fetchHallsResult(filters);
        if (failed) return { status: "lookup_failed" as const };

        const cards: ChatHallCard[] = halls.slice(0, MAX_RESULTS).map((h) => ({
          slug: h.slug,
          name: h.name,
          city: h.city,
          area: h.address,
          capacity: h.capacity_max,
          price: isLeadGeneration(h.booking_mode) && h.price_per_day == null
            ? "Price on enquiry"
            : `${formatHallPrice(h.price_per_day)} per day`,
          bookingMode: BOOKING_MODE_LABEL[h.booking_mode],
          coverUrl: h.cover_url,
          amenities: h.amenities.slice(0, 6),
          rating: h.rating_count > 0 ? { average: h.rating_average, count: h.rating_count } : null,
          primaryHref: primaryCtaHref(h.booking_mode, h.slug),
          primaryLabel: primaryCtaLabel(h.booking_mode),
        }));

        return {
          status: "ok" as const,
          totalMatches: halls.length,
          shown: cards.length,
          dateFilterApplied: Boolean(filters.date),
          halls: cards,
        };
      },
    }),

    getHallDetails: tool({
      description:
        "Get the published details of ONE approved hall by its slug (from a search result or the page the user is on): " +
        "capacity, prices, booking mode, amenities, venue types, address, description and review summary.",
      inputSchema: z.object({ slug: z.string().max(120).regex(HALL_SLUG_PATTERN) }),
      execute: async ({ slug }) => {
        const hall = await fetchHallBySlug(slug);
        if (!hall || hall.status !== "approved") return { status: "not_found" as const };
        return {
          status: "ok" as const,
          slug: hall.slug,
          name: hall.name,
          city: hall.city,
          address: hall.address,
          capacity: { min: hall.capacity_min, max: hall.capacity_max },
          bookingMode: BOOKING_MODE_LABEL[hall.booking_mode],
          prices: {
            fullDay: hall.price_per_day != null ? formatHallPrice(hall.price_per_day) : null,
            morning: hall.price_morning != null ? formatHallPrice(hall.price_morning) : null,
            evening: hall.price_evening != null ? formatHallPrice(hall.price_evening) : null,
          },
          venueTypes: hall.venue_types,
          amenities: [...hall.amenities.map((a) => a.name), ...hall.custom_amenities],
          description: hall.description ? hall.description.slice(0, 1200) : null,
          reviews: hall.rating_count > 0 ? { average: hall.rating_average, count: hall.rating_count } : null,
          pageHref: `/halls/${hall.slug}`,
          primaryHref: primaryCtaHref(hall.booking_mode, hall.slug),
          primaryLabel: primaryCtaLabel(hall.booking_mode),
        };
      },
    }),

    checkHallAvailability: tool({
      description:
        "Check whether an approved Direct Booking hall's calendar shows a date (or up to 4 consecutive dates) as open, " +
        "per slot. The result is the calendar as it stands now, not a reservation: the final check happens when the " +
        "customer books. Needs an exact date with a year — ask if the year is unclear.",
      inputSchema: z.object({
        slug: z.string().max(120).regex(HALL_SLUG_PATTERN),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      }),
      execute: async ({ slug, startDate, endDate }) => {
        const today = todayInBusinessTz();
        const end = endDate ?? startDate;
        if (startDate < today) return { status: "date_in_past" as const, today };
        if (end < startDate) return { status: "invalid_range" as const };
        if (startDate > addDaysToIsoDate(today, AVAILABILITY_HORIZON_DAYS)) return { status: "too_far_ahead" as const };
        if (end > addDaysToIsoDate(startDate, 3)) return { status: "range_too_long" as const, maxDays: 4 };

        const hall = await fetchHallBySlug(slug);
        if (!hall || hall.status !== "approved") return { status: "not_found" as const };
        if (isLeadGeneration(hall.booking_mode)) {
          return {
            status: "enquiry_venue" as const,
            name: hall.name,
            note: "This venue does not publish a booking calendar; dates are confirmed by the venue after an enquiry.",
            enquiryHref: primaryCtaHref(hall.booking_mode, hall.slug),
          };
        }

        const days = await fetchHallAvailabilityWindow(hall.id, startDate, end);
        return {
          status: "ok" as const,
          name: hall.name,
          days: days.map((d) => ({ date: d.date, morning: d.morning, evening: d.evening, fullDay: d.full_day })),
          bookHref: primaryCtaHref(hall.booking_mode, hall.slug),
        };
      },
    }),

    suggestActions: tool({
      description:
        "Attach up to 3 navigation buttons under your reply. Use only when a button genuinely helps the user's next step. " +
        "Hall-specific links come with hall cards and hall details — do not use this for them.",
      inputSchema: z.object({ actions: z.array(z.enum(CHAT_ACTION_KEYS)).min(1).max(3) }),
      execute: async ({ actions }) => ({
        actions: [...new Set(actions)].map((key: ChatActionKey) => ({ key, ...CHAT_ACTION_ROUTES[key] })),
      }),
    }),
  };

  return {
    ...common,
    getMyBookings: tool({
      description:
        "The signed-in user's OWN hall bookings: hall, dates, slot and status. Use only when they ask about their " +
        "bookings. It cannot see anyone else's bookings. For a guest it returns sign_in_required.",
      inputSchema: z.object({ which: z.enum(["upcoming", "past", "all"]).default("upcoming") }),
      execute: async ({ which }) => {
        if (role === "guest") return { status: "sign_in_required" as const };
        // The caller's session client, scoped by RLS and by customer_id = auth.uid().
        const bookings = await fetchMyBookings(which);
        return {
          status: "ok" as const,
          count: bookings.length,
          bookings: bookings.slice(0, 5).map((b) => ({
            hall: b.hall_name,
            city: b.hall_city,
            startDate: b.event_date,
            endDate: b.end_date,
            slot: b.slot,
            status: BOOKING_STATUS_MEANING[b.status] ?? b.status,
            detailsHref: `/customer/bookings/${b.id}`,
          })),
        };
      },
    }),
  };
}

/** The customer-facing meaning of each booking status (mirrors /customer/bookings/[id]). */
const BOOKING_STATUS_MEANING: Record<string, string> = {
  pending_payment:   "Payment pending — the booking is not confirmed until payment completes",
  payment_success:   "Paid — awaiting the venue's confirmation",
  booking_requested: "Requested — sent to the venue, awaiting its answer",
  owner_confirmed:   "Confirmed by the venue",
  owner_rejected:    "Declined by the venue",
  cancelled:         "Cancelled",
  completed:         "Completed",
  refunded:          "Refunded",
};

export type ChatTools = Awaited<ReturnType<typeof buildChatTools>>;

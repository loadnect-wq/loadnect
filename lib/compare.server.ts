// The halls behind a compare code. SERVER-ONLY.
//
// The venue page's own select (fetchHallBySlug), for up to three ids at once,
// through the cookie-free public client: RLS and status = 'approved' decide
// what is visible, as on every public page, and the page can be cached.
// Returns null on a failed read, so the page can say "couldn't load" instead
// of comparing nothing.

import "server-only";

import { getSupabasePublicClient } from "@/lib/supabase/public";
import { nullablePrice } from "@/lib/halls";
import { toBookingMode } from "@/lib/booking-mode";
import type { CompareHall } from "@/lib/compare";

const SELECT = `
  id, slug, name, city, address, latitude, longitude,
  capacity_min, capacity_max, price_per_day, price_morning, price_evening,
  booking_mode, rating_average, rating_count, venue_types,
  hall_images(url, is_cover, sort_order),
  hall_amenities(amenities(name, slug)),
  hall_custom_amenities(name, sort_order)
`;

export async function fetchCompareHalls(ids: readonly string[]): Promise<CompareHall[] | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getSupabasePublicClient() as any;
  const { data, error } = await db.from("halls").select(SELECT).in("id", ids as string[]).eq("status", "approved");
  if (error) {
    console.error("[compare] halls read failed:", error.code, error.message);
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const byId = new Map(((data ?? []) as any[]).map((row) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const imgs = ((row.hall_images ?? []) as any[]).slice().sort((a, b) =>
      a.is_cover === b.is_cover ? (a.sort_order ?? 0) - (b.sort_order ?? 0) : a.is_cover ? -1 : 1);
    const hall: CompareHall = {
      id: row.id,
      slug: row.slug,
      name: row.name,
      city: row.city,
      address: row.address ?? null,
      capacityMin: row.capacity_min ?? null,
      capacityMax: row.capacity_max,
      pricePerDay: nullablePrice(row.price_per_day),
      priceMorning: nullablePrice(row.price_morning),
      priceEvening: nullablePrice(row.price_evening),
      bookingMode: toBookingMode(row.booking_mode),
      ratingAverage: Number(row.rating_average) || 0,
      ratingCount: row.rating_count ?? 0,
      venueTypes: Array.isArray(row.venue_types) ? row.venue_types : [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      amenities: ((row.hall_amenities ?? []) as any[])
        .map((ha) => ({ slug: ha.amenities?.slug as string, name: ha.amenities?.name as string }))
        .filter((a) => a.slug && a.name),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      customAmenities: ((row.hall_custom_amenities ?? []) as any[])
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        .map((c) => c.name as string)
        .filter(Boolean),
      coverUrl: imgs[0]?.url ?? null,
      latitude: row.latitude != null ? Number(row.latitude) : null,
      longitude: row.longitude != null ? Number(row.longitude) : null,
    };
    return [hall.id, hall] as const;
  }));

  // The sender's order, not the database's.
  return ids.map((id) => byId.get(id)).filter((h): h is CompareHall => Boolean(h));
}

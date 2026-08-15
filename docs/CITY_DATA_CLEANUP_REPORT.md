# Hallnect — City Data Cleanup Report

**Date:** 2026-06-26 · Hallnect now serves **Tamil Nadu only**.

## Removed (out-of-Tamil-Nadu)
Cities/states removed from all user-facing data, filters, dropdowns, homepage tiles, testimonials, mock data, and seed data:
**Mumbai, Delhi, Bangalore, Hyderabad, Kochi, Jaipur, Pune, Kolkata, Goa** (and the states Maharashtra, Karnataka, Telangana, Kerala, Andhra Pradesh, Gujarat, Rajasthan, West Bengal, Uttar Pradesh, Madhya Pradesh, Punjab, Haryana, Goa from the owner-profile state list).

The 6 out-of-TN demo halls (Bangalore/Hyderabad/Kochi) from the old `demo_data.sql` are deleted by the cleanup SQL.

## Allowed Tamil Nadu cities/areas
Search/dropdown city list (`lib/mock-data.ts` `CITIES`, owner `HallForm`):
Madurai, Chennai, Coimbatore, Tiruchirappalli, Salem, Tirunelveli, Thanjavur, Dindigul, Erode, Tiruppur, Vellore, Kanchipuram, Sivakasi, Virudhunagar, Karaikudi, Rajapalayam, Pollachi, Chengalpattu.

Homepage "Popular Cities" tiles (`lib/content.ts` `POPULAR_CITIES`):
Madurai, Chennai, Coimbatore, Tiruchirappalli, Salem, Tirunelveli, Thanjavur, Erode — all "Tamil Nadu", no fabricated venue counts.

Other allowed areas (Thirunagar, T. Nagar, Velachery, OMR, Porur, Peelamedu, Gandhipuram, RS Puram, Tambaram, Avadi, Ambattur, Anna Nagar, Chengalpattu) are valid as free-text **area/address** input — they aren't restricted, since owners type addresses freely.

## Where city data is stored
| Location | Purpose | Status |
|---|---|---|
| `lib/mock-data.ts` `CITIES` | Search filter + location-selector dropdown | ✅ TN only |
| `lib/content.ts` `POPULAR_CITIES` | Homepage city tiles | ✅ TN only, counts removed |
| `lib/content.ts` `TESTIMONIALS` | Testimonial city labels | ✅ Madurai/Coimbatore/Chennai |
| `app/owner/(dashboard)/halls/_components/HallForm.tsx` `CITIES` | Owner "add hall" city select | ✅ TN only |
| `app/owner/(dashboard)/profile/_components/OwnerProfileForm.tsx` `STATES` | Owner business state | ✅ `["Tamil Nadu"]` |
| `app/_components/HomeLocation.tsx` | Default city | ✅ `Madurai` |
| Supabase `halls.city` | **Real** hall data (source of truth) | Cleaned via `seed_clean_hallnect_demo.sql` |

## Display changes
- Removed fabricated "X halls / X venues" counts from city tiles (homepage desktop + mobile `CitiesRow`) — now show the state ("Tamil Nadu").
- `MOCK_HALLS` array emptied (`lib/mock-data.ts`) — removed ~12 fake halls (many out-of-TN). The legacy `/saved` guest page now shows a clean empty state; real saved halls live at `/customer/saved-halls` (Supabase).
- "Pan-India Coverage" copy → "Tamil Nadu Coverage".

## Verification
`grep` for `Bangalore|Hyderabad|Kochi|Mumbai|Delhi|…` across the repo (excluding docs) matches **only** `supabase/seeds/seed_clean_hallnect_demo.sql` and `supabase/seeds/README.md`, where they appear as "removed/deleted" references. No user-facing app data, filter, card, metadata, or constant contains an out-of-TN city.

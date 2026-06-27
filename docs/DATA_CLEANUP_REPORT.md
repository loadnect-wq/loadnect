# Hallnect — Data Cleanup Report

**Date:** 2026-06-26

## What fake/demo data was removed
- **Homepage featured venues** no longer render `MOCK_HALLS` (≈12 fabricated halls like "Royal Grand Banquet", "The Leela Convention", "Maharaja Gardens"). The home page now fetches **real approved halls from Supabase** (`fetchHalls`) and shows an **empty state** when there are none. This also fixed the 404s those fake slugs caused.
- **Homepage "Recently Viewed"** (mock-backed list) removed. The recorder `recordRecentlyViewed()` (used by the hall detail page on real halls) is kept; the mock-rendering UI is gone.
- **`app/_components/FeaturedCarousel.tsx`** deleted (was mock-only, now orphaned).

## What example hall remains
A single, clearly-labelled example: **Grand Lotus Mahal** (`grand-lotus-mahal`), Chennai / T. Nagar, 300–800 guests, ₹85,000 base, status `approved`. Its description explicitly states it is sample/test data. Amenities: AC, Free Parking, In-house Catering, AV/Stage, Bridal Suite, Generator Backup, DJ & Music (mapped from the amenities catalogue).

## Where seed data lives
- **`supabase/seed_example_hall.sql`** — idempotent (`ON CONFLICT`) insert of Grand Lotus Mahal. Attaches to the first `hall_owners` row. Run it in the Supabase SQL Editor.
- Supabase is the **source of truth** for halls. The app reads halls via `lib/halls.ts` (`fetchHalls` / `fetchHallBySlug`) under RLS. There is no hardcoded hall data in components anymore.

## Still referencing demo data (known, NOT changed this pass)
- **`app/saved/_components/SavedView.tsx`** (the legacy `/saved` guest page) still imports `MOCK_HALLS` to resolve saved IDs. Since saves now store **real** hall IDs, this page will simply find nothing (renders empty) rather than show fake halls. The canonical saved-halls feature is the DB-backed **`/customer/saved-halls`**. Recommendation: redirect `/saved` → `/customer/saved-halls` (or `/login`) and delete `SavedView.tsx`. Deferred to avoid scope creep.
- **`lib/mock-data.ts`** is **kept** — it still exports real utilities used across the app (`formatPrice`, `CITIES`, `CAPACITY_OPTIONS`, `CARD_GRADIENTS`) plus the now-only-`/saved`-used `MOCK_HALLS` array. Do not delete the file; once `/saved` is consolidated, the `MOCK_HALLS` array can be removed and the utilities split into a `lib/format.ts`.
- **`lib/content.ts` `POPULAR_CITIES`** has illustrative venue counts ("48 venues"). The city tiles link to the real `/halls?city=…` search (no 404), but the counts are cosmetic placeholders. Consider removing the counts before public launch.

## How to add real halls later
Owners register (`/owner/register`) → admin approves the owner → owner adds a hall (`/owner/halls/new`) → admin approves the hall (`/admin/hall-approvals`). Approved halls automatically appear in search and on the homepage.

## How to reset demo data safely
```sql
delete from public.halls where slug = 'grand-lotus-mahal';
-- cascades to hall_images / hall_amenities / availability via FKs.
```
Re-running `supabase/seed_example_hall.sql` recreates it (idempotent). This never touches real owner-created halls.

# Hallnect — Final Tamil Nadu Launch Checklist

**Date:** 2026-06-26

## ✅ Tamil Nadu-only cities
- [x] Search/dropdown `CITIES` (lib/mock-data.ts) — TN only (18 cities)
- [x] Homepage `POPULAR_CITIES` (lib/content.ts) — TN only, no fake counts
- [x] Owner `HallForm` city select — TN only
- [x] Owner profile `STATES` — `["Tamil Nadu"]`
- [x] Default location — Madurai
- [x] Testimonials — Madurai / Coimbatore / Chennai
- [x] Branding copy — "Tamil Nadu Coverage" (was "Pan-India")
- [x] `MOCK_HALLS` emptied (removed ~12 fake halls incl. out-of-TN)

## ✅ Contact details
- [x] Email **hallnect@gmail.com**, Phones **+91 6383956613, +91 6380714364**, Address **Thirunagar, Madurai, Tamil Nadu, India**
- [x] Centralized `CONTACT` constant; applied to contact page, footer, legal pages, error/approval pages
- [x] Verified at runtime on `/contact` (no old `support@hallnect.com` / Mumbai)

## ✅ Example hall
- [x] `Grand Lotus Mahal` (`grand-lotus-mahal`), Madurai/Thirunagar, approved — `supabase/seeds/seed_clean_hallnect_demo.sql`
- [x] Image `public/images/example-hall.svg` with proper alt text; renders on card + detail (unoptimized)
- [x] Amenities, cover image, availability rows seeded
- [ ] **Run the seed in Supabase** (manual — needs an owner row) → then `/halls/grand-lotus-mahal` shows the hall

## ✅ No outside-Tamil-Nadu data remains
- [x] Repo grep (excluding docs) for Bangalore/Hyderabad/Kochi/Mumbai/Delhi matches **only** the cleanup SQL + its README (as "removed" references)
- [x] No out-of-TN city in any filter, card, metadata, route, or constant

## ✅ Build / lint / type-check
- [x] `npx tsc --noEmit` → **clean**
- [x] `npx eslint .` → **0 errors** (40 warnings, pre-existing/cosmetic)
- [x] `npx next build` → **exit 0**
- [ ] `npm run test` — no test runner installed (none added)

## Remaining manual tests (post-deploy)
- [ ] Run `seed_clean_hallnect_demo.sql`; confirm `/halls/grand-lotus-mahal` renders with the photo + amenities + availability
- [ ] Search "Madurai", "Thirunagar", "Wedding Hall", "Grand Lotus Mahal" → the hall appears
- [ ] Verify city dropdown/location selector shows TN cities only
- [ ] Booking flow on the example hall (advance payment) in Cashfree sandbox
- [ ] Per-role RLS checks (see `docs/SUPABASE_RLS_TESTING_GUIDE.md`)
- [ ] Mobile (360/390) + desktop (1024/1440) polish pass

## Routes verified (runtime, logged-out)
`/`, `/halls`, `/contact`, `/premium`, `/terms`, `/login`, `/signup`, `/owner/register` → **200**. Private dashboards redirect to login. Non-existent hall slug → branded not-found.

## Status
**Staging-ready.** Public-production after: run the seed, Cashfree sandbox test, per-role RLS test, and a live Vercel deploy verification.

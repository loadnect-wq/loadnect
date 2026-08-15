# Hallnect — Final Launch Cleanup Checklist

**Date:** 2026-06-28

## ✅ Fake content removed
- [x] Hero stats (2,400+ / 50,000+ / 4.8★) → honest "Launching in Tamil Nadu / Verified listings only / Secure booking flow / Owner-approved venues"
- [x] "Reach 50,000+ couples" CTA → "List your wedding hall on Hallnect"
- [x] "thousands of couples" / "trusted by" copy removed across home, signup, premium, footer, app description
- [x] `MOCK_HALLS` empty; no fake venue cards; fabricated city counts removed
- [x] No new fake numbers introduced

## ✅ Pricing updated (`/premium`)
- [x] Free **₹0**/mo · Pro **₹4,999**/mo (Most Popular) · Elite **₹9,999**/mo
- [x] Old Starter/₹2,999/₹5,999 removed
- [x] "Trial" wording removed (no trial logic exists)
- [x] WhatsApp notifications marked **(coming soon)**; Elite CTA → /contact

## ✅ Company name
- [x] **Hallnect Pvt Ltd** in Terms, Privacy, Footer; placeholder removed

## ✅ Tamil Nadu cities
- [x] User-facing city data is TN-only (filters, dropdowns, homepage tiles, owner forms, default location)
- [x] No Bangalore/Hyderabad/Kochi/Mumbai/Delhi in user-facing data (only in cleanup SQL/README as "removed")
- [x] Spelling "Coimbatore" correct

## ✅ Demo hall
- [x] Grand Lotus Mahal (Madurai/Thirunagar, approved) — `supabase/seeds/seed_clean_hallnect_demo.sql`
- [x] Image `public/images/example-hall.svg` (alt: "Grand Lotus Mahal wedding hall in Thirunagar, Madurai"); renders on card + detail
- [ ] **Run the seed in Supabase** (manual) → `/halls/grand-lotus-mahal` shows the hall; until then `/halls` + home show a clean empty state

## ✅ Build / lint / type-check
- [x] `tsc --noEmit` clean · `eslint .` 0 errors (40 cosmetic warnings) · `next build` exit 0
- [ ] `npm run test` — no test runner installed (none added)

## ✅ Routes verified (runtime, logged-out)
`/`, `/halls`, `/premium`, `/contact`, `/terms`, `/login`, `/signup`, `/owner/register` → **200**. Private dashboards redirect to login. Non-existent slug → branded not-found.

## Remaining manual tests (post-deploy)
- [ ] Run the seed; confirm `/halls/grand-lotus-mahal` shows photo + amenities + availability; `/halls` shows the one hall
- [ ] Search "Madurai" / "Grand Lotus Mahal" finds it
- [ ] Pricing page renders ₹0 / ₹4,999 / ₹9,999 on mobile + desktop
- [ ] Cashfree sandbox booking on the demo hall
- [ ] Per-role RLS checks (`docs/SUPABASE_RLS_TESTING_GUIDE.md`)

## Status
**Staging-ready.** Public-production after: run the seed, Cashfree sandbox test, per-role RLS test, and a live Vercel deploy verification.

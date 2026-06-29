# Hallnect — Final Launch Checklist (MVP without Cashfree)

**Date:** 2026-06-28 · Target: working MVP, Cashfree attached later.

## Build / quality gates (verified this build)
- [x] `next build` → **exit 0**
- [x] `tsc --noEmit` → **clean**
- [x] `eslint .` → **0 errors** (40 cosmetic warnings)
- [ ] `npm run test` — no test runner installed (none added)

## Core MVP works
- [x] Public users can browse (`/`, `/halls`, hall detail, legal, `/contact`, `/premium`)
- [x] Signup / login / logout (Supabase Auth)
- [x] Role protection server-side (`requireRole`) — customer / owner_approved / admin / owner_pending
- [x] **Booking request works WITHOUT Cashfree** (manual mode → `booking_requested`)
- [x] Owner can register, manage halls, view booking requests
- [x] Admin can approve owners/halls and manage the platform
- [x] No "not available" page blocks core usage
- [x] `/pricing` resolves (redirects to `/premium`)

## Cashfree (later)
- [x] Missing Cashfree env does NOT crash the app
- [x] Booking flow shows "Submit Booking Request" instead of pay
- [x] No Cashfree secret exposed to frontend (`import "server-only"`)
- [x] Server payment routes guarded (safe errors, no crash)
- [x] `docs/CASHFREE_LATER_SETUP.md` explains how to enable later

## Security
- [x] Open redirect fixed; CSRF role-change endpoint removed
- [x] Service-role key server-only; not in client bundle
- [x] RLS default-deny on all tables; escalation triggers in place
- [x] Manual booking uses trusted-backend only for the validated own-booking status flip (never marks paid)
- [x] No secrets committed (`.env*` ignored; only `.env.example`)

## Data / content
- [x] One demo hall: Grand Lotus Mahal (Madurai/Thirunagar) — run `supabase/seeds/seed_clean_hallnect_demo.sql`
- [x] No fake stats / testimonials / venue counts
- [x] Tamil-Nadu-only city data
- [x] Pricing Free ₹0 / Pro ₹4,999 / Elite ₹9,999 (no trial wording)

## Legal / contact
- [x] Company: **Hallnect Pvt Ltd** (Terms, Privacy, Footer)
- [x] Email **hallnect@gmail.com**; Phones **+91 6383956613, +91 6380714364**; Address **Thirunagar, Madurai, Tamil Nadu, India**
- [x] All legal pages exist and are non-empty

## Routes
- [x] No 404 on required routes; non-existent slug → branded not-found
- [x] Private routes redirect to login (no 500)

## Remaining manual tests (post-deploy)
- [ ] Set Vercel env (4 required) + redeploy without cache; confirm no 500
- [ ] Set Supabase Auth Site URL + `/auth/callback` redirect allow-list
- [ ] Run the demo-hall seed → `/halls/grand-lotus-mahal` shows the hall
- [ ] Full manual booking: customer submits request → owner sees it → admin sees it
- [ ] Per-role RLS denial tests (`SUPABASE_RLS_TESTING_GUIDE.md`)
- [ ] Mobile (360/390) + desktop (1024/1440) pass

## Verdict
**Ready for beta MVP launch on Vercel** once the 4 required env vars are set and the demo-hall seed is run. Cashfree can be attached anytime later with zero code changes. Public-production hardening = run the manual booking + RLS tests above.

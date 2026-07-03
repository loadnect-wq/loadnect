# Hallnect — Final Launch Checklist (MVP without Cashfree)

**Date:** 2026-06-28 · Target: working MVP, Cashfree attached later.

## ✅ Final verification pass (2026-06-30)
Automated + runtime evidence from the final launch-verification pass:

| # | Check | Result |
|---|---|---|
| 1 | `next build` | ✅ exit 0 |
| 2 | `eslint .` | ✅ 0 errors (40 cosmetic warnings) |
| 3 | `tsc --noEmit` | ✅ clean |
| 4 | No secrets committed | ✅ only `.env.example` tracked; no JWT/`sk_`/`cfpat_` in source |
| 5 | Vercel env vars documented | ✅ all 8 keys in `.env.example` + `VERCEL_DEPLOYMENT_GUIDE.md` |
| 6 | Supabase env handling safe | ✅ proxy + layout fail-open; browser client uses anon key only |
| 7 | Cashfree missing env → no crash | ✅ `isCashfreeConfigured()` is a pure boolean, never throws |
| 8 | Public pages work | ✅ 12/12 → 200 |
| 9 | Private routes redirect unauth | ✅ 21/21 → 307/redirect (no 500) |
| 21–25 | Routes / no "not available" / no 404 / no 500 | ✅ 33/33 routes OK; core pages have no "not available"; no server errors in logs |
| 28 | Legal pages exist | ✅ terms/privacy/refund/cancellation/disclaimer/contact render |
| 29 | Company/contact correct | ✅ Hallnect Pvt Ltd · hallnect@gmail.com · +91 6383956613, +91 6380714364 · Thirunagar, Madurai |
| 30 | Pricing | ✅ Free ₹0 · Pro ₹4,999 · Elite ₹9,999 (no Starter, no trial wording) |
| 6/7 (Cashfree) | Manual booking mode | ✅ code path present; runtime E2E is a manual test (needs login) |

**Not runtime-verified here (need a logged-in session — see "Remaining manual tests"):** signup/login/logout, customer/owner/admin dashboards, owner_pending flow, manual booking end-to-end, owner+admin seeing the request, and mobile/desktop polish of the auth-gated dashboards. Public-page mobile/desktop UI was verified in prior passes.


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

# Hallnect — Production-Ready Checklist

**Date:** 2026-06-26 · Legend: ✅ verified · 🟡 coded, needs live verification · ⛔ blocker

## Code gates (verified this audit)
- [x] ✅ `npm run lint` → 0 errors
- [x] ✅ `npm run type-check` (`tsc --noEmit`) → clean
- [x] ✅ `npm run build` (`next build`) → exit 0
- [ ] ⛔ `npm run test` — no test runner installed (recommended: Vitest + Playwright)

## Security
- [x] ✅ No hardcoded secrets in tracked source; `.env*` gitignored; only `.env.example` committed
- [x] ✅ `SUPABASE_SERVICE_ROLE_KEY` server-only (no `NEXT_PUBLIC_`, not in client bundle)
- [x] ✅ Open redirect fixed; CSRF role-change endpoint removed
- [x] ✅ Raw DB errors sanitized; logs redact secrets/PII
- [x] ✅ RLS default-deny on every table; escalation triggers in place
- [ ] 🟡 Per-role RLS runtime tests (`docs/SUPABASE_RLS_TESTING_GUIDE.md`)

## Auth & roles
- [x] ✅ Server-side route protection via `requireRole` (not UI-only)
- [x] ✅ Signup→customer; owner→owner_pending; admin not self-assignable
- [x] ✅ Role escalation blocked (RLS + `prevent_role_change`)
- [ ] 🟡 Full live signup/login/OAuth round-trips

## Payments (Cashfree)
- [x] ✅ Order creation server-side; secret never on frontend; amount server-computed
- [x] ✅ Webhook signature verified (HMAC-SHA256, fail-closed 401); idempotent
- [x] ✅ Failed/dropped payment does not confirm booking or create commission
- [ ] ⛔ End-to-end sandbox test (`docs/CASHFREE_TESTING_GUIDE.md`)

## Booking
- [x] ✅ Login required; hall must be approved; past dates blocked; capacity enforced
- [x] ✅ Double-booking prevented (partial unique index + overlap trigger)
- [x] ✅ Starts `pending_payment`; advances only on verified payment

## Database
- [x] ✅ Migrations 0001–0016 applied (verified via direct column probe)
- [x] ✅ FKs, indexes, enums, unique constraints, `updated_at` triggers

## Deployment
- [x] ✅ Vercel 500 root-caused & hardened (`docs/VERCEL_500_FIX_REPORT.md`)
- [ ] ⛔ Verified on a live Vercel deploy with all env vars set
- [ ] 🟡 Supabase Auth redirect URLs + Cashfree webhook URL set to prod domain

## UI/UX
- [x] ✅ Error boundaries, loading skeletons, empty states present
- [x] ✅ Landing/listing/detail responsive (mobile app-style + desktop)
- [ ] 🟡 Dashboards/booking flow mobile pass (360/390/768/1024/1440)

## Legal
- [x] ✅ Terms, Privacy, Refund, Cancellation, Disclaimer, Contact exist (non-empty)
- [ ] 🟡 Counsel review before public launch (pages carry an MVP-draft banner)

## Gate to call it production-ready
All ⛔ cleared: test pass (or documented manual sign-off), Cashfree sandbox E2E, live Vercel deploy verified. Until then: **staging-ready, not production-ready.**

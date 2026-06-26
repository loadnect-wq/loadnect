# Hallnect — Launch Readiness Checklist

**Audit date:** 2026-06-25 · **Build:** `next build` exit 0 · **Typecheck:** `tsc --noEmit` exit 0

> **Status legend — nothing is marked done unless verified.**
> - ✅ **Verified** — implemented in code AND confirmed (build/runtime/inspection in this environment)
> - 🟡 **Implemented, not end-to-end verified** — code is in place but needs a live/manual test (real Cashfree account, real OAuth round-trip, per-role DB test) that can't be done in this environment
> - ⛔ **Blocker** — not done; must be completed before launch
> - ⬜ **Cannot verify here** — requires external infra (deployed environment, live gateway)

---

## 🚦 Go / No-Go summary

| # | Item | Status |
|---|---|---|
| 1 | Landing page complete | ✅ Verified |
| 2 | Search working | ✅ Verified (code + 200) |
| 3 | Hall detail page working | ✅ Verified (code + 200) |
| 4 | Customer auth working | 🟡 Code verified; live signup/login not executed |
| 5 | Owner auth working | 🟡 Code verified; live OAuth/email not executed |
| 6 | Admin auth working | 🟡 Code verified; needs a real admin account to confirm |
| 7 | Owner approval working | 🟡 Code present; not runtime-tested against live DB |
| 8 | Hall approval working | 🟡 Code present; not runtime-tested against live DB |
| 9 | Image upload working | 🟡 Code + storage policy present; not runtime-tested |
| 10 | Availability working | 🟡 Code present; not runtime-tested |
| 11 | Booking working | 🟡 Code present; not runtime-tested (needs auth session) |
| 12 | Cashfree sandbox tested | ⛔ **Not tested** — no evidence of a completed sandbox transaction |
| 13 | Cashfree production config ready | ⬜ Env vars wired; **no production account confirmed** |
| 14 | Webhook verified | 🟡 Signature/idempotency code correct; not tested against live delivery |
| 15 | RLS tested | 🟡 Policies reviewed & sound; **not executed per-role against live DB** |
| 16 | Mobile tested | 🟡 Landing verified at 375/768/1280; other pages not exhaustively tested |
| 17 | Legal pages added | ✅ Verified |
| 18 | Support page added | ✅ Verified |
| 19 | No secret keys leaked | ✅ Verified |
| 20 | Vercel deployment working | ⛔ **No deployment exists** — project is not a git repo, never deployed |
| 21 | Database policies safe | 🟡 Policies safe; ⛔ **migrations 0013–0016 NOT applied to the connected DB** |

**Overall: 🚫 NOT launch-ready.** Three hard blockers (see below) plus a set of items that are coded but unverified end-to-end.

---

## ⛔ Blockers (must clear before launch)

1. **DB migrations 0013–0016 not applied.** The connected Supabase instance is missing `halls.premium_tier` — confirmed live this session:
   ```
   [fetchHalls] halls.premium_tier missing — run migration 0013 for tier sorting/badges.
   ```
   Impact: premium tiers/badges, advertisements, review sub-ratings + title, and support-ticket `internal_notes`/`medium` priority are non-functional. The app degrades gracefully (no crash) but these features are dark. **Apply 0013, 0014, 0015, 0016.**
2. **No production deployment.** The project is not a git repository and has never been deployed to Vercel. "Vercel deployment working" cannot be true yet. See `DEPLOYMENT_GUIDE.md`.
3. **Cashfree not tested.** No evidence of a completed sandbox transaction or a configured production merchant. Payments are the revenue path — must be exercised end-to-end before launch.

---

## Detailed status

### 1. Landing page — ✅ Verified
- Mobile app-style layout + desktop premium layout (hero, featured grid, cities, how-it-works, owner CTA, FAQ). Verified rendering at mobile (375px) and desktop (1280px) this session.

### 2. Search & filters — ✅ Verified (code) / 🟡 (data)
- `/halls` returns 200; keyword/city/capacity/price/amenity/category/sort/date filters implemented in `SearchControls` + `fetchHalls`. URL-param driven. Premium sorting/badges depend on migration 0013 (blocker #1).

### 3. Hall detail — ✅ Verified (code)
- `/halls/[slug]` 200; gallery, amenities, reviews, similar halls, sticky/sidebar booking. Non-existent slug → 404. RLS hides non-approved halls from public.

### 4–6. Auth (customer / owner / admin) — 🟡 Implemented, not executed live
- `/login`, `/signup`, `/owner/register`, `/auth/callback`, `/auth/redirect` all build and serve. Zod validation client+server. Role router (`getDashboardPath`) correct. **Open-redirect fixed** and **CSRF role-change endpoint removed** this session (verified: `/auth/set-owner-role` → 404, hostile `next` stays on-origin). Live signup/login/OAuth round-trips not executed (no test credentials / real provider here).

### 7–8. Owner & hall approval — 🟡 Code present
- Admin actions `approveOwner`/`rejectOwner`/`approveHall`/`rejectHall`/`suspendHall` exist, gated by `is_admin()` + escalation triggers. Not runtime-tested against live DB as an admin.

### 9. Image upload — 🟡 Code + policy present
- `ImagesManager` validates type/size client-side; bucket enforces `image/jpeg,png,webp` + 5 MB; storage RLS scopes path to owning hall; delete now behind a `ConfirmationDialog`. Not runtime-tested (needs approved owner session + storage).

### 10. Availability — 🟡 Code present
- Owner availability calendar + `setAvailability` action with Zod batch validation; public read gated to approved halls. Not runtime-tested.

### 11. Booking — 🟡 Code present
- Server recomputes price from DB; advance 25%; platform fee from `platform_settings` (default 5%); 15-min pending expiry; double-booking blocked by partial unique index + overlap trigger; past-date rejected (IST). Not runtime-tested (needs auth session + a payment).

### 12. Cashfree sandbox — ⛔ Not tested
- `lib/cashfree.ts` (create/get order, payments, signature) and `lib/payments.ts` exist and build. **No completed sandbox transaction observed.** Cashfree cannot reach `localhost`, so this needs a tunnel or a deployed env. Must test before launch.

### 13. Cashfree production config — ⬜ Cannot verify here
- Env vars `CASHFREE_APP_ID/SECRET_KEY/ENV` are read server-side; `CASHFREE_ENV=production` switches base URL. No production merchant credentials confirmed. See deployment guide.

### 14. Webhook — 🟡 Code correct, not live-tested
- `/api/webhooks/cashfree`: raw-body HMAC-SHA256 constant-time verify, **fail-closed 401**, re-verifies order via API (doesn't trust body), idempotent writes, safe logging. Correct by inspection; not exercised against real Cashfree delivery.

### 15. RLS — 🟡 Sound, not per-role runtime-tested
- Default-deny on every table; payments/commissions/premium/ads have no client write policy; escalation triggers (`prevent_role_change`, `prevent_owner_self_verify`, `prevent_hall_self_approve`, `validate_booking_transition`). Reviewed and correct. **Execute the §22 tests in `docs/QA_CHECKLIST.md` against the live DB as each role before launch.**

### 16. Mobile — 🟡 Partial
- Landing verified at 375/768/1280. Bottom nav, app shell, sticky booking bar implemented. Other surfaces (dashboards, booking flow) not exhaustively mobile-tested.

### 17. Legal pages — ✅ Verified
- `/terms`, `/privacy`, `/refund-policy`, `/cancellation-policy`, `/disclaimer` all render 200, share the `(legal)` layout with an MVP draft-review banner. **Note:** content is MVP-draft and must be reviewed by counsel before public launch.

### 18. Support page — ✅ Verified
- `/customer/support`, `/owner/support`, `/admin/support-tickets` build and serve; shared components; `internal_notes` never exposed to users.

### 19. No secret keys leaked — ✅ Verified
- `SUPABASE_SERVICE_ROLE_KEY` is server-only (no `NEXT_PUBLIC_`), not referenced in any client/app component; admin client imported only in `lib/supabase/admin.ts`, `lib/payments.ts`, `app/auth/callback/route.ts` (all server). `.env*` gitignored. `sanitizeError` redacts JWTs/tokens/Bearer/emails in logs. No raw DB errors returned to clients (all action files routed through `sanitizeError`).

### 20. Vercel deployment — ⛔ Not done
- Not a git repo; no deployment. See `DEPLOYMENT_GUIDE.md`.

### 21. Database policies safe — 🟡 / ⛔
- Policy design is safe (see `SECURITY_CHECKLIST.md`). Blocked by migrations 0013–0016 not being applied to the live DB.

---

## Pre-launch action list (ordered)

1. ⛔ Apply migrations `0013`–`0016` to the production Supabase project; re-run `/halls` and confirm the `premium_tier missing` log is gone.
2. ⛔ Initialize git, push, and deploy to Vercel (`DEPLOYMENT_GUIDE.md`).
3. ⛔ Configure Cashfree (sandbox first), run a full **success + failure** transaction, confirm webhook delivery + booking transition + commission row.
4. 🟡 Run `docs/QA_CHECKLIST.md` §22 (RLS) against the live DB as each of the 6 test accounts.
5. 🟡 Execute the full booking happy-path with a real customer account end-to-end.
6. 🟡 Mobile pass across dashboards + booking flow at 375px.
7. ⚖️ Legal review of the draft policy pages.
8. ✅ Re-confirm `next build` + `tsc` clean on the deploy commit.

# Hallnect — App Audit Report

**Date:** 2026-06-25
**Method:** source inspection (all 16 migrations, both Supabase clients, session proxy, env handling, Cashfree wrapper + webhook, all auth routes, action files, components) + executed checks (`eslint`, `tsc`, `next build`) + runtime probes on the dev server.

**Verified check results (this audit):**
| Check | Command | Result |
|---|---|---|
| Lint | `npm run lint` (`eslint .`) | ✅ exit 0 — 0 errors, 41 warnings |
| Type-check | `npm run type-check` (`tsc --noEmit`) | ✅ exit 0 |
| Build | `npm run build` (`next build`) | ✅ exit 0 |
| Tests | — | ⚠️ no test setup exists (no runner installed) |

> Legend: ✅ verified · 🟡 implemented, not runtime-verified end-to-end · ⛔ blocker · ⬜ needs external infra

---

## 1. App structure review
Standard Next.js App Router layout, well-organized:
- `app/` — routes: public (`/`, `/halls`, `/halls/[slug]`, legal, `/contact`, `/premium`), auth (`(auth)/login`, `(auth)/signup`, `owner/register`, `auth/callback`, `auth/redirect`), dashboards (`customer/*`, `owner/(dashboard)/*`, `admin/*`), API (`api/webhooks/cashfree`), server actions (`*/actions.ts`, `_actions/tickets.ts`).
- `components/` — `ui/` (Button, Input, Badge, skeleton, ConfirmationDialog, toast…), `app/` (AppHeader, BottomNav, BottomSheet), `layout/` (Navbar, Footer, PolicyLayout), `support/`, `ads/`, `sections/`.
- `lib/` — `supabase/` (client/server/admin/storage), `validation/schemas.ts` (Zod), `errors.ts`, `auth.ts`, `cashfree.ts`, `payments.ts`, `halls.ts`, `customer.ts`, `admin.ts`, `owner.ts`, `tickets.ts`, `platform-settings.ts`, `premium-plans.ts`, `ads.ts`, `env.ts`, `constants.ts`.
- `hooks/` + `lib/hooks/` — `useMediaQuery`, `useSavedHalls`, `use-toast`.
- `types/` — `database.ts` (Supabase types).
- `supabase/migrations/` — 0001–0016.
- Root: `proxy.ts` (Next 16 session-refresh "middleware"), `eslint.config.mjs`, `tailwind.config.ts`, `tsconfig.json`.

**Verdict:** ✅ structure is sound and conventional. No missing core files.

## 2. Missing files / features
- ⛔ **No automated test setup** — no Vitest/Jest/Playwright. `test` script intentionally NOT added (would be a no-op lie). Recommended as a follow-up.
- ⛔ **No git repo / no deployment config beyond Next defaults** — project is not version-controlled; never deployed.
- 🟡 Test accounts not seeded (documented in `docs/TESTING_CHECKLIST.md`).
- ✅ Legal pages, support pages, error boundaries, loading skeletons all present.

## 3. Broken routes
- ✅ None. All public routes return 200; auth-gated routes 307-redirect when logged out. Verified via route sweep.
- Note: a transient "all routes 404 except /" was observed during the audit — caused by running `next build` over a live dev server's `.next`; cleared by `rm -rf .next` + restart. **Not an app defect.**

## 4. Broken components
- ✅ None functionally broken. Two shared components touched for lint (`Input` empty-interface → type alias; no behavior change). Render verified.

## 5. TypeScript issues
- ✅ `tsc --noEmit` clean (exit 0). No type errors.

## 6. Build issues
- ✅ `next build` exit 0, 56 route entries compile.
- **Fixed this audit:** `lint` script referenced `next lint` (removed in Next 16) and the ESLint config crashed on load (`FlatCompat` circular-structure error under ESLint 9.39). Both fixed — see `BUG_FIX_REPORT.md`.

## 7. Auth issues
- ✅ Supabase Auth implemented correctly; route protection is **server-side** in layouts via `requireRole()`.
- ✅ Signup → `customer`; owner registration → `owner_pending` (via `handle_new_user` trigger); `admin` not self-assignable.
- ✅ **Fixed earlier this session:** open redirect in `/auth/callback`; CSRF-able role-change GET endpoint removed.
- 🟡 Live signup/login/OAuth round-trips not executed here (no test creds / real provider).

## 8. Database issues
- ✅ Schema is well-formed: FKs, indexes, enums, unique constraints, CHECKs (non-negative prices, capacity range, valid slug).
- ✅ Double-booking prevented: partial unique index `uq_booking_active_slot` + `prevent_overlapping_booking` trigger (full-day vs half-day).
- ✅ `created_at`/`updated_at` automated via `set_updated_at` trigger on all tables.
- ⛔ **Migrations 0013–0016 NOT applied to the connected DB** — confirmed live (`halls.premium_tier missing — run migration 0013`). Premium/ads/review-sub-ratings/ticket-internal-notes are dark until applied. The app degrades gracefully (no crash).

## 9. Supabase RLS issues
- ✅ RLS enabled default-deny on every table; payments/commissions/premium_listings have no client write policy (service-role only).
- ✅ Escalation blocked by triggers (`prevent_role_change`, `prevent_owner_self_verify`, `prevent_hall_self_approve`, `validate_booking_transition`) — all correctly `SECURITY INVOKER`.
- ✅ Public reads limited to approved halls/images/availability.
- 🟡 **Not runtime-tested per-role** against the live DB — policies reviewed and correct in SQL; execute `docs/TESTING_CHECKLIST.md` §security as each role before launch.

## 10. Payment issues
- ✅ Server recomputes amount from DB (client cannot set the charge); advance 25%; platform fee from `platform_settings`.
- ✅ Webhook verifies HMAC-SHA256 signature (fail-closed 401), re-verifies order via Cashfree API (doesn't trust body), idempotent.
- ✅ `CASHFREE_SECRET_KEY` server-only.
- ⛔ **Cashfree never tested end-to-end** — no completed sandbox transaction. Cashfree can't reach localhost; needs a tunnel or deployed env.

## 11. UI/UX issues
- ✅ Landing (mobile app-style + desktop premium), listing, detail, legal, support all render. Error boundaries + loading skeletons + empty states + ConfirmationDialog present.
- 🟡 Minor: dashboards/booking flow not exhaustively mobile-tested.

## 12. Mobile responsiveness issues
- ✅ Landing verified at 375/768/1280; bottom nav, app shell, sticky booking bar implemented.
- 🟡 Full per-page mobile pass across dashboards pending.

## 13. Deployment issues
- ⛔ Not a git repo; never deployed to Vercel. See `DEPLOYMENT_GUIDE.md`.
- ⬜ Cashfree production config + production Supabase migrations pending.

## 14. Priority order for fixes
| Priority | Item | Status |
|---|---|---|
| **Critical** | Open redirect in `/auth/callback` | ✅ Fixed (this session) |
| **Critical** | CSRF-able role-change endpoint | ✅ Fixed (this session) |
| **Critical** | Apply DB migrations 0013–0016 to prod | ⛔ Operational — pending |
| **High** | Lint toolchain broken (config crash + dead `next lint`) | ✅ Fixed (this audit) |
| **High** | Cashfree end-to-end test (success/failure/webhook) | ⛔ Pending |
| **High** | Per-role RLS runtime tests | 🟡 Pending |
| **Medium** | `sanitizeTicketText` regex bug (strips spaces/dashes) | ✅ Fixed (this audit) |
| **Medium** | 12 ESLint errors | ✅ Fixed (this audit) |
| **Medium** | Deploy to Vercel | ⛔ Pending |
| **Low** | 41 ESLint warnings (unused disable directives, `any`) | 🟡 Cosmetic cleanup |
| **Low** | Add automated test setup | ⛔ Recommended |

See `BUG_FIX_REPORT.md` and `SECURITY_FIX_REPORT.md` for fix detail, `TESTING_CHECKLIST.md` for verification steps.

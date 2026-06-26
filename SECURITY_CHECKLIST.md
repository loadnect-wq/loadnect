# Hallnect — Security Checklist

**Audit date:** 2026-06-25
**Method:** source inspection of all 16 migrations, both Supabase clients, the session proxy, env handling, the Cashfree wrapper + webhook, all auth routes, and the action files; plus runtime probes on the dev server.

> Legend: ✅ verified by inspection/runtime · 🟡 correct in code, needs per-role runtime test · ⬜ requires deployed env.

---

## 1. Secrets & environment

- [x] ✅ `SUPABASE_SERVICE_ROLE_KEY` is **not** prefixed `NEXT_PUBLIC_` and never referenced from a client component.
- [x] ✅ Service-role (RLS-bypassing) client is `import "server-only"` and imported only by `lib/supabase/admin.ts`, `lib/payments.ts`, `app/auth/callback/route.ts` — all server contexts.
- [x] ✅ `CASHFREE_SECRET_KEY` is server-only (`lib/cashfree.ts` is `import "server-only"`); never sent to the browser.
- [x] ✅ `.env`, `.env.local`, `.env.*.local` are gitignored. `.env.example` contains placeholders only.
- [x] ✅ No secrets in the client bundle (verified: `next build` output; no service-role/Cashfree-secret refs in client code).
- [ ] ⬜ Rotate any keys that were ever shared outside the team before go-live. Set all secrets in Vercel (not committed).

## 2. Authentication & sessions

- [x] ✅ Session is cookie-based, refreshed by `proxy.ts` on every request.
- [x] ✅ Route protection is server-side in layouts via `requireRole()` — not client-only, not via the proxy.
- [x] ✅ Email/password validated with Zod client-side AND on the server before use.
- [x] ✅ **Open redirect fixed** in `/auth/callback`: `next` is validated to a root-relative path and whitelisted; hostile payloads (`@evil.com`, `//evil.com`, `.evil.com`) stay on-origin. Verified live.
- [x] ✅ Callback fails closed: no `code` → `/login?error=oauth_failed`; no action taken without a valid OAuth code.

## 3. Authorization / RLS (database)

- [x] ✅ RLS enabled default-deny on **every** table (migration 0007).
- [x] ✅ `payments`, `commissions`, `premium_listings` have **no client write policy** (service-role only).
- [x] ✅ `advertisements` writes require `is_admin()`; public reads limited to `active` ads in date window.
- [x] ✅ Public reads limited to `approved` halls / their images / availability; non-approved invisible to anon.
- [x] ✅ Customer data isolation: bookings/payments/saved_halls/reviews scoped to `auth.uid()`.
- [ ] 🟡 **Run per-role denial tests** (`docs/QA_CHECKLIST.md` §22) against the live DB: customer2 vs customer1 data, owner1 vs owner2 halls, anon vs non-approved data. *Reviewed and correct in SQL; not yet executed as each role.*

## 4. Privilege escalation

- [x] ✅ `profiles.role` change blocked for non-admins by RLS `WITH CHECK` **and** `prevent_role_change` trigger.
- [x] ✅ Escalation triggers are `SECURITY INVOKER` (so `is_trusted_backend()` reads the real caller) — verified intentional, with code comments.
- [x] ✅ `handle_new_user` maps signup role: `owner` → `owner_pending`; can never self-assign `owner_approved`/`admin`.
- [x] ✅ `prevent_owner_self_verify` blocks non-admin `hall_owners.is_verified` changes.
- [x] ✅ `prevent_hall_self_approve` blocks owners setting `approved/rejected/suspended`.
- [x] ✅ **CSRF role-change endpoint removed.** The standalone `GET /auth/set-owner-role` (mutated role via session cookie alone) was deleted; the `customer → owner_pending` upgrade now happens **only inside the callback after a verified, single-use OAuth code exchange**. Verified: old endpoint → 404.

## 5. Booking & payment integrity

- [x] ✅ Booking amount recomputed server-side from DB; client cannot set the charge.
- [x] ✅ Booking financial/identity fields (`amounts`, `customer_id`, `hall_id`) immutable to customer/owner (`validate_booking_transition`).
- [x] ✅ Illegal booking status transitions rejected by the state-machine trigger.
- [x] ✅ Double-booking prevented by partial unique index + `prevent_overlapping_booking` (full-day vs half-day).
- [x] ✅ Commission `booking_id` is UNIQUE; rate snapshotted at booking time (no retroactive change).
- [ ] ⬜ Exercise a real sandbox payment to confirm the success/failure/idempotency paths end-to-end.

## 6. Cashfree webhook

- [x] ✅ Raw body read **before** parsing; signature = HMAC-SHA256(`${timestamp}${rawBody}`) compared constant-time.
- [x] ✅ Invalid/absent signature → **401**, fail closed.
- [x] ✅ Does **not** trust webhook body amounts/status — re-verifies order via Cashfree API.
- [x] ✅ Idempotent (status-guarded payment/booking updates, upserted availability, unique commission).
- [x] ✅ Logs only event type + order id — no secrets/headers/PII.
- [ ] ⬜ Confirm the deployed `notify_url` receives and verifies a real signed event.

## 7. Input handling / injection / XSS

- [x] ✅ All DB access uses the parameterized Supabase query builder; the only `.rpc()` calls use static names with no string interpolation → no SQL injection.
- [x] ✅ No `dangerouslySetInnerHTML` in app code; React auto-escapes.
- [x] ✅ Centralized Zod validation (`lib/validation/schemas.ts`) on every server action: emails, phones, non-negative prices, valid capacity (min ≤ max), past-date booking block, UUID args.
- [x] ✅ Free-text sanitized (`sanitizeText` strips angle brackets + control chars) with length caps.
- [x] ✅ Ad/image URLs reject `javascript:`/`data:`/`file:` and non-http(s).
- [ ] 🟡 **Known minor bug (non-security):** `lib/tickets.ts` `sanitizeTicketText` uses `/[<> -]/g` which also strips spaces/dashes. It's dead code (createTicket now uses `ticketSchema`), but delete or repoint it to `sanitizeText`.

## 8. Error handling & info disclosure

- [x] ✅ All action files route DB errors through `sanitizeError` — Postgres codes mapped to friendly messages; raw `error.message` never returned to clients.
- [x] ✅ Server logs redact JWTs / Cashfree tokens / Bearer headers / emails.
- [x] ✅ Branded error boundaries: `error.tsx`, `global-error.tsx`, `not-found.tsx` (no `error.message` rendered; digest only).

## 9. File upload

- [x] ✅ Bucket enforces mime whitelist (`image/jpeg,png,webp`) + 5 MB at the storage layer.
- [x] ✅ Storage RLS scopes write/delete to the owning hall's folder; path prefix re-checked in `addHallImage`.
- [x] ✅ Path traversal rejected (no `..`, charset-restricted).

---

## Outstanding before go-live

| Priority | Item |
|---|---|
| ⛔ High | Apply migrations 0013–0016 to production DB; the RLS/feature surface assumes them. |
| ⛔ High | Run §22 per-role RLS denial tests against the live DB. |
| ⛔ High | Exercise Cashfree sandbox (success + failure + webhook) end-to-end. |
| 🟡 Med | Set all secrets in Vercel env (never committed); rotate if ever shared. |
| 🟡 Med | Legal review of draft policy pages before public launch. |
| 🟢 Low | Remove/repoint dead `sanitizeTicketText` in `lib/tickets.ts`. |

**Security posture:** the database and payment layers are well-designed; the two real vulnerabilities found this session (open redirect, CSRF role change) are fixed and verified. Remaining work is **runtime verification** (per-role RLS, live payment) and the **migration gap** — not new code defects.

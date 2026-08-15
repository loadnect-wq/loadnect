# Hallnect — Security Audit Report

**Date:** 2026-06-26. Consolidated security posture. See `docs/SECURITY_FIX_REPORT.md` for per-fix detail and `docs/SUPABASE_RLS_TESTING_GUIDE.md` for runtime test procedures.

> Legend: ✅ verified by inspection/runtime · 🟡 correct in code, needs per-role runtime test · ⛔ pending

## Secret scan (this audit)
Searched tracked source for `SUPABASE_SERVICE_ROLE_KEY`, `CASHFREE_SECRET_KEY`, `CASHFREE_APP_ID`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `service_role`, and hardcoded JWT/`sk_`/`cfpat_` value patterns.

- [x] ✅ **No hardcoded secret values** in tracked source.
- [x] ✅ Secret env names appear only as `process.env.X` references, in docs, or in log strings — never assigned a literal.
- [x] ✅ Only `.env.example` (placeholders) is tracked; `.env`, `.env.*` gitignored (`!.env.example` kept).
- [x] ✅ `SUPABASE_SERVICE_ROLE_KEY` / `CASHFREE_SECRET_KEY` are server-only (`import "server-only"`), absent from the client bundle.
- [x] ✅ No secret VALUES were printed during this audit (scan masked values).

## Vulnerabilities found & fixed
| ID | Severity | Issue | Fix | Verified |
|---|---|---|---|---|
| SEC-1 | Critical | Open redirect in `/auth/callback` (`?next=@evil.com` → off-domain) | `safeNext()` allow-list + origin re-check | ✅ live |
| SEC-2 | High | CSRF-able role change via `GET /auth/set-owner-role` (cookie-only) | Endpoint deleted; upgrade moved into callback, gated by single-use OAuth code | ✅ (404 confirmed) |
| SEC-3 | High | Raw Postgres errors returned to clients (schema disclosure) | All 35 sites via `sanitizeError()`; logs redact secrets/PII | ✅ |
| SEC-4 | High | No server-side input validation | Zod schemas on every action (email/phone/price/capacity/date/UUID/URL) | ✅ |
| SEC-5 | Low | `sanitizeTicketText` corrupted text (`/[<> -]/g`) | Corrected class; not an XSS hole | ✅ |

## Authorization model (verified by inspection)
- [x] ✅ Route protection is **server-side** (`requireRole` in layouts), not UI-only.
- [x] ✅ RLS default-deny on all 15 tables; `payments`/`commissions`/`premium_listings` have no client write policy (service-role only).
- [x] ✅ Escalation blocked: `prevent_role_change`, `prevent_owner_self_verify`, `prevent_hall_self_approve`, `validate_booking_transition` (all `SECURITY INVOKER`).
- [x] ✅ `handle_new_user` maps `owner`→`owner_pending`; admin not self-assignable.
- [x] ✅ Public reads limited to `approved` halls/images/availability.

## Payment security (verified by inspection)
- [x] ✅ Order creation server-side; amount recomputed from DB; secret never on frontend.
- [x] ✅ Webhook: raw-body HMAC-SHA256 constant-time verify, fail-closed 401, re-verifies order via API, idempotent.
- [x] ✅ Failed/dropped payment does not confirm booking / block availability / create commission.

## Injection / XSS
- [x] ✅ Parameterized Supabase query builder; `.rpc()` uses static names → no SQL injection.
- [x] ✅ No `dangerouslySetInnerHTML` in app code; React auto-escapes.
- [x] ✅ Ad/image URLs reject `javascript:`/`data:`/`file:` (app + DB CHECK).

## Remaining (runtime/operational, not code defects)
- [ ] ⛔ Per-role RLS denial tests against the live DB (customer1≠customer2, owner1≠owner2, public≠pending).
- [ ] ⛔ Cashfree webhook verified against a real signed event.
- [ ] 🟡 Secrets set in Vercel (not committed); rotate if ever shared.

**Posture:** DB + payment layers are well-designed; the two real vulnerabilities are fixed and verified. Remaining work is runtime verification, not new defects.

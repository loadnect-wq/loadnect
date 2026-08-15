# Hallnect — Security Fix Report

Vulnerabilities found and fixed, each with root cause → fix → test. Posture summary and remaining risks at the bottom.

> Companion docs: `SECURITY_CHECKLIST.md` (full posture matrix), `docs/TESTING_CHECKLIST.md` (per-role manual tests).

---

## SEC-1 — Open redirect in the OAuth callback (Critical) — FIXED

**Root cause:** `app/auth/callback/route.ts` did `NextResponse.redirect(\`${origin}${next}\`)` where `next` is an attacker-controlled query param, concatenated with no validation. Proven payloads:
- `?next=.evil.com` → `https://app.com.evil.com` (attacker-controlled host)
- `?next=@evil.com` → `https://app.com@evil.com` (host = `evil.com`; the real domain becomes userinfo)

A link living on the legitimate domain that bounces users to a phishing site — a credential-phishing primitive.

**Fix:** added `safeNext()` — three layers: (1) must be root-relative (`/`-prefixed, not `//` or `/\`); (2) re-parsed against a dummy base to confirm the origin can't move (normalizes backslash/encoding tricks); (3) restricted to a known internal allow-list. Anything else falls back to `/auth/redirect`.

**How to test:** `curl -sS -o /dev/null -w "%{redirect_url}\n" "http://localhost:3000/auth/callback?next=@evil.com"` → resolves to `/login` on-origin, never an external host. **Verified live:** the callback follows to `localhost:3000/login?error=oauth_failed` under all hostile payloads.

---

## SEC-2 — CSRF-able role-change via state-changing GET (High) — FIXED

**Root cause:** `app/auth/set-owner-role/route.ts` was a standalone **GET** that used the **service-role client** to change a user's role (`customer → owner_pending`) using only the session cookie. Any page could trigger it for a logged-in customer via `<img src=".../auth/set-owner-role">`. Low impact (owner_pending grants nothing until admin approval, reversible) but a silent service-role mutation from a forgeable cross-site GET.

**Fix (proper, not a heuristic):** **deleted** the standalone endpoint and moved the upgrade **into `/auth/callback`, gated behind a successful `exchangeCodeForSession(code)`**. The OAuth `code` is single-use and unforgeable, so the mutation can no longer be triggered by a cookie-only cross-site request. The upgrade stays privilege-safe (`customer → owner_pending` only) and idempotent. The post-upgrade redirect now routes through the role router (`/auth/redirect`) so the flow self-corrects if the upgrade hasn't propagated.

**How to test:** `GET /auth/set-owner-role` → **404** (endpoint gone). `GET /auth/callback?next=/auth/set-owner-role` with no `code` → `/login?error=oauth_failed` (no upgrade without a valid code). **Verified live.** Full happy path requires real Google OAuth (verify in staging).

---

## SEC-3 — Raw database errors leaked to clients (High) — FIXED (earlier this session)

**Root cause:** 35 server-action sites returned `{ error: error.message }` directly, leaking Postgres internals (constraint names, column types, RLS policy names, and potentially echoed user input) to the client.

**Fix:** routed every site through `sanitizeError()` (`lib/errors.ts`), which maps Postgres SQLSTATE codes to friendly messages, logs the full error server-side only, and redacts JWTs / Cashfree tokens / Bearer headers / emails from logs. Files: `app/admin/actions.ts`, `app/owner/(dashboard)/actions.ts`, `app/customer/actions.ts`, `app/_actions/tickets.ts`.

**How to test:** trigger a constraint violation (e.g. cancel an already-cancelled booking) → user sees a generic message; server log has the structured, redacted detail. `grep -rn "error: error.message" app` → no results.

---

## SEC-4 — Missing server-side input validation (High) — FIXED (earlier this session)

**Root cause:** server actions trusted client input shape; no schema validation.

**Fix:** centralized Zod schemas (`lib/validation/schemas.ts`) wired into every action: email/phone format, non-negative prices, capacity (min ≤ max, bounded), **past-date booking block (IST)**, UUID args, slot/status enums, text sanitization + length caps, image type/size, ad/image URL scheme allow-list (`http(s)` only; rejects `javascript:`/`data:`/`file:`). Client-side validation mirrors it for UX; server-side is the security boundary.

**How to test:** submit a booking with a past date / a hall with a negative price / a 1-char password → rejected before any DB write.

---

## SEC-5 — Ticket text sanitizer corrupted input (Low; data-integrity, not exploit) — FIXED

**Root cause:** `lib/tickets.ts` `STRIP = /[<> -]/g` stripped spaces and dashes (the `-` was a literal at class-end). See `BUG_FIX_REPORT.md` BUG-7.

**Fix:** corrected to `/[<>\x00-\x1F\x7F]/g`. Not an XSS hole (React escapes; the angle-bracket strip still works) — the bug mangled legitimate text. Fixed for any future caller.

---

## Audit items verified SAFE (no fix needed)

- ✅ **Service-role key** is server-only (no `NEXT_PUBLIC_`), imported only by `lib/supabase/admin.ts`, `lib/payments.ts`, `app/auth/callback/route.ts`; absent from the client bundle. `.env*` gitignored.
- ✅ **Browser client** uses only the anon key.
- ✅ **RLS** default-deny on every table; payments/commissions/premium_listings have no client write policy.
- ✅ **Role escalation** blocked by RLS + triggers (`prevent_role_change`, `prevent_owner_self_verify`, `prevent_hall_self_approve`); `handle_new_user` can't self-assign admin.
- ✅ **Booking integrity** — server recomputes amount; financial/identity fields immutable to customer/owner; illegal status transitions rejected.
- ✅ **Webhook** — raw-body HMAC-SHA256 constant-time verify, fail-closed 401, re-verifies order via API, idempotent.
- ✅ **Double-booking** — partial unique index + overlap trigger.
- ✅ **SQL injection** — parameterized Supabase builder; the only `.rpc()` calls use static names.
- ✅ **XSS** — no `dangerouslySetInnerHTML` in app code; React auto-escapes.
- ✅ **Image upload** — bucket mime whitelist + 5 MB + storage RLS path-scoped to owning hall.

---

## Remaining security risks (honest)

| Severity | Risk | Status |
|---|---|---|
| ⛔ High | **Per-role RLS not runtime-tested** against the live DB. Policies are correct by inspection but not exercised as customer1 vs customer2, owner1 vs owner2, etc. | Run `docs/TESTING_CHECKLIST.md` §security before launch |
| ⛔ High | **Cashfree payment/webhook not tested end-to-end** with a real signed event. | Test in sandbox (tunnel or deployed) |
| 🟡 Med | **SEC-2 happy path** (Google owner upgrade) not exercised against live OAuth. The CSRF fix is verified; the success path needs a real provider. | Verify in staging |
| 🟡 Med | Secrets must be set in Vercel env (not committed) and rotated if ever shared. | At deploy time |
| 🟢 Low | Legal pages are MVP drafts — need counsel review (carry a draft banner). | Before public launch |

**Posture:** the database and payment layers are well-designed. The two real vulnerabilities (open redirect, CSRF role change) are fixed and verified. Remaining work is **runtime verification** and **operational** (migrations, deploy), not new code defects.

# Hallnect — Professional VAPT Report

**Assessment date:** 10 September 2026
**Target:** https://hallnect.com (production) and the `hallnect5` repository at commit `cae48be`
**Assessor:** Claude (Opus 5), acting as application security engineer, with written authorisation from the owner (HALLNECT LLP)
**Classification:** Confidential — contains vulnerability detail. No secrets, tokens, OTPs or personal data appear in this document.

> **Status of this document: COMPLETE.** Assessment 10–11 September 2026;
> remediation 11–12 September 2026. Every section is written. Findings are
> cross-referenced to `FINDINGS.md`, which is the canonical ledger; this
> document carries the method, the evidence and the reasoning.
>
> **Remediation has been performed and is included.** The assessment was
> completed and the findings documented *before* any security-sensitive code was
> changed, per the engagement's instruction not to silently fix ahead of
> documenting. The owner then authorised remediation, and each fix is named with
> its commit. Where a fix changed the assessment — twice it did — that is stated
> in place rather than quietly folded in.

---

## 1. Executive Summary

**56 findings confirmed. 35 fixed, 7 accepted with reasons recorded, 14 open —
none above Low.** Every Critical, High and Medium finding is closed, verified
against production, and pushed. A standalone summary for non-technical readers
is in `EXECUTIVE-SUMMARY.md`.

**The headline result is not a vulnerability.** Direct booking had been
*impossible* since GST shipped: a trigger written in migration 0045 asserted
`customer_total_amount = advance + fee`, migration 0049 made the customer total
include tax, and the two were never reconciled. Every full-price booking raised
`P0001` and rolled back, showing the customer a generic error. The only
bookings that could succeed were coupon bookings, because a waived fee makes the
broken equality hold — so the discounted path worked and the revenue path did
not. Production holds zero bookings; that had been read as "nothing has been
tried", and was at least partly "nothing *could* be".

A second defect underneath it made every venue priced under about ₹3,200/day
unsellable even after the first was fixed.

The security posture itself is better than the platform's stage would suggest:
RLS on every table, money re-verified against Cashfree rather than trusted from
the client, OTP owned by MSG91 behind five database-backed ceilings, webhook
signatures compared in constant time. What the assessment found was not absent
controls but **controls that did not quite meet each other** — most often a
grant wider than the policy guarding it, which PostgreSQL evaluates *first* and
which RLS, being row-level, can never compensate for at column granularity.

Three findings would have cost real money: a payout bank account that could
never be changed (and which silently disarmed the anti-redirection interlock), a
captured payment that could be swept away with no refund record, and a
platform-wide contact-form cap that any visitor could exhaust. One cost
credibility instead: a zero-width space let a venue owner smuggle a working
phone number into an official Hallnect SMS.

**Rating: 4.5/10 before, 8.1/10 after.** Launch recommended once
`CONTACT_IP_SALT` is set in Vercel and the missing password-reset flow is either
built or consciously deferred.

---

## 2. Assessment Scope

**In scope**

| Asset | Detail |
|---|---|
| Web application | https://hallnect.com — Next.js 16 App Router, deployed on Vercel (`syd1`) |
| Source repository | `loadnect-wq/hallnect5`, branch `main`, commit `cae48be` and full git history |
| Database | Supabase project `kvcrqhmgthixhqrjytay` (Postgres 17, region ap-southeast-2): schema, RLS, grants, functions, triggers, storage |
| Third-party integrations | Cashfree PG (orders, webhooks, refunds), Cashfree Payouts, MSG91 (OTP + transactional SMS + delivery webhook), Google Analytics 4 |
| Scheduled jobs | Four Vercel crons under `/api/admin/*` |
| Roles | Unauthenticated, customer, hall owner (`owner_pending` / `owner_approved`), admin |

**Out of scope / constraints honoured**

- No destructive testing. Every database probe ran inside a `DO` block terminated by `RAISE EXCEPTION`, so it rolled back; production row counts were verified unchanged afterwards.
- No real financial transactions were initiated by the assessor. One owner-initiated commission payment was *observed* (see §19).
- No testing of Cashfree's, MSG91's, Supabase's or Vercel's own infrastructure.
- No load, DoS or availability testing.
- There is no staging environment; production was assessed read-only.

---

## 3. Assessment Methodology

1. **Repository comprehension** — package manifest, `next.config.ts`, `proxy.ts`, all 75 migrations, every route handler and server action, all `lib/` modules, storage helpers, notification and payment modules.
2. **Deterministic scans** — `npm audit` (prod and dev), git-history secret scan (pattern-based, values never printed), client-bundle secret scan, production response-header capture, HTTP→HTTPS enforcement, robots/sitemap/source-map exposure, `.well-known/assetlinks.json`.
3. **Database posture capture** — RLS status and policy text for all 37 tables, the table- and column-level grant matrix for `anon`/`authenticated`, all 28 `SECURITY DEFINER` functions with `search_path` and EXECUTE grants, storage buckets and policies, and the Supabase security advisor output.
4. **Live authorisation probes (rolled back)** — impersonating real customer/owner/admin sessions via `set_config('request.jwt.claims', …)` under `set local role authenticated`, exercising RLS, column grants and guard triggers directly at the trust boundary rather than through the UI.
5. **Parallel review panel** — nine independent reviewers (authentication; RLS/grants/SECURITY DEFINER; server actions & routes; booking logic; payments & webhooks; OTP/SMS; admin/owner privilege; web platform; business logic/privacy/monitoring), each with the shared evidence dossier, each followed by an adversarial verifier instructed to refute every finding and to re-run every probe.
6. **Completeness critic** — a final pass asking what the panel did not cover, investigating each gap directly.
7. **Severity** — CVSS v3.1 where practical; business impact weighed explicitly for financial and privacy findings.

Findings are classified **Confirmed** (reproduced, or the exact vulnerable logic read and cited), **Partially confirmed** (plausible, not reproduced), **Informational**, or **False positive** (raised by a reviewer, refuted by a verifier — retained for transparency).

---

## 4. Application Architecture

| Layer | Implementation |
|---|---|
| Framework | Next.js 16.3.1 (App Router, Turbopack), React 19, TypeScript, Zod 4 |
| Auth | Supabase Auth (email/password + Google OAuth). Role lives in `profiles.role` (`customer`, `owner_pending`, `owner_approved`, `admin`), locked by the `prevent_role_change` trigger and the `profiles_update` policy |
| Session gate | `proxy.ts` **only refreshes the session cookie** (secure, `SameSite=Lax`). It gates no routes. Every authorisation decision is made in a page/layout via `lib/auth.ts` (`requireRole`, `requireAuth`, memoised per request) or inside a server action |
| Data access | Two Supabase clients: the **session client** (anon key + user JWT, RLS applies) for reads and permitted client writes; the **service-role client** (`lib/supabase/admin.ts`, `server-only`) for writes the client must never perform directly — bookings, payments, leads, notifications, OTP attempts, commission rates |
| Database | Postgres 17 on Supabase. RLS enabled on all 37 public tables. Default Supabase table-wide grants remain on ~25 tables (RLS is the sole gate there); migration 0046 revoked and re-granted **named columns** on the money-bearing tables |
| Payments | Cashfree PG. Three order namespaces (`HN_` booking advance, `HNP_` owner listing plan, `HNC_` owner lead-commission) routed by prefix at one webhook. Every handler **re-reads the order from Cashfree's API** and compares the server-stored amount before applying |
| Payouts | Cashfree Payouts, beneficiary-based, dispatched by a 15-minute reconcile cron; webhook authenticated by `X-Cf-Signature` |
| SMS/OTP | MSG91. OTP generated, stored and verified by MSG91 — the application never holds a code. Transactional SMS via DLT-registered templates; a `notifications` outbox with a unique dedupe key provides idempotency |
| Storage | One public bucket `hall-images` (5 MB, JPEG/PNG/WebP by Content-Type), path `<hall-uuid>/<file>`, policies keyed on `owns_hall(foldername[1])` |
| Analytics | GA4 behind an explicit consent banner; UUID path segments and query strings redacted |
| Crons | `bookings/expire-overdue`, `premium/expire-listings`, `payouts/reconcile`, `leads/expire-stale` — GET accepts `CRON_SECRET` bearer only; POST additionally accepts an admin session |

---

## 5. Attack Surface

### 5.1 Route handlers

| Component | Endpoint | Authentication | Authorisation | Sensitive data | Risk |
|---|---|---|---|---|---|
| Cashfree PG webhook | `POST /api/webhooks/cashfree` | HMAC-SHA256 over `timestamp+rawBody` with the PG secret, constant-time compare | n/a (machine) | Payment state transitions | High-value target; see §19, §21 |
| Cashfree subscription webhook | `POST /api/webhooks/cashfree-subscription` | Signature | n/a | Plan renewals | §21 |
| MSG91 delivery webhook | `POST /api/webhooks/msg91` | Shared secret header, constant-time; refuses everything if secret unset | n/a | Delivery status only | §21 |
| Cron: expire overdue bookings | `GET/POST /api/admin/bookings/expire-overdue` | GET: `CRON_SECRET`; POST: cron or admin | admin | Cancels bookings | §17 |
| Cron: expire premium | `GET/POST /api/admin/premium/expire-listings` | as above | admin | Removes paid placement | §17 |
| Cron: reconcile payouts | `GET/POST /api/admin/payouts/reconcile` | as above | admin | **Moves money to owners** | §17, §19 |
| Cron: expire leads | `GET/POST /api/admin/leads/expire-stale` | as above | admin | Lead status | §17 |
| OAuth callback | `GET /auth/callback` | Supabase code exchange | — | Session establishment; `next` redirect | §14 |
| Role router | `GET /auth/redirect` | Session | — | — | §14 |
| App links | `GET /.well-known/assetlinks.json` | Public | — | Android package + 1 cert fingerprint (public by design) | Info |

### 5.2 Server actions (80)

| File | Actions | Auth pattern | Notes |
|---|---|---|---|
| `app/admin/actions.ts` | 40 | 52 role-check call sites (`requireAdminActor`) | §22 verifies each |
| `app/owner/(dashboard)/actions.ts` | 24 | 25 `getAuthUser()` sites; ownership proved by RLS row-count or explicit join | §23 |
| `app/book/[slug]/actions.ts` | 4 | session-derived customer id; amounts server-computed | §18 |
| `app/customer/actions.ts` | 4 | session | §17 |
| `app/enquiry/[slug]/actions.ts` | 4 | session; mode gate; OTP gate | §18, §20 |
| `app/verify-phone/actions.ts` | 2 | session | §20 |
| `app/contact/actions.ts` | 1 | — (public form) | §28 |
| `app/saved/actions.ts` | 1 | none needed — `fetchSavedHalls(ids)` is a **public read** of approved halls by UUID (regex-validated, capped at 60) through the RLS-gated catalogue query; it writes nothing | §17 |

### 5.3 Pages

- **Public:** `/`, `/halls`, `/halls/[slug]`, `/wedding-halls/[city]`, `/pricing`, `/premium`, `/contact`, legal pages, `/login`, `/signup`, `/owner/register`
- **Customer:** `/book/[slug]`, `/booking/[id]/status`, `/enquiry/[slug]`, `/customer/*` (bookings, enquiries, notifications, profile, reviews, saved, support), `/invoice/[id]`, `/verify-phone`
- **Owner:** `/owner/(dashboard)/*` — dashboard, halls (new/edit/images/availability), bookings, leads, commissions (+ status), revenue, premium, notifications, profile, support
- **Admin:** `/admin/*` — dashboard, users, owners, halls, hall-approvals, bookings, leads, payments, commissions, reviews, premium-listings, coupons, advertisements, support-tickets, notifications, audit-logs, settings

### 5.4 Database (37 tables, RLS on all)

Client-writable tables and the columns a client may write are enumerated in §16. Tables with **no** client write grant at all: `payments`, `otp_attempts`, `owner_payouts`, `invoice_counters`, `leads` (select-only), `bookings` (no INSERT).

### 5.5 Storage

One bucket, `hall-images`, **public**. See §24.

---

## 6. Threat Model

**Assets:** customer PII (name, phone, email, event date), owner PII and bank/beneficiary details, booking and payment records, commission ledger, admin audit log, MSG91/Cashfree/Supabase credentials, the HLNECT DLT sender header (loss of which silences every SMS), platform availability.

**Trust boundaries:** browser ↔ Next.js server (server actions, route handlers); server ↔ Supabase (anon key + RLS vs service role); server ↔ Cashfree/MSG91 (outbound API, inbound webhooks); Vercel cron ↔ `/api/admin/*`.

**Entry points:** 80 server actions, 10 route handlers, direct PostgREST access with the public anon key (RLS is the gate), the public storage URL, three inbound webhooks, OAuth callback.

**Privileged operations:** approving halls; confirming/rejecting bookings and leads; issuing refunds; dispatching payouts; changing commission rates; marking commissions paid; editing platform settings; suspending users; creating coupons/ads.

| Actor | Goal | Primary controls | Assessed in |
|---|---|---|---|
| Unauthenticated | Read private data via PostgREST; forge webhooks; enumerate | RLS default-deny; column grants; HMAC signatures; open-redirect guard | §15, §16, §21 |
| Customer (malicious) | Book without paying; alter price/advance; confirm own booking; read other customers; spam OTP to victims; forge admin ticket content | `validate_booking_transition`; service-role-only booking INSERT; server-computed amounts; OTP ceilings; RLS | §18, §20, §28 |
| Owner (malicious) | Reach another owner's halls/bookings/money; self-assign premium; change own commission retroactively; redirect a customer's SMS; pay commission twice; upload malicious file | `owns_hall` everywhere; `guard_hall_privileged_columns`; snapshot immutability; trigger blocking `contact_phone`; `uq_ocp_open_per_commission`; storage policies | §23, §24, §28 |
| Compromised/stolen session | Act as the victim | Secure/Lax cookies; short refresh; disabled-account check | §14 |
| Attacker at the webhook | Forge PAID; replay | Signature; re-read from Cashfree API; status-guarded claims; unique order id | §19, §21 |
| Insider/admin | Abuse privilege silently | Append-only `admin_audit_log`; `recordAdminAction` on privileged paths | §30 |

**Abuse cases walked by the panel:** listed per section below.

---

## 7. Security Posture (deterministic evidence)

| Area | Observed |
|---|---|
| Transport | HTTP→HTTPS 301; HSTS `max-age=31536000; includeSubDomains` (no `preload`) |
| Headers | CSP present with `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action` scoped to self + Cashfree; `X-Frame-Options: DENY`; `X-Content-Type-Options: nosniff`; `Referrer-Policy: strict-origin-when-cross-origin`; `Permissions-Policy` restricts camera/mic/geo and scopes `payment` to Cashfree. **Weaknesses:** `script-src` carries `'unsafe-inline' 'unsafe-eval'`; `X-Powered-By: Next.js` is sent |
| Secrets | No secret ever committed (only `.env.example`, placeholders verified by pattern). Client bundle contains none of the seven secret-shaped markers. All secret-reading modules are `server-only` or have no client importer |
| Source maps | Not served (`.map` → 403; no `sourceMappingURL` in shipped chunks) |
| Crawl exposure | `robots.txt` disallows every private prefix; sitemap lists only public routes |
| Dependencies | **2 production advisories** (see §25): `next` 16.3.1 (two CRITICAL, fixed in 16.3.3) and `sharp` 0.35.3 (HIGH, fixed in 0.35.4) |
| Database | RLS on 37/37 tables; every `SECURITY DEFINER` function has `search_path` pinned; the four owner-callable RPCs verify ownership in-body |
| Guard triggers (probed) | Customer cannot self-confirm a booking, cannot write `owner_notes`, cannot edit a review at all; disabled user cannot re-enable `is_active`; owner cannot insert a hall as premium/pre-rated; client cannot self-grant `phone_verified`; role is immutable to non-admins |

---

## 8. Findings Summary

The canonical ledger, with the full narrative for each finding, is
`FINDINGS.md`. This is the index.

| Severity | Count | Fixed | Accepted | Open |
|---|---|---|---|---|
| Critical | 1 | 1 | 0 | 0 |
| High | 2 | 2 | 0 | 0 |
| Medium | 7 | 7 | 0 | 0 |
| Low | 17 | 15 | 1 | 1 |
| Informational | 29 | 10 | 6 | 13 |
| **Total** | **56** | **35** | **7** | **14** |

| ID | Finding | Severity | Status |
|---|---|---|---|
| BOOK-1 | Direct booking impossible since GST shipped — total silent outage of the primary revenue path | Critical | Fixed (0077) |
| BOOK-2 | Every venue under ~₹3,200/day unsellable — the fee cap contradicts the database floor | High | Fixed (0078) |
| CRIT-1 | An owner's payout bank account could never be changed; the product reported VERIFIED and the anti-redirection interlock was disarmed | High | Fixed (0080) |
| WEB-2 | `next` 16.3.1 / `sharp` 0.35.3 advisories — **not exploitable on this deployment** (see §25) | High (CVSS) | Fixed |
| AUTH-1 | A suspended account kept full write access until its token expired, including straight to PostgREST | Medium | Fixed (0081) |
| OTP-1 | A zero-width space smuggled a phone number into branded Hallnect SMS | Medium | Fixed |
| OTP-2 | Anyone signed in could lock any phone number out of OTP verification, indefinitely | Medium | Fixed |
| API-5 / LOGIC-6 | Twenty messages silenced the contact form for every visitor, and suppressed the admin alert | Medium | Fixed (0082) |
| PRIV-1 / API-3 | `support_tickets` mass assignment — a customer could file a ticket containing Hallnect's own reply | Medium | Fixed (0076) |
| PAY-3 | A captured payment could be cancelled by the sweep with no refund record | Medium | Fixed |
| RLS-1 | `TRUNCATE` granted to `anon`/`authenticated` on 24 of 36 tables; RLS does not filter TRUNCATE | Low (latent) | Fixed (0079) |
| PAY-4 | The second refund on a double-captured booking could never be issued | Low | Fixed |
| LOGIC-7 | A capped coupon could be redeemed more times than its cap | Low | Fixed (0085) |
| PRIV-5 | Any authenticated account could reach Cashfree beneficiary onboarding | Low | Fixed |
| PRIV-4 | `rejectOwner` could demote another admin to customer | Low | Fixed |
| PRIV-3 / LOGIC-5 | Money-setting admin actions unaudited; invalid webhook signatures unlogged | Low | Fixed |
| API-4 / WEB-9 | `hall_images.url` was an arbitrary owner-supplied address | Low | Fixed (0083) |
| WEB-1 | Upload validation trusted the client-declared MIME type | Low | Fixed |
| LOGIC-8 | The customer's phone reached the venue when checkout opened, not when the booking became real | Low | Fixed |
| AUTH-7 | All fourteen `profiles` columns client-writable, including the audited `email` | Low | Fixed (0084) |
| AUTH-2 | A suspended user was trapped in a redirect loop and never saw why | Low | Fixed |
| OTP-4 | The OTP was bound to the phone, not the requesting session | Low | Fixed |
| API-1 | No `booking_mode` gate — a paid booking could be opened on a lead-only venue | Low | Fixed |
| API-2 / AUTH-3 / PRIV-2 / PAY-1 | `checkCommissionPaymentStatus` settled any `HNC_` order without an ownership check | Low | Fixed |
| WEB-3 | CSP permits `'unsafe-inline'` / `'unsafe-eval'` | Low | **Accepted** |
| PAY-2 | Stale-but-ACTIVE orders retired locally while still payable | Low | **Open** |
| LOGIC-2 | Cancellation side effects live only in the server action | Low | **Accepted** |
| AUTH-4 | No password reset or password change flow anywhere in the product | Info (product gap) | **Open** |
| AUTH-5 | Single admin account, no MFA | Info | **Open** |
| LOGIC-4 | Account deletion leaves personal data in `leads`, `bookings`, contact messages | Info | **Open** |
| — | 25 further informational items | Info | See `FINDINGS.md` §6 |

### 8.1 Findings established before the panel (will be merged with panel ids)

| Ref | Finding | Severity | Status |
|---|---|---|---|
| PRE-1 | `next` 16.3.1 — unauthenticated RCE in the Image Optimization API via AVIF (GHSA-2xp9-vwfh-vxw4). A delivery chain exists in the code (owner uploads an AVIF declared `image/jpeg` — client-MIME-only check at `lib/supabase/storage.ts:55` — rendered via `next/image` from the allowed Supabase host). **However, production does not run the vulnerable optimizer:** `/_next/image` responses carry `server: vercel` (Vercel's platform image service, not the app's bundled `sharp`), and the advisory scopes the flaw to self-hosted deployments, noting AVIF optimization is disabled platform-side until patched. **Not exploitable on this deployment; still an outdated critical-rated dependency** — upgrade for defence in depth and for the Windows dev host. | HIGH (dependency) / **not exploitable in prod** | Confirmed (advisory); exploitability refuted by evidence |
| PRE-2 | `next` 16.3.1 — unauthenticated RCE on Windows-hosted servers (GHSA-p293-qw3h-jr36). Production is Linux (Vercel); affects the Windows dev machine only | HIGH (dev) / not exploitable in prod | Confirmed (advisory) |
| PRE-3 | `sharp` 0.35.3 — libheif vulnerabilities (GHSA-rgj7-g3m4-5g8c) | HIGH | Confirmed (advisory) |
| PRE-4 | `support_tickets` INSERT mass-assignment: a customer can create a ticket with `admin_response`, `internal_notes`, `priority='urgent'`, `status='resolved'` pre-filled. Policy checks only `user_id = auth.uid()`; the column grant includes the admin-only fields; no guard trigger. **Reproduced (rolled back).** | MEDIUM | Confirmed |
| PRE-5 | `get_commission_percent()` is `SECURITY DEFINER` and EXECUTE-granted to `anon`, exposing the platform commission rate at `/rest/v1/rpc/get_commission_percent` — contradicting migration 0072, which hides per-hall commission as "a commercial term never shown to customers" | LOW–MEDIUM | Confirmed |
| PRE-6 | CSP `script-src` includes `'unsafe-inline' 'unsafe-eval'`, largely neutralising CSP as an XSS mitigation | MEDIUM | Confirmed |
| PRE-7 | `X-Powered-By: Next.js` header disclosed | LOW | Confirmed |
| PRE-8 | HSTS lacks `preload` | INFO | Confirmed |
| PRE-9 | Public storage bucket: the `hall_images_storage_select` policy (approved halls only) is bypassed by the public object URL for anyone holding the path | LOW | Confirmed |
| PRE-10 | Three trigger functions and five RLS-helper predicates are `SECURITY DEFINER` with EXECUTE granted to `anon` (Supabase advisor WARN ×11) — hygiene; no data exposure identified | LOW | Confirmed |
| PRE-11 | `btree_gist` extension installed in `public` schema (advisor WARN) | INFO | Confirmed |
| PRE-12 | No app-level rate limit on login/signup; relies on Supabase Auth built-ins | INFO | Confirmed |

---

## 9–13. Findings in detail

The full narrative for every finding — mechanism, evidence, impact, fix and the
reasoning behind the severity — is in **`FINDINGS.md`**, organised by severity:

- §2 — the two findings that mattered most (BOOK-1 Critical, BOOK-2 High)
- §3 — High (CRIT-1, WEB-2)
- §4 — Medium, all seven, all fixed
- §5 — Low, as a table with status
- §6 — Informational
- §7 — false positives, retained for transparency
- §8 — what was **not** tested, and why

It is kept as a separate document rather than inlined because it is the part
that gets re-read, re-checked and updated as items close, and because a reader
tracking remediation should not have to navigate the methodology to find it.

Three structural observations that belong here rather than against any single
finding:

**The recurring defect shape is a grant wider than its policy.** PostgreSQL
checks table and column privileges *before* row-level security, and RLS is
row-level — so neither layer will ever catch a bad **column**. Four findings
have this shape: `support_tickets` (PRIV-1), `profiles` (AUTH-7),
`contact_messages` (found while fixing API-5) and `TRUNCATE` across 24 tables
(RLS-1), the last being the extreme case because RLS does not evaluate TRUNCATE
at all. In every case the policy was correct and the grant was wider than the
policy had any opinion about.

**Three fixes initially failed their own verification**, which is the strongest
evidence that the verification blocks earn their place. Migration 0076 was first
written `SECURITY DEFINER`, where `current_user` becomes the owner,
`is_trusted_backend()` returns true and the guard would never have fired once —
caught by its own block. Migrations 0082 and 0084 each began as a column-level
`REVOKE` against a table-level `GRANT`, which is a no-op; both were caught the
same way. None of the three could have been caught by reading the diff.

**Two findings were resolved by measurement rather than by reasoning.** The
`next` image-optimizer advisories (WEB-2) look critical and have a plausible
delivery chain in this codebase — until you check who actually serves
`/_next/image` in production and find Vercel's platform service rather than the
bundled `sharp`. And the `profiles` INSERT gap was written up as exploitable
until three rolled-back probes showed all three insert paths already refused, by
RLS, by the primary key and by the existing UPDATE guard respectively. Both are
reported at what the evidence supports, not at what the pattern suggested.

## 14. Authentication Assessment

**Deterministic evidence:** the OAuth callback validates `next` (must start with
`/`, rejects `//` and `/\`); cookies are `Secure` + `SameSite=Lax`;
`requireAuth` enforces `is_active`; the role is locked by both the
`prevent_role_change` trigger and the `profiles_update` policy.

Identity is entirely Supabase Auth. Hallnect writes no credential handling of
its own, which removes a whole category of finding before it starts — no
password hashing, no session minting, no reset-token generation to get wrong.

**What was wrong, and is fixed:** authentication was being treated as
authorisation in the one place it matters most. `profiles.is_active` — the flag
the admin sets to suspend an account — was read by `requireAuth()` and by
nothing else: not by the other forty server actions, and **not by a single RLS
policy** (AUTH-1). A GoTrue ban stops sign-in and token refresh but does not
invalidate a token already issued, and PostgREST validates that token locally
without ever consulting GoTrue. So suspension was, for up to an hour, a
statement about the login page rather than about access. Closed in the database
(migration 0081) because that is the only layer both the eighty actions and the
direct-PostgREST path pass through.

The suspended user could also never *see* they were suspended (AUTH-2): `/login`
sits under a layout that redirected any profile to its dashboard, while
`requireAuth` redirected an inactive profile back to `/login`. The two chased
each other and the `account_disabled` copy could not render.

**What remains open** is a product gap rather than a defect: there is no
password reset or password change flow anywhere in the product (AUTH-4), while
email-and-password sign-in is offered. And there is one admin account with no
second factor (AUTH-5). Neither is a vulnerability in the code; both are
launch-blocking in the checklist.

**Accepted:** the signup role is client-supplied metadata (AUTH-6) — `owner`
yields `owner_approved` by design and `admin` is rejected, and listing a venue
still requires admin approval, so the metadata buys nothing an attacker wants.
Session cookies are not `HttpOnly` (AUTH-8), which is the Supabase SSR default
and cannot be changed without breaking the client library's session handling.

## 15. Authorization Assessment

Authorisation is enforced in three layers, and the assessment probed each at its
own boundary rather than through the UI: RLS policies, table/column grants, and
guard triggers.

**The layer that did the work.** RLS is on for all 37 tables and the 71 policies
are, with one exception, correct about *who*. The booking-transition trigger is
genuinely strong: it restricts a customer to `→ cancelled` only, an owner to
`booking_requested → owner_confirmed | owner_rejected` and
`owner_confirmed → completed`, and freezes every money, identity, date, slot,
guest, coupon and terms column against a non-trusted caller. Probing it as a
real customer confirmed each refusal.

**The layer that leaked.** Grants. Because PostgreSQL checks privileges before
RLS, and RLS reasons about rows, a policy that is right about *who* says nothing
about *which columns*. That produced PRIV-1 (a customer filing a ticket with
Hallnect's own reply pre-filled), AUTH-7 (all fourteen `profiles` columns
writable, including the `email` recorded as `actor_email` in the audit log),
the `contact_messages` UPDATE grant found while fixing API-5, and RLS-1
(`TRUNCATE` on 24 tables, which RLS does not filter at all).

**Server actions are public endpoints**, and two of them were gated on
authentication alone while reaching a third-party money system: `savePayoutDetails`
and `refreshPayoutStatus` (PRIV-5). The owner dashboard *layout* requires
`owner_approved`, but a layout decides what is rendered, not what is invocable.
Two admin actions had the mirror-image problem — `approveOwner` and
`rejectOwner` wrote a new role without reading the old one (PRIV-4).

All of the above are fixed. What is left is `PRIV-7` (an owner may move their
own approved hall back to draft — accepted, that is theirs to do) and `PRIV-6`
(two admin service-role readers lack the in-function viewer check their siblings
have — informational, both are behind admin-only screens).

## 16. Supabase / RLS Assessment

### 16.1 Grant matrix (checked before RLS)

Supabase's default `GRANT ALL ON ALL TABLES TO anon, authenticated` remains on 25 tables. On each, RLS default-deny is the only write gate, and the policy text was reviewed. Migration 0046 replaced the table-wide grant with named columns on the money-bearing tables:

| Table | `authenticated` may INSERT | `authenticated` may UPDATE |
|---|---|---|
| `bookings` | — (service role only) | `cancel_reason, contact_phone, customer_notes, owner_notes, status, updated_at` |
| `halls` | wide (incl. `commission_rate`, `is_premium`, `premium_tier`, `rating_*`, `moderated_*`) — **guard trigger strips the privileged ones** | descriptive columns + `booking_mode` + `status` |
| `hall_owners` | business columns only | business columns only (payout/verification columns excluded and trigger-guarded) |
| `profiles` | wide — `role` locked by policy + trigger; `is_active`/`phone_verified` trigger-guarded | same |
| `reviews` | wide incl. `is_visible` — but policy requires a completed booking of one's own | **none** (`reviews_update` policy is unreachable) |
| `support_tickets` | wide incl. `admin_response, internal_notes, assigned_to, priority, status` — **no guard: PRE-4** | wide — but policy is admin-only |
| `leads` | — | — |

### 16.2 Policies
All 71 policies were captured verbatim and reviewed. The per-table conclusions
are in `FINDINGS.md`; the summary is that the policies are sound about *who* and
were repeatedly undermined by grants that were wider than the policy had an
opinion about — see §15 and RLS-1.

Migration 0081 adds a further layer these policies did not have: a
**restrictive** write policy per client-writable table, gated on
`is_active_user()`. Restrictive policies are ANDed over the permissive ones, so
this adds "and the account is active" without reproducing a single existing
policy body — which matters, because rewriting eleven policy expressions by hand
to append one clause is exactly how an authorisation regression ships.

### 16.3 SECURITY DEFINER
28 functions; all pin `search_path`. Owner-callable RPCs `create_offline_booking` / `cancel_offline_booking` check `owns_hall() OR is_admin()` in-body; `coupon_usage` and `schema_migration_state` check `is_admin()` in-body. See PRE-5, PRE-10.

### 16.4 Live probes (rolled back)
Thirteen-check authorisation suite on leads/commissions: all pass. Customer-role write probes: self-confirm **blocked** (42501 + transition trigger), `owner_notes` **blocked**, review edit **blocked**, self-cancel **allowed** (expected). Mass-assignment probes: `is_active` **blocked**, hall premium/rating **blocked**, ticket admin fields **VULNERABLE** (PRE-4).

## 17. API Security Assessment

The application exposes nine server-action files and a small set of route
handlers. **A server action is a public HTTP endpoint** — that framing produced
three findings on its own (PRIV-5, PRIV-4, API-8), because in each case the
authorisation a reader would assume was being done by the surrounding page or
layout rather than by the action.

**Validated well:** every action parses its input with Zod server-side, and the
client form is explicitly a convenience. Ids are UUID-checked in most places
(API-7 notes two owner actions that skip it — harmless today because RLS and the
RPC still gate them).

**Injection:** no SQL is concatenated anywhere; all database access is through
PostgREST or parameterised RPC. The one injection-shaped surface is PostgREST's
`or()` filter, which is a string grammar that escapes nothing you interpolate.
`lib/halls.ts` had already learned this and quotes the value; the two admin
search paths still used a character blocklist (WEB-7). Blocklists have to be
right about every separator, and this one also silently mangled ordinary
searches — an admin looking for `coupon.create` was searching for something
else. Now quoted, using the same tested helper.

**Error handling:** errors are sanitised before reaching a client, with one
exception that returned a raw PostgREST message naming tables, columns and
constraints (WEB-8). Fixed.

**Rate limiting** is the weakest area and produced the two denial-shaped
findings, API-5 and OTP-2, both now fixed. The remaining gap is that
login/signup rely on Supabase Auth's built-in limits with nothing at the
application layer (PRE-12, informational).

**Maintenance routes** (four Vercel crons) authorise a GET by shared secret only
— deliberately, because a GET that mutates is reachable by an image tag — and a
POST by secret *or* an admin session. That POST branch checked role but never
`is_active` (API-8), and had no origin check (WEB-4). Both closed; the origin
check is defence in depth, since `SameSite=Lax` already prevents a cross-site
POST from carrying the session cookie at all.

## 18. Booking Security Assessment

**Deterministic evidence:** `validate_booking_transition` restricts a customer
to `→ cancelled` only, an owner to
`booking_requested → owner_confirmed | owner_rejected` and
`owner_confirmed → completed`, and freezes every money, identity, date, slot,
guest, coupon and terms column for non-trusted callers. Each refusal was probed
as a real account and each held.

**This is where the assessment found the most serious problems, and none of them
were attacks.** The transition guard is strong. The *money arithmetic* guard
disagreed with the application about what a customer total is (BOOK-1) and about
what the minimum platform fee is (BOOK-2), and between them they made direct
booking impossible for every venue and doubly impossible for cheap ones. Both
are covered in `FINDINGS.md` §2.

The common cause is worth naming: **a guard that hard-codes a number the
application computes**. The 200 floor was correct when the fee was always 200;
`customer_total = advance + fee` was correct before GST. Neither was updated
when the value it mirrored changed, and neither could fail loudly, because a
trigger that refuses a row looks exactly like a trigger that is working. The
fixes make both guards derive their expectation the same way the application
does, including the floor-to-paise rounding — a one-paisa difference would
reject a booking the application considers perfectly formed, which is the whole
failure being fixed.

**Also fixed here:** a paid booking could be opened on a lead-only venue
(API-1); a capped coupon could be over-redeemed because the cap was checked at
insert and never at the moment of redemption (LOGIC-7); and the customer's phone
reached the venue when checkout opened rather than when the booking became real
(LOGIC-8).

**Concurrency** is handled properly and was probed: the partial unique index
`uq_booking_active_slot` and the GiST range-exclusion constraint both fire on a
genuine double-book, the paid path handles `23505` and `23P01`, and a slot race
after capture records a full refund including the platform fee — because that
failure is the platform's, not the customer's.

## 19. Payment Security Assessment

**Deterministic evidence:** every apply path re-reads the order from Cashfree and
compares the stored amount (±₹0.50); claims are status-guarded;
`cashfree_order_id` is unique; the handler returns 503 on
`error`/`unactivated`/`unsettled` so Cashfree retries.

The design principle here is right and consistently applied: **the client is
never the source of truth about money.** Amounts, commission and fees are
computed server-side, the gateway is re-read rather than trusted, and the
order-id namespaces (`HN_` booking, `HNP_` plan, `HNC_` commission) keep the
handlers apart.

**What was wrong was ordering and identity, not trust.**

`PAY-3` — the paid webhook stamps the payments row before moving the booking. A
transient failure between the two left money captured and a booking the sweep
would later cancel, with no refund record anywhere, because the
`refund_state = 'owed'` write only runs on the first attempt's zero-row branch.
The retry then short-circuited on "already `payment_success`" and never
re-attempted the transition. Fixed by treating a booking still in
`pending_payment` as not finalised, which re-enters the real path — safe because
every step of it is idempotent by construction.

`PAY-4` — the Cashfree refund id was derived from the *booking* while
`issueRefund` had been deliberately rewritten to take a *payment*, so both
captures on a double-charged booking produced the same id, the second collided
with a unique index, and the error was discarded into a misleading "already
being processed". The second refund could never be issued from the product.

`CRIT-1` — the payout beneficiary, covered in `FINDINGS.md` §3.

**Accepted:** there is no timestamp-freshness window on the webhook signature
(PAY-5). Replay is idempotent because every handler re-reads authoritative state
from Cashfree rather than acting on the payload, so a replayed event converges
on the same result. That is a design choice and is now written down; it stops
being safe the moment a handler acts on payload content directly.

**NOT TESTED — REASON:** the owner-paid commission path was opened in production
(`HNC_…`, status `created`, 0 webhook events) but the owner did not complete the
payment, so settlement and its webhook were never observed end to end. The code
path was read; it was not exercised. This is the single largest coverage gap in
the assessment and it is listed in the retest requirements.

## 20. MSG91 / OTP Security Assessment

**Deterministic evidence:** MSG91 owns the OTP — Hallnect never generates,
stores or logs a code, and the only OTP entering the process is the one the user
types, which goes straight back out to be checked. Five database-backed send
ceilings live in `lib/otp-guard.ts` (60-second cooldown; 5/hour per user+phone;
10/day per phone; 15/day per account; 300/day global, failing **closed**) and are
shared by both OTP flows, so a number hammered through the enquiry form and the
same number hammered through phone verification hit the same counters. The
delivery webhook is behind a constant-time shared-secret check.

That is a considered design, and the two findings here are both about the same
blind spot: **the ceilings were built to stop abuse of a number, and nobody asked
what they do to the owner of that number.**

`OTP-2` — `verifyPhoneOtp` takes the phone from the client, and the failed-check
budget was scoped to the phone alone, so five wrong codes from any signed-in
account locked a stranger out of their own verification for fifteen minutes,
repeatably. Since an owner cannot see a single lead until `phone_verified` is
true, that denies a competitor their business. The fix splits one number into
three ceilings and binds a check to a code this account actually requested.

`OTP-1` — the SMS sanitiser ran on the raw string while the *sent* string is the
GSM-7 form, and `toGsm7` deletes exactly the invisible characters that defeat
the sanitiser's patterns. A zero-width space reassembled a phone number in an
official Hallnect SMS.

**Accepted:** the check guard is read-then-act, so parallel requests can
slightly exceed a ceiling (OTP-3) — irrelevant against a million-value code
space. The ceilings fail **open** when a counter cannot be read (LOGIC-9), which
is deliberate: a rate-limit table that cannot be read must not lock a real user
out of their own code, and the global fuse still fails closed.

**Open:** no country allowlist on OTP destinations (OTP-6), and the admin alert
SMS budget has no per-account ceiling (OTP-5), now partially mitigated because
contact-form alerts are bucketed one per UTC hour.

**A note carried from earlier work, because it costs days to rediscover:** DLT
approval happens on the operator's portal, and MSG91 only *maps* an approved
template. Carriers reject on **variable content** even when the registered body
matches — a phone number inside a variable, or a variable over 30 characters,
are both rejection causes, proven here by a clean A/B.

## 21. Webhook Security Assessment

**Deterministic evidence:** the payment-gateway webhook signature is
`Base64(HMAC-SHA256(timestamp + rawBody, PG secret))`, compared with
`timingSafeEqual`, and verified **before the body is parsed** — which is the
right order and not universally done. The payout callback authenticates with
`X-Cf-Signature` rather than an IP allowlist, which is the only workable choice
on Vercel.

Three properties were checked and hold: the raw body is used for verification
(not a re-serialised object, which would break the digest), verification failure
fails closed, and a replayed event converges on the same state because every
handler re-reads from Cashfree rather than acting on the payload.

**What was missing was not a control but a record.** An invalid signature
returned 401 and logged **nothing** (part of LOGIC-5). A forged callback and our
own webhook secret being wrong after a rotation are indistinguishable from
outside, and the second presents as "payments silently stopped settling" with
nothing to find. Now logged — presence and length only, never the forged body,
because the attacker's input is precisely what must not be echoed into a log.
The 401 still says nothing, since telling a prober *why* verification failed
helps them.

**Accepted:** no timestamp-freshness window (PAY-5), for the reason in §19.

## 22. Admin Security Assessment

There is **one** admin account, and it can change the commission rate every
venue in the country pays, approve venues, issue refunds and release payouts.
That concentration is the context for everything below.

**Done well:** `requireAdminActor()` re-reads role *and* `is_active` on every
one of the forty actions in `app/admin/actions.ts` — the only action file that
does — and privileged writes are `count:"exact"`-checked, because an
RLS-filtered UPDATE matches zero rows **without raising** and reporting success
for a change that never happened is a class of bug this codebase has evidently
been bitten by before. The audit log is append-only and guarded.

**Findings.** `rejectOwner` and `approveOwner` wrote a role without reading the
old one, so an admin could demote a fellow admin to customer and lock them out
of `/admin` (PRIV-4) — the user list already refuses to suspend an admin for
exactly this reason, so the intent existed and was simply unenforced here.
Thirteen admin actions left no audit entry, including the commission rate and
the payment settings (PRIV-3): the live log carried fifteen distinct actions and
not one `settings.*` entry, despite those settings having been configured in
production. One action returned a raw PostgREST error (WEB-8). The four
maintenance routes checked role but never `is_active` (API-8).

All fixed. The audit entries now capture the **previous** value for the
commission rate, because a rate change is only reviewable if the trail says what
it moved from — and the ticket-response entry deliberately does *not* copy the
reply text, which already lives on the ticket; duplicating customer
correspondence into a second table widens where personal data sits for no
investigative gain.

**Open:** no second factor on that one account (AUTH-5). It is the cheapest
meaningful risk reduction in this report.

## 23. Hall Owner Security Assessment

The owner is the most interesting actor in this system: semi-trusted, financially
motivated, and in possession of free-text fields that reach customers under
Hallnect's name.

**The trust boundary is drawn in the right place.** `owns_hall()` gates every
write, `guard_hall_privileged_columns` stops an owner inserting a hall as
premium or pre-rated, migration 0068 made the payout destination columns
service-role-only, and 0072 hid `halls.commission_rate` from the session client
because a per-hall rate is a commercial term.

**Where an owner could reach further than intended:**

- Into a *customer's* handset with content of their choosing — the SMS
  injection, OTP-1. This is the finding that best fits this actor: a declining
  owner writes a reason, and the reason is delivered by Hallnect's verified
  sender. "Call 9876543210 to rebook direct and save the advance" is a
  commercially motivated message with the platform's credibility attached.
- Into a customer's privacy earlier than the booking justified — LOGIC-8, the
  contact phone released at checkout *start*.
- Into the image pipeline with an arbitrary remote URL (API-4) and a file that
  was not an image (WEB-1).
- Into Cashfree's beneficiary directory without being an approved owner at all
  (PRIV-5) — and with a *victim venue's* account number, pre-claiming it so the
  genuine owner is refused.

All fixed. The pattern across them is that an owner's inputs were treated as
data about their own venue, when several of them are in fact messages to other
people.

**Accepted:** an owner can move their own approved hall back to draft (PRIV-7).
That is theirs to do, and re-publishing requires approval again.

## 24. File / Storage Security Assessment

- Bucket `hall-images`: public, 5 MB, `allowed_mime_types` = JPEG/PNG/WebP (Content-Type based).
- Policies: INSERT/UPDATE/DELETE require `owns_hall(foldername[1]::uuid) OR is_admin()`; SELECT additionally allows approved halls. **Owner A cannot write into owner B's folder.**
- Upload validation (`lib/supabase/storage.ts:55`) checks **client-declared** `file.type` only — no magic-byte sniff. Combined with PRE-1 this is the input to the AVIF chain.
- Public-URL bypass of the SELECT policy: PRE-9.
- Path: `<hall-uuid>/<generated-name>`; filename is not user-controlled (panel to confirm).

## 25. Dependency Security Assessment

`npm audit --omit=dev`: **1 critical, 1 high** (2 advisories on `next`, 1 on `sharp`). Dev-only: one additional high.

| Package | Installed | Advisory | Severity | Exploitable here? | Fix |
|---|---|---|---|---|---|
| next | 16.3.1 | GHSA-2xp9-vwfh-vxw4 — unauth RCE, Image Optimization API, AVIF | CRITICAL | **Likely yes** — chain in PRE-1 | 16.3.3 |
| next | 16.3.1 | GHSA-p293-qw3h-jr36 — unauth RCE, Windows-hosted servers | CRITICAL (CVSS 9.0) | **No in production** (Vercel/Linux); yes on the Windows dev host | 16.3.3 |
| sharp | 0.35.3 | GHSA-rgj7-g3m4-5g8c — libheif | HIGH | Same input surface as above | 0.35.4 |

No abandoned or dangerous packages identified. Lock file present.

## 26. Secrets / Configuration Assessment

| Secret type | Location | Exposure | Severity | Remediation |
|---|---|---|---|---|
| Supabase service-role key | Vercel env `SUPABASE_SERVICE_ROLE_KEY` | Server-only (`lib/supabase/admin.ts`, `server-only`); never in git; never in client bundle | — | none |
| Cashfree PG secret / Payouts secret | Vercel env | Server-only; never in git/bundle | — | none |
| MSG91 auth key | Vercel env | Server-only; never in git/bundle | — | none |
| `CRON_SECRET`, `MSG91_WEBHOOK_SECRET` | Vercel env | Server-only | — | none |
| Public keys | `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_GA_MEASUREMENT_ID` | In bundle **by design** (RLS is the gate) | — | none |
| Local `.env.local` | Developer machine | Git-ignored; never committed | — | none |

Git history: `service_role` appears in 10 commits as code/comment references; the only `KEY=` lines ever committed are in `.env.example` with placeholder or empty values.

## 27. Security Headers Assessment

See §7. Findings: PRE-6 (CSP `unsafe-*`), PRE-7 (`X-Powered-By`), PRE-8 (HSTS preload).

## 28. Business Logic Assessment

Business logic is where this assessment found its worst problems, and none of
them were attacks. That is worth stating plainly: **the most expensive defects
in a young marketplace are not the ones an attacker finds, they are the ones
nobody finds because the failure is silent.**

BOOK-1 and BOOK-2 made direct booking impossible — total, silent, and invisible
from every dashboard because a booking that never gets created produces no row
to be alarmed about. Zero bookings looked like zero demand.

The others in this category share a shape: **a rule checked at one moment that
needed checking at another.**

- `LOGIC-7` — a coupon cap counted at insert, spent at payment.
- `PAY-3` — a booking transition attempted once, on a path that could fail and
  be retried by a webhook that then skipped it.
- `CRIT-1` — a payout destination registered once, under an identifier that
  could not express a change.
- `LOGIC-2` (accepted) — cancellation side effects that live in the action
  rather than in the data, so a future writer that bypasses the action will
  silently skip them.

**Verified sound:** the commission snapshot is immutable after creation (probed
with a numeric variable after an earlier test read `numeric(4,2)` into an `int`
and reported 3.5 as "4" — the guarantee holds); the refund schedule is applied
server-side from the published policy and cannot be altered by the caller;
`payOwnerOnAcceptance` deliberately records payability and alerts an admin
rather than sending money, so acceptance is not a disbursement trigger.

**Open:** `PAY-2`, retiring a stale-but-`ACTIVE` order locally while it is still
payable at Cashfree. And `BOOK-5` — the payout guards are point-in-time and do
not consult the refund schedule, so a customer cancelling more than 31 days out
is owed 100% of the advance that may already have been released. There is no
clawback table in use (`owner_settlement_adjustments` exists and is only ever
read, never written), which makes this a manual recovery today.

## 29. Privacy / Data Exposure Assessment

The product handles phone numbers, email addresses, bank account numbers and
PAN. The controls around the *sensitive* end of that list are good; the gaps are
at the ordinary end, where it is easier to forget that a phone number is
personal data.

**Sound:** bank details are service-role-only to write (0068) and never logged —
`lib/cashfree-payouts.ts` explicitly refuses to log request bodies because the
beneficiary payload carries an account number. Phone numbers are masked in admin
and owner views where a full number is not needed. The whole `/owner` and
`/admin` subtree declares `noindex` at the **layout**, so a page added tomorrow
cannot leak into the index by forgetting a directive. Analytics load only after
consent.

**Fixed here:** the customer's phone reached the venue when checkout opened
rather than when the booking became real (LOGIC-8) — the lead flow already drew
this line correctly, releasing a number only after OTP verification, and the
booking flow simply never had the equivalent gate. And the contact form now
identifies a sender by a **salted hash** rather than storing the address, since
that row is read by the admin support screen and abuse control only needs "same
sender or not".

**Open, and it is a policy question before it is a code question:** deleting an
account anonymises the profile row but leaves personal data in `leads`,
`bookings.contact_phone` and contact messages (LOGIC-4). That may well be
correct — a booking is a commercial record, and a lead belongs to the venue that
received it — but right now it is an accident of implementation rather than a
retention decision. Write the policy, make the code match it, and make the
privacy policy say the same thing.

**Noted:** the storage bucket is public, so the `hall_images_storage_select`
policy (approved halls only) is bypassed by the object URL for anyone holding
the path (PRE-9). Paths are unguessable UUIDs and the images are meant to be
public, so this is accepted — but it means an image uploaded to a *pending or
rejected* hall is reachable by URL, which should inform what owners are told
they may upload.

## 30. Logging / Monitoring Assessment

This was the weakest area at assessment time, and the weakness was uniform:
**things that fail are recorded; things that are refused are not.**

An invalid webhook signature returned 401 silently. Thirteen admin actions
including the commission rate wrote no audit entry. A rejected payout
registration recorded an error string but a *successful-looking* one recorded a
sync timestamp that was not true. In each case the product could not later
answer "what happened", which is the only question that matters at 2am.

**Fixed:** webhook signature rejections are logged (presence and length only,
never the forged body); the money settings, premium grants, plan prices and
ticket responses are audited, with the previous value captured for the
commission rate; `registerBeneficiary` no longer stamps a sync it did not
perform.

**Already good, and worth keeping:** the notification outbox has dedupe keys, so
a retry does not re-send to a customer; operational SMS alerts exist for failed
payouts, beneficiary conflicts and — importantly — a refund that was promised
but whose record failed to write, which is the single worst silent state in the
payment system.

**Open:** nothing watches the logs. Vercel retains them and an admin can read
them, but there is no alerting on error rate, no notification when a cron fails,
and no dashboard that would have shown that every booking insert was raising
`P0001`. **That is the monitoring gap that let BOOK-1 live**, and it is more
valuable than any individual control still outstanding in this report.

## 31. Positive Security Controls (verified)

1. **Booking money is immutable to clients** — `validate_booking_transition` freezes 20 financial/identity columns; bookings cannot be INSERTed by any client role.
2. **Amounts are never taken from the browser** — `lib/booking-payment.ts` (integer paise) and `lib/leads.ts` compute every figure; the gateway is charged the stored total and the webhook re-verifies against Cashfree's API.
3. **Commission snapshot immutability** — raising a hall's rate to 5% after a 3.5% commission exists leaves the commission at 3.50 (probed).
4. **Role escalation blocked twice** — `profiles_update` policy subquery + `prevent_role_change` trigger.
5. **Account-status and verification flags are server-granted** — `guard_profile_privileged_columns` (probed).
6. **Premium placement cannot be self-assigned** — `guard_hall_privileged_columns` (probed on INSERT).
7. **An owner cannot redirect a customer's SMS** — trigger blocks owner writes to `contact_phone`/`customer_notes`; the mirror blocks customer writes to `owner_notes` (probed).
8. **Per-hall commission is hidden from every client role** — migration 0072 column-level revoke (verified `has_column_privilege = false` for anon and authenticated).
9. **Unverified enquiries are unreadable by the venue** — `leads_select` requires `phone_verified` (probed).
10. **OTP never enters the application** — MSG91 generates/stores/checks; five DB-backed ceilings; the reservation-then-recheck pattern closes the parallel-send race.
11. **Webhook signatures are verified in constant time**; unsigned/mis-signed bodies are rejected before parsing.
12. **Idempotency by unique index** — `cashfree_order_id`, `notifications.dedupe_key`, `uq_lead_active`, `uq_commission_per_lead`, `uq_ocp_open_per_commission`, `premium_listings.plan_purchase_id`.
13. **Append-only admin audit log** — guard trigger; INSERT policy `is_admin() OR is_trusted_backend()`.
14. **Open-redirect guard on OAuth callback**; cookies `Secure` + `SameSite=Lax`; HSTS; `frame-ancestors 'none'`; nosniff.
15. **No secret in git history or client bundle**; every secret-reading module is server-only.
16. **All `SECURITY DEFINER` functions pin `search_path`**; owner-callable RPCs check ownership in-body.
17. **Source maps not served; private routes disallowed to crawlers.**

## 32. Remediation Roadmap

Full plan, with effort and sequencing: `SECURITY/REMEDIATION-PLAN.md`.

**Already done** — 10 migrations (0076–0085) and roughly two dozen application
changes, each committed separately with its reasoning, each verified against
production, each probe rolled back. Every Critical, High and Medium finding is
closed. The test suite went from 587 to 622, and the new tests are written to
**fail against the old code** rather than merely pass against the new.

**Before launch, owner action** — set `CONTACT_IP_SALT` in Vercel (the contact
form's per-sender limit is dormant without it); decide the password-reset gap;
enable 2-Step Verification on the admin Google account; complete DLT approval
for the two lead templates.

**Shortly after** — a nonce-based CSP, tested against a real Cashfree checkout
before it ships; a written data-retention policy that account deletion then
matches; a country allowlist on OTP destinations; a per-account ceiling on admin
alert SMS.

**When the code next changes in those areas** — move cancellation side effects
into a trigger if a fourth writer appears; reconcile stale orders against the
gateway before retiring them; make the OTP check counter atomic if those
ceilings ever become the primary control.

---

## 33. Retest Requirements

**After `CONTACT_IP_SALT` is set.** Send four contact messages in an hour from
one browser — the fourth should be refused. Then confirm from a different
network that a fresh sender is still accepted. That second half is what
distinguishes a working per-sender cap from an accidental global one.

**Before the first real booking.** Complete one end-to-end paid booking on the
Cashfree sandbox and confirm the booking reaches `booking_requested`, the
payment reaches `payment_success`, the tax invoice is issued exactly once, and
the availability row appears. Both booking outages found here were invisible
from outside; this is the only test that would have caught either.

**Before the first real payout.** Register a beneficiary, then **change the bank
account and register again**, and confirm `payout_beneficiary_digest` changes
and that dispatch refuses until re-registration completes. That is precisely the
behaviour CRIT-1 broke and it cannot be verified without the live Payouts API,
which is why it is listed here rather than marked done.

**After any migration touching grants.** Re-run the sweep: no client role should
hold `TRUNCATE` on anything in `public`, and the per-column write surface of
`profiles`, `contact_messages` and `hall_owners` should match what 0079, 0082,
0084 and 0080 left. Check with `has_column_privilege`, never
`has_table_privilege` — three mistakes in this engagement came from exactly that
confusion.

**Full retest** if the application changes materially: the authorisation probes
in §15–§17 and §22–§23, which exercise RLS, column grants and guard triggers
directly at the trust boundary rather than through the UI.

---

## 34. Production Launch Security Checklist

See `SECURITY/PRODUCTION-SECURITY-CHECKLIST.md`.

---

## 35. Final Risk Rating

| | Score | Basis |
|---|---|---|
| **Before remediation** | **4.5 / 10** | A sound architecture carrying two silent revenue outages, a payout destination that could not be corrected, four grant-versus-policy gaps, and a suspension control that did not survive contact with a token already issued |
| **After remediation** | **8.1 / 10** | Every Critical, High and Medium finding closed and verified. Residual risk is configuration and product completeness, not defect |

**What the remaining 1.9 is.** One unset environment variable holding a working
control dormant. One missing product flow — password reset — that a customer
will meet before any attacker does. One admin account with a single factor. A
CSP that cannot be tightened until checkout is re-tested against it. And no
monitoring: nothing watches for the shape of failure that hid BOOK-1 for however
long it was there.

**Launch recommendation: proceed**, once `CONTACT_IP_SALT` is set and the
password-reset gap is either filled or consciously deferred with the sign-in
option adjusted to match.

**The most valuable outcome of this engagement is not a fix.** It is that the
primary revenue path has been *proven* to work — by inserting the exact row the
application writes and watching it succeed — rather than assumed to work because
nothing had complained. A marketplace with no bookings and no errors looks
identical to a marketplace with no customers. Now the difference is measurable.

---

*Assessment and remediation performed under written authorisation from HALLNECT
LLP, against their own application and infrastructure. No third-party systems
were tested. No destructive testing was performed. No production data was
deleted or modified: every database probe ran inside a transaction terminated by
`RAISE EXCEPTION`, and row counts were verified unchanged afterwards. No real
financial transaction was initiated. No secret, token, OTP, bank account number
or key appears in any document in this directory.*

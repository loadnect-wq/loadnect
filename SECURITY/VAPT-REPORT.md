# Hallnect — Professional VAPT Report

**Assessment date:** 10 September 2026
**Target:** https://hallnect.com (production) and the `hallnect5` repository at commit `cae48be`
**Assessor:** Claude (Opus 5), acting as application security engineer, with written authorisation from the owner (HALLNECT LLP)
**Classification:** Confidential — contains vulnerability detail. No secrets, tokens, OTPs or personal data appear in this document.

> **Status of this document:** the deterministic evidence sections (§2–§7, §24–§27, §31) are final. The findings sections (§8–§13) and every assessment section that depends on them are being populated from the parallel review-and-verify panel (9 dimensions, each adversarially verified, plus a completeness critic). Where a section reads `PENDING PANEL`, it is not yet written — it is not being reported as clean.

---

## 1. Executive Summary

`PENDING PANEL` — written last, from the verified findings.

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

`PENDING PANEL`

| ID | Finding | Severity | CVSS | Status |
|---|---|---|---|---|

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

## 9. Critical Findings
`PENDING PANEL`

## 10. High Findings
`PENDING PANEL`

## 11. Medium Findings
`PENDING PANEL`

## 12. Low Findings
`PENDING PANEL`

## 13. Informational Findings
`PENDING PANEL`

## 14. Authentication Assessment
`PENDING PANEL` — deterministic evidence: OAuth callback validates `next` (must start with `/`, rejects `//` and `/\`); cookies `secure` + `SameSite=Lax`; `requireAuth` enforces `is_active`; role locked by trigger + policy.

## 15. Authorization Assessment
`PENDING PANEL`

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
All 71 policies were captured verbatim and reviewed; the panel's per-table conclusions are in `PENDING PANEL`.

### 16.3 SECURITY DEFINER
28 functions; all pin `search_path`. Owner-callable RPCs `create_offline_booking` / `cancel_offline_booking` check `owns_hall() OR is_admin()` in-body; `coupon_usage` and `schema_migration_state` check `is_admin()` in-body. See PRE-5, PRE-10.

### 16.4 Live probes (rolled back)
Thirteen-check authorisation suite on leads/commissions: all pass. Customer-role write probes: self-confirm **blocked** (42501 + transition trigger), `owner_notes` **blocked**, review edit **blocked**, self-cancel **allowed** (expected). Mass-assignment probes: `is_active` **blocked**, hall premium/rating **blocked**, ticket admin fields **VULNERABLE** (PRE-4).

## 17. API Security Assessment
`PENDING PANEL`

## 18. Booking Security Assessment
`PENDING PANEL` — deterministic evidence: `validate_booking_transition` restricts a customer to `→ cancelled` only, an owner to `booking_requested → owner_confirmed | owner_rejected` and `owner_confirmed → completed`, and freezes every money/identity/date/slot/guest/coupon/terms column for non-trusted callers.

## 19. Payment Security Assessment
`PENDING PANEL` — deterministic evidence: every apply path re-reads the order from Cashfree and compares the stored amount (±₹0.50); status-guarded claims; unique `cashfree_order_id`; 503 on `error`/`unactivated`/`unsettled` so Cashfree retries. **NOT TESTED — REASON:** the owner-pays commission path was opened in production (`HNC_…`, status `created`, 0 webhook events) but the payment was not completed by the owner, so settlement and its webhook were not observed end to end.

## 20. MSG91 / OTP Security Assessment
`PENDING PANEL` — deterministic evidence: MSG91 owns the OTP; five DB-backed ceilings in `lib/otp-guard.ts` (60 s cooldown; 5/h per user+phone; 10/day per phone; 15/day per account; 300/day global, fail-closed; 5 failed checks per phone per 15 min) shared by both OTP flows; delivery webhook behind a constant-time shared-secret check.

## 21. Webhook Security Assessment
`PENDING PANEL` — deterministic evidence: PG webhook signature is `Base64(HMAC-SHA256(timestamp+rawBody, PG secret))` compared with `timingSafeEqual`; **no timestamp-freshness window** (replay is idempotent by design because state is re-read from Cashfree, but the design choice is recorded).

## 22. Admin Security Assessment
`PENDING PANEL`

## 23. Hall Owner Security Assessment
`PENDING PANEL`

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
`PENDING PANEL`

## 29. Privacy / Data Exposure Assessment
`PENDING PANEL`

## 30. Logging / Monitoring Assessment
`PENDING PANEL`

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
`PENDING PANEL` — see `SECURITY/REMEDIATION-PLAN.md`.

## 33. Retest Requirements
`PENDING PANEL`

## 34. Production Launch Security Checklist
See `SECURITY/PRODUCTION-SECURITY-CHECKLIST.md`.

## 35. Final Risk Rating
`PENDING PANEL`

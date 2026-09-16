# Hallnect — master update plan

**Status: section 0 deliverable. No code has been changed.**
Written 2026-09-16 against commit `db63bb8`, migration `0092`, and the live production
database (`kvcrqhmgthixhqrjytay`, ap-southeast-2, Postgres 17.6).

This document answers the three things section 0 asked for:

1. **What is actually there** — §1, the real routes, actions, RPCs, policies, migrations and
   Cashfree/MSG91 integration points.
2. **How each task maps onto it** — §5, task by task.
3. **Where the prompt and reality disagree** — §3. *The code and database are the source of
   truth.* Every disagreement is listed with the file, line or migration that settles it.

§4 is extra: defects found while auditing that the prompt does not mention. They are not in
scope for any task, but several of them would break a task if left alone, so they are recorded
where the work will trip over them.

---

## 0. How this was produced

Eight parallel inventory passes over the repository (routes/SEO, owner form, admin surface,
booking-payment-availability engine, leads/MSG91, RLS and migration conventions, consent/legal/
config, tests and tooling), then one mapping pass per task, each with an adversarial pass that
re-opened the files to confirm or refute every claimed conflict. Database facts were read
directly from production rather than inferred from migration files — which matters, because
§4.1 shows the files and the database have drifted apart.

---

## 1. What is actually there

### 1.1 Shape

- Next.js 16 App Router, React 19, Tailwind 3.4.1, TypeScript strict.
- Supabase Postgres 17.6 in **ap-southeast-2 (Sydney)**; Vercel functions pinned to `syd1`.
- 82 route files, 92 migrations, 35 test files / 784 tests, 0 lint warnings, 0 type errors.
- Deployed at `https://hallnect.com` (apex; `www` 301s to it).

### 1.2 Public route surface

Twelve static indexable routes plus two dynamic families. Every one builds metadata through
`buildMetadata()` in `lib/seo/metadata.ts`:

| Route | Indexable | Notes |
|---|---|---|
| `/` | yes | |
| `/halls` | yes, **unfiltered only** | any `?city=`/`?category=` variant flips to `noindex, follow` |
| `/halls/[slug]` | only when `status = 'approved'` | not cached, not prerendered — see §4.3 |
| `/wedding-halls/[city]` | only when the city has ≥1 approved venue | `generateStaticParams` over 18 cities, `revalidate 300` |
| `/about`, `/premium`, `/contact`, `/owner/register` | yes | `/contact` and `/owner/register` put metadata on a server `layout.tsx` because the page is a Client Component |
| six `(legal)` pages | yes | |

Noindex but publicly reachable: `/book/[slug]`, `/enquiry/[slug]`, `/login`, `/signup`,
`/booking/[id]/status`, `/invoice/[id]`, `/verify-phone`, `/profile`, `/saved`.
Four private subtrees declare `robots` once on their layout: `/admin`, `/customer`,
`/owner/(dashboard)`, `/(auth)`.

**Adding an indexable page costs four edits or the test suite fails:** the `buildMetadata` call,
an entry in `app/sitemap.ts`, an entry in `INDEXABLE_PAGES` in
`lib/__tests__/seo-invariants.test.ts`, and an `Allow` in `app/robots.ts` if it sits under a
disallowed prefix. Titles and descriptions must be unique and descriptions ≤158 characters.

JSON-LD lives in `lib/seo/jsonld.ts`: Organization, WebSite, FAQPage, EventVenue,
BreadcrumbList. `venueJsonLd` emits a `GeoCoordinates` node only when both coordinates are
present.

### 1.3 Server actions

Thirteen `"use server"` modules. The two that matter most for this update:

- `app/owner/(dashboard)/actions.ts` — `createHall`, `updateHall`, `submitHallForApproval`,
  `claimHallDraft`, image actions, payout setup, lead accept/reject.
- `app/admin/actions.ts` — ~40 actions behind `requireAdminActor()`, including the eleven
  money actions listed in §6.

### 1.4 Database

37 tables. **There is no `hall_spaces`, `hall_details`, `date_holds`, `muhurtham_dates` or
`localities` table** — every one of those is new work.

`halls` has exactly 28 columns: `id, owner_id, name, slug, description, city, state, address,
pincode, latitude, longitude, capacity_min, capacity_max, price_per_day, price_morning,
price_evening, status, is_premium, rating_average, rating_count, created_at, updated_at,
premium_tier, rejection_reason, moderated_at, moderated_by, venue_types, commission_rate,
booking_mode`. **None of the ~40 venue-detail fields in task 1.1 exist.**

Enums (exact):

```
availability_status  available | booked | partially_booked | blocked | morning_booked |
                     evening_booked | full_day_booked | maintenance | offline_booked
booking_slot         morning | evening | full_day
booking_status       pending_payment | payment_success | booking_requested | owner_confirmed |
                     owner_rejected | cancelled | completed | refunded
hall_status          draft | pending_approval | approved | rejected | suspended
user_role            customer | owner_pending | owner_approved | admin
payment_status       pending | created | payment_success | payment_failed | user_dropped |
                     cancelled | refunded
```

Status vocabularies added since have been **text + a named CHECK, never new Postgres enums** —
because an enum value cannot be removed, and cannot be added inside a transaction that also uses
it (`0073:45-53`). `halls.booking_mode`, `admin_hall_drafts.claim_status` and
`premium_listings.grant_type` all follow that pattern. **Any new vocabulary in this update must
too**, including `date_holds.status` (task 1.4).

Live row counts: halls 1 (1 approved), bookings 0, leads 0, drafts 0, availability 0,
reviews 0, amenities 12, hall_images 9, profiles 3, hall_owners 2.

### 1.5 The security model — read this before designing any table

Two independent layers, and **the grant layer is checked first and knows nothing about
`is_admin()`**.

- **A column-level revoke cannot narrow a table-level grant.** You must revoke the verb on the
  table from `anon, authenticated` and re-grant the permitted columns *by name*. Migrations
  0032, 0072, 0082, 0084 and 0088 have all been bitten; 0084 calls it "this house's most
  repeated mistake".
- **`halls` is fail-closed for SELECT since 0072** — it re-granted every column by name except
  `commission_rate`. **Any column added to `halls` after 0072 has no read grant**, and the
  public catalogue fails with `42703` the moment a page names it. This is the single biggest
  constraint on task 1.1: forty new columns means forty explicit
  `grant select (<col>) on public.halls to authenticated, anon;` plus
  `notify pgrst, 'reload schema';`. Same for UPDATE since 0046 — precedents 0073
  (`booking_mode`) and 0089 (`latitude, longitude`).
- **`availability` has no client write grant at all** (0063 revoked insert/update/delete and
  dropped `availability_write`). Writes come only from the service role or from SECURITY DEFINER
  RPCs holding `pg_advisory_xact_lock(inventory_lock_key(hall, day))`. The task brief's rule and
  the database agree; nothing in this update may relax it.
- **`availability_select` must stay a row-local predicate** (`is_public OR owns_hall OR
  is_admin`). Realtime evaluates the SELECT policy against the candidate row and cannot evaluate
  a correlated subquery into `halls` — INSERT events silently vanish for subscribers while
  DELETEs still arrive (0061, 0062).
- **A refused non-admin write returns zero rows, it does not raise.** Every write carries
  `{ count: "exact" }` and refuses on zero. Any verify block probing authorization must count
  affected rows, because "it did not throw" proves nothing (0088).
- Guard triggers that call `is_trusted_backend()` **must be SECURITY INVOKER** — under DEFINER,
  `current_user` becomes `postgres`, which the function trusts, so the guard never fires. 0076
  shipped that bug and its own verify block caught it.

Every table has RLS enabled. Only `invoice_counters` and `owner_payouts` have zero policies,
deliberately: they grant nothing to `anon`/`authenticated`, so they are service-role only
(documented in 0092).

### 1.6 The booking / payment / availability engine

This is the highest-risk area and the one task 1.4 builds on.

- The **advisory lock is never taken from TypeScript.** It is taken inside
  `assert_inventory_free()`, reachable only from the triggers
  `trg_guard_booking_against_blocks` (bookings) and `trg_guard_block_against_bookings`
  (availability), and from `create_offline_booking()`. `EXECUTE` is revoked from
  `anon`/`authenticated`. **Any new write path that bypasses those triggers bypasses the lock.**
- A `pending_payment` booking **holds no inventory** — the guard returns early,
  `uq_booking_active_slot` excludes it, the GiST exclusion excludes it. Two customers can hold
  overlapping pending bookings; the loser finds out at payment. That is deliberate: making
  pending bookings reserve would let anyone block a calendar free for 20 minutes, repeatably.
- **The commission base is the hall price; the pot it comes from is the advance.** Re-deriving
  commission from the advance is wrong by 4× at a 25% advance. `calculateBookingPayment` throws
  when commission ≥ advance.
- GST is **rounded**, commission is **floored**. The asymmetry is deliberate — the two amounts
  belong to different people.
- The 20-minute hold is fixed by Cashfree refusing an `order_expiry_time` under 15 minutes.
  `PENDING_PAYMENT_TIMEOUT_MIN`, `GATEWAY_EXPIRY_FLOOR_MS` and `stamp_pending_expiry()`'s
  `interval '20 minutes'` must stay equal.
- The engine **never writes booking status `payment_success`** — it goes
  `pending_payment → booking_requested`. But `payment_success` still appears in
  `ACTIVE_BOOKING_STATUSES`, `uq_booking_active_slot`, the GiST exclusion and
  `assert_inventory_free`, so it must keep being treated as occupying.
- Webhook routing is by **order-id prefix**, with the booking path as the fall-through:
  `HNP_` → plans, `HNC_` → commissions, `HN_`/anything else → `verifyAndApplyPayment`. **A new
  order namespace (task 1.4 needs one) must be added to that chain** in
  `app/api/webhooks/cashfree/route.ts` or it will be looked up as a booking.
- The webhook returns **503** for `error`/`unactivated`/`unsettled` so Cashfree retries, and
  **200** for `pending`/`failed`/`not_found`. A duplicate audit row is *logged, not obeyed* —
  never short-circuit on `UNIQUE(provider, event_id)`, because the first delivery may have 503'd.

**Cashfree integration points:** `lib/cashfree.ts` (orders, refunds, status classification),
`lib/payments.ts` (`verifyAndApplyPayment`, order creation), `lib/refunds.ts`,
`lib/cashfree-payouts.ts` + `lib/payout-dispatch.ts` (X-Cf-Signature auth),
`lib/cashfree-subscriptions.ts`, `app/api/webhooks/cashfree/route.ts`,
`app/api/webhooks/cashfree-subscription/route.ts`, and the CSP's `form-action` + `frame-src`
entries in `next.config.ts`.

### 1.7 MSG91 / notifications

- Everything goes through `msg91Request` in `lib/msg91/client.ts`, which judges the response
  **envelope**, because **MSG91 answers HTTP 200 for logical failures**.
- An outbox model: `dispatchNotification` inserts a `notifications` row with a `dedupe_key`
  unique index, then sends via `after()` so the request is not blocked. **Any new route that
  dispatches notifications needs its own `export const maxDuration`.**
- Admin alerts go out over **two independent transports** — the webhook
  (`ADMIN_ALERT_WEBHOOK_URL`, now configured) fires first and is not DLT-gated, then SMS.
- OTP rate limiting is shared across all three OTP flows via `guardOtpSend` /
  `recordCheckAttempt` in `lib/otp-guard.ts`. **A fourth send path (task 1.3 adds two) must
  reuse them** — a private counter silently doubles every ceiling. Note the deliberate split:
  recipient-scoped ceilings fail **open** on a read error; the 300/day global fuse fails
  **closed**.
- `MSG91_TEMPLATE_OWNER_NEW_LEAD` is still unapproved on DLT, so a new-enquiry SMS is currently
  substituted onto `OWNER_ACCOUNT_STATUS` with the customer's phone removed and every value cut
  to 30 characters. It retires itself the moment the env var is set — **do not add a flag.**

### 1.8 Migration conventions

Numbered `NNNN_snake_case.sql`, **next free number is 0093**. Every file carries a header
comment explaining *why*, a `ROLLBACK:` block, and a trailing
`do $verify$ … raise exception …` block that asserts its own invariants. Grants end with
`notify pgrst, 'reload schema';` — forgetting it makes the change invisible to PostgREST even
though the SQL succeeded (0089).

### 1.9 Tests and tooling

- vitest, 35 files, 784 tests. **Only `lib/**/*.test.ts` and `tests/**/*.test.ts` are
  collected** — a test placed in `app/` or `components/` silently never runs.
- `globals: true` is **not** set; every test imports its own `describe/it/expect`.
- `server-only` is aliased to `tests/stubs/server-only.ts`; that alias is load-bearing.
- Two house styles: **behaviour tests** that call the real function and pin the number, and
  **source-level invariant tests** that read the file and assert about its text. The stated
  position is that RLS, unique indexes, CHECKs and the advisory lock are verified **against the
  live database** and recorded in the header comment — *never* mocked.
- **There is no CI.** No `.github` directory; nothing runs tests, lint or type-check on push.
  Every gate in this plan is manual.

---

## 2. What the prompt got right

Worth stating plainly, because the conflict list below is long and the prompt is mostly accurate:

- **All 37 tables** listed match the database exactly.
- `booking_status`, `hall_status`, `booking_slot` enums — exact matches.
- **`commission 1.5%, default advance 25%`** — correct.
  `platform_settings.commission_percent = 1.50`, `default_advance_percentage = 25.00`.
- Row counts — 1 approved hall, 0 bookings, 0 leads, 0 drafts, 12 amenities — all correct.
- Region `ap-southeast-2`, sitemap 14 URLs, the route list, the JSON-LD types — all correct.
- The claim that `admin_hall_drafts` exists and is claimed via `claim_admin_hall_draft()` —
  correct (migration 0090).
- **The open question is answered:** `halls.booking_mode` is text with
  `CHECK (booking_mode IN ('DIRECT_BOOKING','LEAD_GENERATION'))`. The other value is
  `DIRECT_BOOKING`.

---

## 3. Where the prompt disagrees with reality

*(§5 carries the per-task conflicts. These are the cross-cutting ones.)*

**3.1 — `availability_status` has two values the prompt omits.** The live enum also has `booked`
and `partially_booked`. Harmless for planning, but a `CASE` over the prompt's list would miss
two states.

**3.2 — "Descriptions must never be truncated mid-word… find and fix the truncation cause"
rests on a false premise.** `sanitizeText` in `lib/validation/schemas.ts` *does* hard-truncate
mid-word (`.slice(0, maxLen)`), with no ellipsis and no error — a real latent bug. But its cap
is **4000** and NS Khalyaana Mahal's stored description is **166 characters**. Nothing truncated
it; the owner's text simply stops mid-word. Fixing `sanitizeText` is worth doing and will not
fix NS. NS needs its text rewritten, which is content, not code.

**3.3 — The CSP blocks the map as task 1.2 describes it.** `frame-src 'self' <cashfree>` blocks
an embedded Google Map; `img-src` without Google's hosts blocks a Google Static Maps image. A
link-out works today with no CSP change. Anything richer is a deliberate CSP edit — and per
`lib/constants.ts`'s own rule, adding a third-party host is a **three-file change in one
commit**: the CSP, Privacy §2 and Privacy §5 (which is prefaced "We share your information only
with:" and is therefore exhaustive — an omission is a false statement, not a gap).

**3.4 — A Tamil font (task 2.2) cannot come from Google Fonts.** `font-src 'self' data:` and
`style-src 'self' 'unsafe-inline'`. It must be self-hosted.

**3.5 — WhatsApp click-to-chat (task 1.3) needs no CSP change.** A `wa.me` link is a navigation,
not a fetch or a frame. Worth stating because the brief's CSP caution implies otherwise.

**3.6 — `platform_settings.admin_whatsapp_phone` already exists but is not what task 1.3
wants.** It is a frozen legacy column (0047 superseded it with `admin_alert_phone`) and it is
the *admin* number, not a public support number. Task 1.3's `public_whatsapp_number` is a new
column. Note also that `admin_whatsapp_phone` is one of **five dead `platform_settings` columns**,
three of which are still returned by `get_public_payment_settings()` to any anonymous caller.

**3.7 — `otp_attempts` is not keyed to a user.** `user_id` has been **nullable since 0087**, and
there is a seventh column `actor_key` with `CHECK otp_attempts_one_actor` forcing exactly one of
the two. Any new OTP path (task 1.3) must supply exactly one or raise `23514`.

**3.8 — "one pull request per task" cannot be enforced.** There is no CI and no GitHub workflow.
A plan that assumes a red build blocks a merge is wrong; §5's gates are manual.

**3.9 — Testing risky migrations on a Supabase dev branch requires a purchase.** No branch
exists. One costs **$0.01344/hour (~$9.70/month)**. Tasks 1.4 and 2.1 should not go near
production without it. **This needs your approval** (§6).

---

## 4. Defects found while auditing

Not requested, not in scope for any task — but four of them would break a task that walked into
them, so they are recorded here with the task they threaten.

**4.1 — The migration files are not a faithful replay of production.** *(threatens every task)*
88 applied ledger rows against 92 files. `0090` was applied as four separate migrations. The
live `claim_admin_hall_draft()` contains an `admin_audit_log` insert the committed file lacks.
An applied migration `phone_only_accounts_have_no_email` has **no repo file**. `0091` was applied
before `0089`. **Read the live object (`pg_get_functiondef`, `pg_policies`,
`information_schema.column_privileges`) before assuming a file describes current state.**

**4.2 — ~~`payments.platform_fee_gst` has no migration~~ — REFUTED, recorded so it is not
re-raised.** An inventory pass claimed the column exists in production with no committed
migration creating it, and that a clean schema rebuild therefore fails. I checked:
`supabase/migrations/0049_platform_fee_gst.sql:29` contains
`add column if not exists platform_fee_gst numeric`. The column is created by a committed file
and a rebuild is fine. *(Kept in the document because the claim was plausible and specific —
the next reader should not have to re-derive that it is false.)*

**4.3 — `/halls/[slug]` is neither cached nor prerendered.** *(threatens task 2.1)* No
`revalidate`, no `generateStaticParams`, and it reads through the cookie-aware client because
RLS is what lets an owner preview a non-approved hall. Every venue-page request is a full
function invocation from Sydney. Adding ISR here means first splitting the public read onto
`getSupabasePublicClient()` and handling owner preview separately.

**4.4 — A city with approved venues that is not in `SERVICE_AREA_CITIES` puts a 404 in the
sitemap.** *(threatens task 2.1)* `fetchIndexableCities()` filters on `venueCount >= 1` with no
membership test, but the page's `cityFromSlug()` resolves only against `SERVICE_AREA_CITIES` and
returns `notFound()`. There is no DB constraint limiting `halls.city`. Separately, case and
whitespace variants ("Madurai" vs "madurai") can produce an **indexable, sitemapped city page
with no venues**, plus duplicate `<loc>` entries.

**4.5 — Filtered `/halls` ships `noindex` *and* a canonical to `/halls`,** contradicting its own
code comment at `app/halls/page.tsx:71-76`. `buildMetadata` sets `alternates.canonical`
unconditionally, before the `indexable` branch.

**4.6 — `/halls/[slug]` serves its not-found UI under HTTP 200** (a soft 404). The route streams,
and Next returns 200 for streamed responses. Mitigated by `noindexMetadata("Venue not found")`.

**4.7 — The admin draft form cannot set amenities, photos or slot prices.**
`AddHallDraftForm` hard-codes `amenitySlugs: []`, `customAmenities: []`, `photoUrls: []`,
`priceMorning/priceEvening: undefined` even though the schema, the table and
`claim_admin_hall_draft()` all support them. **Every admin-recorded venue currently claims into
a hall with no photos and no amenities.** `lib/admin-hall-drafts.ts`'s `SELECT` also omits the
slot prices, so a draft written with them is invisible in the admin list. This is a defect in
the feature shipped in `0090` and it directly undercuts task 1.5.

**4.8 — Three exported server actions have no call site**: `approveOwner`, `rejectOwner`,
`updateAdvertisement` (and `retryAllFailedNotifications`). They remain live, directly-invocable
endpoints. `approveOwner`/`rejectOwner` carry a `targetRole()` guard precisely because they once
demoted fellow admins to customer. "No UI" is not "no surface".

**4.9 — `/admin/halls?q=<name>` is a dead parameter.** Two places build that link
(`findPossibleDuplicates`, and "View listing" on a claimed draft) but the page destructures only
`{status, commission, sort, mode}`. The admin lands on an unfiltered list.

**4.10 — The admin mobile nav omits `/admin/hall-drafts` and `/admin/coupons`.** The sidebar is
`hidden lg:flex`, so those two screens are unreachable by navigation on a phone.

**4.11 — `/login` is the real sign-up for both doors and shows no Terms or Privacy text at
all.** *(threatens task 1.6)* `/signup` is only a redirect to it. Only `/owner/register` carries
browsewrap text, and only on the Google path.

**4.12 — Both money column DEFAULTs on `platform_settings` are stale.** *(threatens the §7
region migration)* Verified directly:

| column | column DEFAULT | live row | constant in code |
|---|---|---|---|
| `default_advance_percentage` | **20** | 25.00 | `DEFAULT_ADVANCE_PERCENT` = 25 |
| `commission_percent` | **2.5** | 1.50 | read from the row |

A fresh `platform_settings` row in a new environment — which is exactly what the Mumbai region
migration creates — would price every booking at a **20% advance** and charge **2.5%
commission**. The live row was edited without the defaults being moved with it. Both defaults
should be corrected in an additive migration *before* any environment is cloned.

**4.13 — The `rls_auto_enable` event trigger's DDL exists in no repo file.** A database rebuilt
from `supabase/migrations/` will not have it. It also swallows every exception and only logs —
it is a net, not a guarantee. Always write `alter table … enable row level security;` explicitly.

**4.14 — `MSG91_TEMPLATE_CUSTOMER_LEAD_UPDATE` and `MSG91_TEMPLATE_OWNER_NEW_LEAD` are absent
from `.env.example`.** A fresh deployment copying it will silently never configure them.

**4.15 — `hall_images` and `premium_listings` still hold table-level INSERT/UPDATE/DELETE for
`anon` and `authenticated`** in production, protected only by RLS and guard triggers, not by
grants. `notifications` likewise retains broad grants that `leads` and `otp_attempts` had
revoked.

---

## 5. Five findings that reshape the whole plan

These came out of the per-task mapping and cut across most of it. Each was confirmed by an
adversarial pass that re-opened the files.

**5.1 — A new table returns *zero rows*, not an error.** The `rls_auto_enable` event trigger
enables RLS on every new public table. A fresh table with no SELECT policy is readable only by
the service role and silently returns `[]` to everything else — the same state
`invoice_counters` and `owner_payouts` are in deliberately. This hits **every task that adds a
table**: 1.1 (`hall_details`, `hall_spaces`), 1.3, 1.4 (`date_holds`), 1.5, 1.6, 2.1
(`localities`), 2.6 (`push_subscriptions`). Each one must write its policies explicitly in the
same migration, and must not rely on the event trigger — which swallows every exception and only
logs (§4.13).

**5.2 — A missing grant on `halls` fails *silently*, and that decides the shape of task 1.1.**
`lib/halls.ts:601-608` catches `42703` and retries with `SELECT_LEGACY` — a reduced column list.
So forgetting a `grant select (col)` does not throw; it quietly degrades the catalogue. Combined
with 0072's fail-closed grant (28 named SELECT columns, 17 UPDATE, no table-level grant), adding
~40 columns to `halls` means ~40 grants, any one of which can be forgotten without a test
failing. **This is why the ~40 venue facts belong in a 1:1 `hall_details` table with
table-level grants, not on `halls`.** A missing *write* grant is a different, louder failure:
`42501` on the owner's whole save.

**5.3 — A root `/[city]/[venue-type]` route shadows the children of every static route.** Task
2.1's mapping checked that `/halls/*` and `/book/*` still resolve — but the collision runs the
other way. `/about/anything`, `/contact/anything`, `/premium/anything` would all match
`/[city]/[venue-type]` and render a city page instead of a 404. The fix is
`dynamicParams = false` with a static `generateStaticParams`, which the mapping adopts.

**5.4 — The only live venue is `LEAD_GENERATION`, so most of this plan has no production
coverage.** `createBookingRequest` refuses a lead venue (`app/book/[slug]/actions.ts:209`) and
`createLeadEnquiry` refuses a direct-booking venue (`lib/leads.ts:249`). Task 1.4 (date holds)
is **not exercisable end to end at all** until a `DIRECT_BOOKING` hall exists. Tasks 2.3, 2.4
and 2.5 all depend on `availability`, `bookings`, `reviews` or `leads` — every one of which is
at **zero rows**.

**5.5 — There is nowhere safe to test a migration.** The repo is four files ahead of the
production ledger, `0090` landed as four entries, `0091` was applied before `0089`, and no
Supabase dev branch exists. Task 1.4's first migration is
`ALTER TYPE availability_status ADD VALUE 'held'` — **PostgreSQL cannot remove an enum value**,
so it is irreversible. That is the single place in this plan where the ~$9.70/month branch is
clearly worth buying.

---

## 6. Task-by-task map

Full per-task detail (touch points, migrations, tests, risks, PR splits, and all 151 conflicts
with their verdicts) is in the workflow transcript; this is the decision-grade summary.
**Effort** is S/M/L/XL. **Gate** means a stop-and-ask rule is triggered.

### Phase 1

**1.1 Venue data model — XL, 12 PRs, gate**
Genuinely greenfield: none of the ~40 fields, `hall_spaces` or `hall_images.category` exist.
But three parts are *rewrites of shipped, deliberate behaviour*, not new work: the
"Hallnect Standard Venue Rules" block (`HallDetailView.tsx:61,834-846` — the heading was
deliberately changed to name whose rules they are), the single `formatHallPrice` phrase in
`lib/booking-mode.ts`, and the deliberate absence of `priceRange` on EventVenue.
New migrations **0093–0096**: `hall_details` (1:1), `hall_spaces`, `hall_images.category`,
`rent_type` guard. Gate: the venue-rules rewrite is customer-facing policy text, and `rent_type`
reaching the price label changes what `price_per_day` means to the advance, the platform fee,
the commission snapshot and the tax invoice.
**Sharpest conflict:** seven proposed fields (`has_bridal_room`, `valet`, `wheelchair_access`,
`in_house_catering`, `car_parking`, AC/generator) **duplicate live amenity rows** seeded by 0008
that are already a search filter and already published as `amenityFeature`. One source of truth
must be chosen before PR1.
Also: `claim_admin_hall_draft()` inserts a **fixed 18-column list** into `halls`, so every new
field is silently dropped for admin-recorded venues unless that function is updated too.

**1.2 Listing data quality — L, 8 PRs, decisions needed (no rule triggered)**
Mostly surgical fixes to surfaces that exist. **The pin UI already ships** (commit `e3f35bc`,
migration 0089, `lib/geo.ts`) — the task's "admin/owner UI to drop a pin" is done for owners.
The "Open in Google Maps without an empty grey box" is ~90% done
(`HallDetailView.tsx:206-208,519-527`); the defect is an unconditional placeholder at `:514-517`.
**Sharpest conflict:** there is **no admin hall-edit screen at all**, and the owner one is
role-locked against admins (`app/owner/(dashboard)/halls/[id]/edit/page.tsx:25` is
`requireRole(["owner_approved"])`). "Fix NS via an admin edit screen" means *building* that
screen. And fixing `sanitizeText` will not make paragraphs render — the description sits in a
plain `<p>` with no `whitespace-pre-line`, so newlines collapse regardless.

**1.3 Human contact channels — XL, 10 PRs, gate (money)**
~40% already exists: phone, hours, address and email are compile-time constants already in
Organization JSON-LD. **`get_public_payment_settings()` cannot be widened** — a `RETURNS TABLE`
signature cannot be changed with `CREATE OR REPLACE`, so it needs DROP + CREATE, which drops its
grants.
**Sharpest conflict:** a callback or site-visit lead **inherits the commission machinery
whether or not anyone intends it** — `leads_confirmed_has_amount` forces an `agreed_amount`, and
`confirmLead` creates a commission row. That is why this is a money gate. Also: both surfaces
the task names most (`HallDetailView`, `/contact`) are **Client Components** and cannot read
`platform_settings`; and the WhatsApp icon needs an inline SVG or a `/public` file, because
`img-src` blocks any CDN.

**1.4 Refundable date hold — XL, 9 PRs, gate (money, whole feature)**
Nothing exists. **In this codebase it is a money-movement project, not a calendar project**:
the calendar half is ~80 lines of SQL on `assert_inventory_free`; the hard half is a second
Cashfree order namespace whose token must be **auto-refunded by a cron** — a capability the
platform has never had (the only refund executor is the admin-only, manually-clicked
`issueRefund`).
Migrations **0093–0098**, starting with the irreversible `ALTER TYPE … ADD VALUE 'held'`.
**Sharpest conflicts:** (a) "credited against the advance" **has no column** — `bookings` has no
credit field, and the only reduction mechanism is `coupon_id`, which
`guard_booking_coupon_integrity` polices; (b) a converted booking is created `pending_payment`,
so **the 20-minute expiry sweep will cancel it** if the balance is not paid immediately;
(c) Cashfree's gateway fee on the ₹999 capture is **not returned** when the token is refunded,
so every expired or declined hold costs real money — a commercial decision, not a code one.

**1.5 Supply import — XL, 6 PRs, gate (unclaimed public pages)**
~60% shipped: 0090 built `admin_hall_drafts` and the whole claim path works today.
Missing is the bulk half: CSV import, seven research columns, a sales view, invite delivery.
**Sharpest conflicts:** `admin_hall_drafts` declares `capacity_max`, `city`, `owner_name` and
`owner_phone` **NOT NULL**, with `owner_phone` constrained to E.164 — a research file will not
have those, so the import as specified is impossible without additive nullability work or
staging. `fetchClaimableDraft` returns **exactly one draft** (`.limit(1)`), which a bulk import
immediately outgrows. There is **nowhere to log call outcomes** (one free-text `admin_notes`),
and **"Request removal" has no state** — `claim_status` permits only
`unclaimed|claimed|cancelled`. Also: a server-action file upload hits the App Router's **1 MB
default body limit**, unconfigured here.

**1.6 Consent — L, 8 PRs, gate (legal text)**
**The task's premise is inverted.** "Default to unticked everywhere" is *already true*: there
are exactly two checkboxes in the app, and the consent one already defaults false and is
re-checked server-side against the raw action input. Nothing is pre-ticked because **there is no
marketing channel at all** — every one of the 17 SMS templates is transactional.
**The real gap is the opposite:** the production path (the only live hall is `LEAD_GENERATION`)
**forwards a customer's phone number to a third-party business through `/enquiry` with zero
recorded consent and zero policy presentment**, and `/login` — the real sign-up for both doors —
shows no Terms or Privacy text at all. That is the finding worth acting on.

### Phase 2

**2.1 SEO landing pages — XL, 8 PRs, gate (policy copy on new public pages)**
Most of this **already exists once, for one route**: `/wedding-halls/[city]` is already ISR-
cached, server-rendered, with a data-derived intro, SSR list, computed price/capacity stats,
real FAQs and four JSON-LD types. The task is to *generalise* it, add the locality model, and
add pagination. Migrations **0093–0094** (`localities`, plus a GIN index on `halls.venue_types`,
which is unindexed today).
**Sharpest conflicts:** `revalidatePath("/sitemap.xml")` — the mechanism that puts a newly
approved venue in the sitemap — **becomes a silent no-op under `generateSitemaps`**.
`MIN_VENUES_FOR_INDEX` is **one shared constant**, so raising the threshold to 5 also changes
`/wedding-halls/[city]`. "Internal links to nearby localities" **has no geographic basis** — the
one hall has NULL coordinates. And `'use cache'`/`cacheTag`/`revalidateTag` appear **nowhere**
in the codebase.

**2.2 Tamil language — XL, 10 PRs, gate (translating consumer terms)**
**5% i18n infrastructure, 95% a copy-extraction refactor.** There is zero i18n today, and every
user-facing string is an inline JSX text node across ~3,100 lines. `buildMetadata` has **no
locale parameter**, `lib/seo/jsonld.ts:132` **hardcodes `inLanguage: "en-IN"`**, and `<html
lang>` is set once in the single root layout. The gate is real: `app/page.tsx:61-62` states the
refund schedule verbatim, so translating it publishes a second, unreviewed statement of consumer
terms.

**2.3 Muhurtham dates — L, 7 PRs, partial gate (PRs 1–4 are clear)**
The table and admin CRUD are genuinely new and easy. The hard half is that three of the four
consumer requirements sit on data that does not exist and, for the only live venue, never will.
**Sharpest conflict — and it is a live bug:** `lib/halls.ts:248-259` filters by availability
**with no `booking_mode` predicate**, so a `LEAD_GENERATION` hall (zero availability rows)
survives *every* date filter — the search asserts about lead venues exactly what the venue page
refuses to assert. The venue page's availability read is also **fail-open**
(`lib/halls.ts:635` destructures the error away), and the availability **write** is
fire-and-forget (`lib/payments.ts:1071`).

**2.4 Search, compare, share — L, 7 PRs, gate (ranking disclosure)**
About half exists: `/halls` is already URL-synced and shareable with 10 server-read params.
**Sharpest conflicts:** compare-by-"rules" **has no per-venue data at all** —
`HallDetailView.tsx:55-59` says so outright. `price-desc` **sorts unpriced venues to the top**
(no `nullsFirst`, while `:378` passes it explicitly for `premium_tier`, so the author knew).
The budget filter **silently deletes unpriced venues**. Every new filter collides with the
crawl-trap control, which noindexes any variant carrying a known filter key. The gate is the
Rule 5(3)(f) ranking disclosure text.

**2.5 Trust — L, 9 PRs, gate (legal text)**
Three of five sub-tasks are **already true** and need only tests: ratings are booking-linked,
hidden reviews are excluded, and every surface gates on `rating_count > 0` (JSON-LD at ≥3).
**Sharpest conflict:** a `LEAD_GENERATION` venue **can never earn a rating** — `reviews_insert`
requires a `completed` booking and lead venues cannot produce one. Not "not yet": never, in the
current model. Also `hall_owners.is_verified` is **already true** for the live owner, set
automatically by `approveOwner`, not by any checklist. The gate is direct: Terms §5 and
Disclaimer §2 both state Hallnect does **not** verify listing details, which a public "Verified"
badge contradicts.

**2.6 Owner PWA — XL, 13 PRs, gate (privacy text)**
Most of the "owner app" already exists as a mobile-first dashboard. Nothing PWA does: no
manifest, no service worker, no web-push.
**Sharpest conflict:** a root-scope service worker **collides with the Supabase session proxy
and the cookie-free public cache** (`proxy.ts:81-85` matches everything but static assets). Also
**a push channel already exists and the plan did not mention it** — `admin-webhook.ts` already
pushes to ntfy/Slack/Discord.

**2.7 Pricing experiment — L, 7 PRs, gate (operator's commercial call)**
**Largely already shipped.** Migration 0091 delivered `grant_type='complimentary'` with the DB
CHECK, the admin form, distinct audit actions, honest owner copy, and a revenue figure that
already excludes giveaways. "N months free" is purely a date window; **nothing in
`premium_plans` needs to change**. The gate is arithmetic, not code: at live prices a 3-month
Premium offer to 10 venues per city is **~₹150,000 of forgone revenue per city**.

### Phase 3

**3.x — XL, 15 PRs, four independent gates**
Seven unrelated products under one heading; five are blocked on approval or an external party.
Buildable now without touching money or legal text: a sales desk on the existing `leads` table,
and a deterministic English+Tamil natural-language→structured-filter extractor targeting the ten
existing filter params. EMI/pay-later, caution deposits and e-sign are all money gates. The
region migration is **document-only** and must stay that way.

---

## 7. What I need from you before building

Nothing in §6 starts without these. Grouped by what kind of answer it is.

**Purchases (I will not make these):**
1. **A Supabase dev branch — ~$9.70/month.** Your own rule 4 requires risky migrations be tested
   off production. Task 1.4's first migration is irreversible. Yes or no?

**Money and commercial decisions:**
2. **Task 1.4 in principle.** Cashfree's fee on each ₹999 capture is not returned on refund, so
   every expired or declined hold costs you real money. Accept that, or make the token
   partially non-refundable (which changes the legal draft)?
3. **Are callback and site-visit leads commission-bearing?** (Task 1.3.) They inherit the
   commission machinery by default; PR5/PR6 cannot be written without an answer.
4. **Task 2.7 giveaway size** — ~₹150,000 forgone per city at 10 venues × 3 months Premium.

**Legal/policy text (your rule says stop):**
5. The venue-rules rewrite (1.1), the marketing-consent Privacy amendment (1.6), the
   "Verified" badge vs Terms §5 and Disclaimer §2 (2.5), the ranking disclosure (2.4), the
   Tamil translation of consumer terms (2.2), and the date-hold refund wording (1.4) — each is a
   separate yes.

**Product decisions with no rule attached:**
6. **The amenity overlap (1.1):** seven proposed fields duplicate live amenity rows. One source
   of truth — new columns, or the existing catalogue?
7. **The map (1.2):** link-out only (works today, no CSP change), or a static-map vendor (needs
   a CSP edit *and* a Privacy §5 amendment in the same commit)?
8. **Unclaimed public pages (1.5)** — your rule requires explicit approval before turning these
   on at all.
9. **Owner-supplied content for NS Khalyaana Mahal** (1.2): the full description, the typo fix,
   the Maps link, which of the 12 amenities apply, and a category + alt text per photo. No code
   can invent these.

---

## 8. Recommended order

Sequenced so nothing is built twice and the riskiest thing is never first.

1. **1.6 PR1–PR4** (consent presentment on `/login` and `/enquiry`). Smallest, no gate on the
   operational half, and it closes the one finding with a live privacy exposure (§6, 1.6).
2. **1.2 PR1–PR5** (text that survives the save, state canonicalisation, the grey box, the lead
   calendar). Small, self-contained, improves the only live listing.
3. **1.1 PR1–PR4** (`hall_details` + `hall_spaces` + vocabularies + write path, no UI). Everything
   else in Phase 1 wants these fields.
4. **1.2 PR6** (the admin hall-edit screen) — built *on* 1.1's form, not beside it.
5. **1.5 PR1–PR3** (research columns, CSV import, sales view). This is what actually gets venues
   on the site, which §5.4 shows is the binding constraint on everything else.
6. **1.3 PR1–PR5, PR8–PR9** (WhatsApp, header phone, support email) — skipping the
   commission-bearing lead types until question 3 is answered.
7. **2.1** once there are ≥5 venues in a city. Before that it publishes nothing.
8. Everything else after inventory exists.

**Not before a dev branch exists:** 1.4 (irreversible enum), 2.1 PR1 (the `localities` migration
that the public catalogue depends on).

---

*End of the section 0 deliverable. No application code, migration or configuration has been
changed in producing it.*

# Hallnect — VAPT Findings Ledger

**Assessment:** 10–11 September 2026
**Target:** https://hallnect.com and `loadnect-wq/hallnect5`
**Database:** Supabase `kvcrqhmgthixhqrjytay` (Postgres 17, ap-southeast-2)
**Authorisation:** written, from the owner (HALLNECT LLP), for their own application and infrastructure.

This is the canonical list. `VAPT-REPORT.md` explains the method and the
narrative; `REMEDIATION-PLAN.md` covers what is left.

**No secret, token, OTP, bank account number, API key or service-role key
appears anywhere in these documents.** Where one was encountered it was
recorded by location and existence only.

---

## How to read this

**Status**

| Status | Meaning |
|---|---|
| **Fixed** | Remediated, verified, committed, pushed. The commit is named. |
| **Accepted** | Real, understood, and deliberately not changed. The reason is given. A risk nobody has written down is not accepted, it is forgotten. |
| **Open** | Real and not yet fixed. Owner action, product work, or a deliberate deferral with a named trigger. |

**Verdict** is the assessment-time classification: **Confirmed** (reproduced,
or the vulnerable logic read and cited line by line), **Partially confirmed**
(plausible, not reproduced), **Informational**.

**Severity** is the *adjusted* severity after adversarial verification, not the
severity a reviewer first proposed. Three findings were downgraded because a
verifier showed the precondition did not exist; two were upgraded. Those moves
are noted in place.

---

## 1. Summary by severity

| Severity | Count | Fixed | Accepted | Open |
|---|---|---|---|---|
| Critical | 1 | 1 | 0 | 0 |
| High | 2 | 2 | 0 | 0 |
| Medium | 7 | 7 | 0 | 0 |
| Low | 17 | 15 | 1 | 1 |
| Informational | 29 | 10 | 6 | 13 |
| **Total** | **56** | **35** | **7** | **14** |

Two further items raised by reviewers were **false positives** — the code they
described had already been fixed earlier in the session — and are recorded at
the end for transparency rather than dropped.

**Every Critical, High and Medium finding is fixed.** Nothing above Low is
open or accepted.

---

## 2. The two findings that mattered most

Neither of these was a way in. Both were ways the product silently did not
work, found by security review because security review is the only exercise
that reads the money path end to end and asks "what if this is wrong".

### BOOK-1 — Direct booking had been impossible since GST shipped
**Critical · Confirmed · Fixed (migration 0077, commit `6f411b8`)**

`guard_booking_coupon_integrity` (migration 0045) asserted

```
customer_total_amount = advance_amount + platform_fee_amount
```

Migration 0049 then introduced `platform_fee_gst` and made the customer total
*include* the tax. `lib/booking-payment.ts:348` computes
`advance + fee + gst`, and the booking action writes that. 0049 updated the
booking-transition guard and never touched this one, so the two halves of the
schema had disagreed about what a customer total *is* ever since.

For the one live hall at ₹1,00,000/day:

| | |
|---|---|
| What the application writes | 25000 + 200 + 36 = **25236** |
| What the trigger demanded | 25000 + 200 = **25200** |

Every standard booking raised `P0001` and rolled back. The customer saw only a
sanitised failure string.

**The cruel detail:** the only bookings that *could* be created were coupon
bookings, because a fee-waiving coupon sets fee = 0, which makes gst = 0, which
makes the broken equality hold. The path that worked was the discounted one.
The full-price path — the one that earns money — was the one that failed.

**Why nobody noticed:** production holds zero bookings. That had been read as
"nothing has been exercised yet". It was at least partly "nothing *can* be".

**Evidence:** inserting the exact row the booking action writes returned
`bookings: customer_total_amount 25236.00 <> advance_amount 25000.00 +
platform_fee_amount 200.00`; the identical row with `platform_fee_gst = 0`
inserted cleanly, isolating the tax term as the sole cause. Rolled back.

---

### BOOK-2 — Every venue under about ₹3,200/day was unsellable
**High · Confirmed · Fixed (migration 0078, commit `53897f1`)**

The same shape as BOOK-1: two rules written at different times, each correct
alone, contradicting each other where they meet.

Check (c) of the same trigger refused any `platform_fee_amount` below a
hard-coded 200 without a coupon — reasonable when the fee was always exactly
200. `lib/booking-payment.ts` then introduced a cap of 25% of the advance and
applied it unconditionally, because a flat ₹200 stops being a fee and starts
being the price on a small booking. So a legitimate small booking produced a
fee below 200 with no coupon anywhere near it, and the trigger rejected it.

The cap binds when 25% of the advance is under 200, i.e. advance < 800. At the
live 25% advance rate that is **any hall priced under ₹3,200/day** — and
`MIN_HALL_PRICE_RUPEES` lets an owner list from ₹2,000. Half-day rates have no
floor at all, so a cheap morning slot on *any* venue hit the same wall.

Invisible until now because BOOK-1 rejected every booking first.

**Fix:** the floor became the same number the application computes, mirroring
`cappedPlatformFeeRupees` including the floor-to-paise, rather than a constant
that was true once.

**Evidence:** a ₹3,000/day booking (advance 750, fee 187.50, gst 33.75, total
971.25) was refused before and inserts after; a ₹1 fee is still refused; ₹150
on a ₹25,000 advance is still refused. Rolled back.

---

## 3. High

### CRIT-1 — An owner's payout bank account could never actually be changed
**High · Confirmed · Fixed (migration 0080 + application, commit `ddf1a1d`)**

Cashfree's `POST /beneficiary` only **creates** — there is no update verb — and
`toBeneficiaryId` derived the beneficiary id from the `hall_owners` row id
alone, making it stable for the life of the owner. Every re-registration
therefore collided with the first:

1. `POST /beneficiary` → `409 beneficiary_id_already_exists`
2. `upsertBeneficiary` falls through to `GET /beneficiary`
3. the GET returns the status of the destination registered **first**
4. `registerBeneficiary` writes `status = VERIFIED`, `synced_at = now`,
   `last_error = null`
5. `savePayoutDetails` returns `{ state: "verified" }`

The owner's row held the new account. Cashfree held the old one. Every payout
would have gone to the account the owner had just left, and nothing in the
product would have said so.

**It also disarmed the anti-redirection interlock**, which is what makes this a
security finding rather than only a correctness one. `dispatchOwnerPayout`
refuses when `payout_details_changed_at > payout_beneficiary_synced_at` — the
control against a compromised owner account redirecting payouts. Because
`registerBeneficiary` stamped `synced_at` on *every* outcome, including the
silent no-op above and including outright failures, the stamp always landed
after the edit and the interlock never fired. It had been reduced to asserting
that somebody had recently called Cashfree.

**Not exploitable for theft as it stood:** because Cashfree kept the original
destination, an attacker changing bank details on a stolen owner account would
have redirected the money *to the legitimate owner*. The loss runs the other
way, and it is rated on that.

**No production state to repair:** `hall_owners` holds 2 rows, none with a
beneficiary id or status. No beneficiary had ever been registered.

**Fix:** the beneficiary id is now bound to the destination (owner id + an
8-character digest of account|IFSC). A changed account yields a different id and
is genuinely registered; an unchanged one yields the same id, which is what
finally makes the 409-then-GET fallback honest. `payout_beneficiary_digest`
records which destination the stored id covers, and dispatch compares it
directly — a timestamp records *when* we last spoke to Cashfree and can never
record *what we said*.

### WEB-2 — Dependency advisories
**High (CVSS) · Confirmed · Fixed (commit `b0d65d0`)**

Next 16.3.1 and sharp 0.35.3 carried unpatched advisories. Upgraded to 16.3.3
and 0.35.4 respectively.

**Rated by CVSS, not by exposure.** The image-optimizer advisories are **not
exploitable against this production deployment**: `/_next/image` is served by
Vercel's own platform (`server: vercel`, body `INVALID_IMAGE_OPTIMIZE_REQUEST`),
not the bundled sharp, and the two remote `<Image>` call sites pass
`unoptimized`. Upgrading was still correct — the exposure could change with one
configuration edit — but the report does not claim an exploit it verified does
not exist.

---

## 4. Medium — all fixed

### AUTH-1 — A suspended account kept full write access until its token expired
**Medium · Confirmed · Fixed (migration 0081, commit `92dcdf0`)**

`profiles.is_active` was enforced in exactly one place: `requireAuth()`, which
pages and layouts call. Of the eighty server actions, only the forty in
`app/admin/actions.ts` re-read it. Every other action authenticated with
`getUser()` alone, and **no RLS policy mentioned `is_active` at all** — the
application's own source says so.

The compensating control was a GoTrue ban, and the comment beside it was
already honest about the limit: a ban stops sign-in and token refresh, it does
not invalidate an access token already in someone's hands. That token stays
valid until it expires, an hour by default.

For up to an hour after suspension a user could still cancel bookings, post
reviews, edit their profile and phone, create and edit halls, accept or reject
bookings, open tickets, spend MSG91 quota on OTP SMS and start checkouts.
Deleting their `auth.sessions` rows does not help: PostgREST validates the JWT
locally and never asks GoTrue whether the session still exists — which is also
how they could skip the app and write straight to PostgREST with the anon key.

**Fix:** a `RESTRICTIVE` write policy on each of the seven client-writable
tables, gated on `is_active_user()`. One rule in the database closes both the
eighty actions and the direct-PostgREST path, and closes it for every action
written from here on.

Writes only — a suspended user reading their own booking history is not a
security problem, and blocking reads would break every support conversation
that starts with "what did I have booked". Scoped to the `authenticated` role,
so cron expiry, webhook settlement, payouts and account deletion keep working;
several of them exist precisely to clean up after a suspension.

**Evidence:** an active owner's hall edit is allowed; the same owner suspended
is filtered to zero rows; reads still work. All ten profiles confirmed active
again afterwards.

### OTP-1 — A zero-width space smuggled a phone number into branded SMS
**Medium · Confirmed · Fixed (commit `ee4b66d`)**

`sanitizeNotificationText` strips URLs, bare domains, @handles and long digit
runs from free text interpolated into DLT-registered messages — an owner's
rejection reason, a hall name, a customer's name. The message leaves from
Hallnect's verified sender header, so whatever is embedded inherits the
platform's credibility.

**It sanitised the wrong string.** The text that reaches MSG91 and the handset
is the GSM-7 form, and `toGsm7` drops every character outside GSM-7. A
zero-width space is neither `\s` nor `\w`, so it broke every pattern in the
sanitiser and was then deleted downstream:

```
raw        Call 98765<U+200B>43210 to rebook direct and save the advance
sanitised  unchanged — no regex matches across the invisible character
delivered  Call 9876543210 to rebook direct and save the advance
```

An approved venue owner declining a booking could put that in front of the
customer, in an official Hallnect SMS, telling them to book direct and skip the
advance. The same reaches lead rejections, and a hall renamed after approval
carries it into every message about that venue.

The template *structure* was never at risk — values only fill `##varN##` slots
— so this is content injection, not template injection.

**Evidence:** the regression tests fail 10 of 14 against the old code,
including the delivered string `Grand Mahal call 9876543210`.

**Fix:** sanitise the GSM-7 form, which is the string actually sent. That
closes the whole class at once rather than a hand-kept list of invisible
characters, which would drift again. The digit rule now counts **digits**, not
characters, catching `98765.43210` and `98765/43210`. Tests also pin that a
plain cancellation reason survives verbatim and an 8-character booking
reference is untouched: a filter that eats real text is worse than the hole.

### OTP-2 — Anyone signed in could lock any phone number out of verification
**Medium · Confirmed · Fixed (commit `2607b2b`)**

`verifyPhoneOtp` takes the phone **from the client**, and the failed-check
budget was scoped to the phone alone. An attacker submitted five wrong codes
for a stranger's number, consumed that number's entire pool, and the owner of
it was refused their own correct code for fifteen minutes. Repeatable
indefinitely, against any number, from one ordinary account.

**The target that matters:** a venue owner cannot see a single lead until
`phone_verified` is true, so this denies them their business rather than merely
annoying them. A competitor's mobile is public on their own listing.

The original phone-scoping was reasoned, not careless — a 6-digit code has a
million values and an attacker with several accounts pointed at one number
would otherwise get a fresh allowance with each. The mistake was making one
number serve two purposes: "let a real person mistype" and "do not let a
stranger spend their allowance" cannot both be five.

**Fix:** three ceilings — 5 per (account, phone), 20 per phone as the
anti-brute-force fuse, 15 per account across all numbers. A check is also only
allowed for a number this account requested a code for, refused before MSG91 is
consulted and before anything is recorded. Every refusal returns one identical
message, because distinguishing them tells an attacker which ceiling they hit
and therefore what other accounts have been doing with that number.

**Residual, deliberate:** someone who genuinely sends a code to a number can
still spend that number's per-phone fuse. Closing that means abandoning
phone-scoped brute-force resistance, which is the wrong trade. It is bounded by
the send ceilings and by an `otp_attempts` row carrying their user id.

### API-5 / LOGIC-6 — Twenty messages silenced the contact form for everyone
**Medium · Confirmed · Fixed (migration 0082 + application, commit `1fa45d1`)**

`submitContactMessage` is anon-callable by design and its only abuse control
was a platform-wide count of 20 rows per hour that fails closed. Twenty valid
submissions from one script exhausted it, and every genuine visitor for the
rest of the hour was refused. On a marketplace this young the contact form is
how venue owners arrive.

The same flood also suppressed the admin alert, which is bucketed one per UTC
hour: fill the bucket and a real message that hour raises no SMS at all.

**The comment in the code explained the shape and was wrong.** It said per-IP
limiting "is not available to a server action" — a server action reads
`headers()` like any other server code, and Vercel sets
`x-vercel-forwarded-for` itself.

**Fix:** a per-sender cap at 3/hour does the real work; the global number
becomes a genuine backstop at 200. The sender label is a salted, truncated hash
— never the address, which is personal data and is read by the admin screen.
`x-vercel-forwarded-for` is preferred because the platform sets it and a client
cannot forge it; trusting the leftmost `x-forwarded-for` entry would let one
sender mint a fresh bucket per request.

> **Requires configuration:** `CONTACT_IP_SALT` is set locally but **not yet in
> Vercel**. Until it is, the helper returns null and the backstop carries the
> load alone. See `REMEDIATION-PLAN.md` §1.

### PRIV-1 / API-3 — A customer could file a support ticket with the admin's fields filled in
**Medium · Confirmed · Fixed (migration 0076)**

Reproduced as a real customer account. All four persisted:
`admin_response = 'FORGED: Refund approved by admin'`,
`internal_notes`, `status = 'resolved'`, `assigned_to`.

**Why it was possible — the recurring shape in this schema.** Two independent
layers had to agree and did not: `tickets_insert` (RLS) checks only
`user_id = auth.uid()`, saying who may file a ticket and nothing about what the
row may contain; the column grant left `authenticated` holding INSERT on every
column. **Grants are evaluated before RLS, and RLS is row-level, so neither
layer was ever going to catch a bad column.**

In order of seriousness: `status = 'resolved'` at creation makes the ticket
invisible in the admin's open queue — a complaint that is unanswerable by
construction, and a paper trail for "I raised it, nobody answered".
`admin_response` renders a fabricated Hallnect reply to the customer; "Refund
approved by admin" in the platform's own voice is evidence in a payment
dispute.

`priority` is deliberately still allowed: the customer genuinely picks it in
the support form. It is a queue hint an admin can override, not an
authorisation claim.

### PAY-3 — A captured payment could be cancelled with no refund record
**Medium (upgraded from Low) · Confirmed · Fixed (commit `2b12cb2`)**

The paid webhook does two writes: it stamps the payments row
`payment_success`, then moves the booking `pending_payment → booking_requested`.
If the second failed for any reason other than the slot race, the handler
returned "error", Cashfree retried, and the retry short-circuited on the
idempotent branch because the payment was already `payment_success`. It re-ran
the side effects, reported success, and never re-attempted the transition.

Money captured, calendar blocked, commission recorded, booking still
`pending_payment` until the expiry sweep cancelled it hours later. The
`refund_state = 'owed'` write that puts a row in the admin refund queue only
runs on the first attempt's zero-row branch, so the capture never reached
anyone. **The customer was charged for a booking that no longer existed and
nothing in the product knew they were owed anything.**

**Fix:** the idempotent branch now treats a booking still in `pending_payment`
as not finalised and falls through to the real path — safe because every step
of that path is already idempotent by construction, and it brings the
slot-conflict and refund handling with it rather than reimplementing them.

### WEB-2 covered above under High.

---

## 5. Low

| ID | Finding | Status |
|---|---|---|
| RLS-1 | `TRUNCATE` granted to `anon` and `authenticated` on **24 of 36 tables**, including `admin_audit_log`, `commissions`, `payment_transactions`, `profiles` and `availability`. RLS does not filter TRUNCATE at all — it is gated solely by the table privilege, so the admin-only policy was, for this one verb, decorative. TRUNCATE also fires no row triggers, so the append-only audit guard would not have recorded its own erasure. **Not reachable:** PostgREST emits no TRUNCATE and no client-callable function runs dynamic SQL (all 28 `SECURITY DEFINER` bodies read). Revoked schema-wide plus default privileges — a table list is how 0046 fixed four tables and let twenty-four drift. | **Fixed** (0079) |
| PAY-4 | The Cashfree refund id was derived from the **booking**, not the payment, so every payments row on a booking produced the same `HNR_<booking>`. `cashfree_refund_id` is UNIQUE, so the second refund's claim failed 23505 — and the caller read only `count`, discarded `error`, and reported "already being processed". The second refund on a double-captured booking could never be issued from the product. | **Fixed** (`2b12cb2`) |
| LOGIC-7 | A capped coupon could be redeemed more times than its cap. Redemptions are counted only on INSERT and only against already-paid bookings (correct — counting pending holds would let anyone starve a coupon), and the UPDATE branch never re-counted. Bounded at ₹200 per over-redemption. Now counted at the moment of redemption. | **Fixed** (0085) |
| PRIV-5 | Any authenticated account could create its own `hall_owners` row and reach Cashfree beneficiary onboarding. No money could move, but the third-party account is real, the admin conflict alerts are real, and someone who knew a venue's account number and IFSC could pre-claim it so the genuine owner is refused. | **Fixed** (`ddf1a1d`) |
| PRIV-4 | `approveOwner` / `rejectOwner` took a profile id and wrote a new role without reading the old one, so `rejectOwner(anotherAdminId)` demoted a fellow admin to customer. The user list already refuses to suspend an admin for exactly this reason. | **Fixed** (`1fdd995`) |
| PRIV-3 / LOGIC-5 | The live `admin_audit_log` carried fifteen distinct actions and **not one** `settings.*`, `premium.*` or `ticket.*` entry, despite the commission rate and payment settings having been configured in production. Invalid webhook signatures were rejected with no log at all, so a forged callback and our own secret being wrong after a rotation looked identical. | **Fixed** (`1fdd995`) |
| API-4 / WEB-9 | `hall_images.url` was whatever the owner said it was: `addHallImage` validated only the storage path. Mitigated in other layers (CSP `img-src`, `next.config.ts` allow-list) — neither in that function's control, and the url is also read by the sitemap and structured-data feed where no CSP applies. Now **derived** from the storage path, with a database constraint as the second layer. | **Fixed** (0083, `9ca76c5`) |
| WEB-1 | The upload validator only read things the uploader chose: `file.type` and the filename extension are both client-declared. `sniffImageType` now reads the first bytes and the upload stores the **sniffed** content type. | **Fixed** (`9ca76c5`) |
| LOGIC-8 | The customer's phone reached the venue at checkout **start**, rendered as a clickable `tel:` link on a card badged "Payment Pending". A customer who reached the payment page and changed their mind had handed the venue their number. The lead flow already draws this line correctly; the booking flow never had the equivalent gate. | **Fixed** (`03b7b6e`) |
| AUTH-7 | All fourteen `profiles` columns were client-updatable. The one that matters is `email`: it is a copy of `auth.users.email`, is shown in the admin user list, and is recorded as `actor_email` on every audit entry — so a user could attribute their own actions to somebody else's address in the log that exists to say who did what. Sign-in is unaffected, so the damage is to the record, not to access. | **Fixed** (0084) |
| AUTH-2 | A suspended user was caught in a `/login` ↔ dashboard redirect loop, so the `account_disabled` message could never render and they saw only a browser redirect error. | **Fixed** (`92dcdf0`) |
| OTP-4 | The OTP was bound to the phone only, not to the requesting session. Substantially closed by OTP-2's send-binding: a check is now only allowed for a number this account requested a code for. | **Fixed** (`2607b2b`) |
| API-1 | `createBookingRequest` had no `booking_mode` gate, so a customer could open a paid direct booking on a `LEAD_GENERATION` venue. | **Fixed** (pre-remediation) |
| API-2 / AUTH-3 / PRIV-2 / PAY-1 | `checkCommissionPaymentStatus` verified and settled any `HNC_` order without matching it to the caller, unlike its two sibling paths. | **Fixed** (pre-remediation) |
| LOGIC-2 | Booking-cancellation side effects (calendar release, refund record, notifications) live only in the server action, so a direct database status change skips them. **Accepted:** the only parties who can make that change are the trusted backend and an admin, and the admin screens go through the action. Worth folding into a trigger if a fourth writer ever appears. | **Accepted** |
| PAY-2 | Stale-but-`ACTIVE` commission and plan orders are retired locally while still payable at Cashfree. | **Open** |
| WEB-3 | The CSP keeps `'unsafe-inline'` and `'unsafe-eval'` in `script-src`, so the policy provides no XSS containment. **Accepted:** Next's runtime and the Cashfree SDK both require them, and claiming otherwise would break checkout. A nonce-based policy is the named follow-up. | **Accepted** |

---

## 6. Informational

Fixed in passing because each was cheap: **WEB-5** (`X-Powered-By` removed),
**WEB-6** (HSTS `preload` deliberately absent and now documented as a decision
rather than an omission), **WEB-7** (admin search used a character blocklist on
the PostgREST `or()` filter where `lib/halls.ts` had already adopted quoting for
the public search — the blocklist also silently mangled ordinary searches),
**WEB-8** (one raw PostgREST error reached the client), **WEB-4** (no Origin
check on maintenance POSTs — defence in depth only: the session cookies are
`SameSite=Lax`, which does not attach cookies to a cross-site POST at all),
**API-8** (maintenance routes checked role but never `is_active`), **API-6**
(error-text pass-through), **OTP-7** (ceiling messages acted as a weak oracle
about other accounts' activity on a number — now one identical message).

Accepted with reasons recorded: **PAY-5** (no webhook timestamp-freshness
window; replay is idempotent because state is re-read from Cashfree, and the
design choice is now written down), **OTP-3** (the check-side guard is
read-then-act, so parallel requests can slightly exceed the ceiling — bounded,
and against a million-value code space it changes nothing), **LOGIC-9** (OTP
ceilings fail *open* when a counter cannot be read — deliberate: a rate-limit
table that cannot be read must not lock a real user out of their own code),
**AUTH-6** (the signup role is client-supplied metadata; `owner` yields
`owner_approved` by design and `admin` is rejected), **AUTH-8** (session cookies
are not `HttpOnly` — the Supabase SSR default), **PRIV-7** (an owner can move
their own approved hall back to draft — that is theirs to do).

Open and carried to the remediation plan: **AUTH-4** (there is no password
reset or password change flow anywhere in the product — a product gap, not a
vulnerability, but one a launched marketplace cannot go without), **AUTH-5**
(single admin account, no MFA), **OTP-5** (the admin alert SMS budget has no
per-account ceiling; partially mitigated now that contact alerts are bucketed),
**OTP-6** (no country allowlist on OTP destinations), **LOGIC-4** (account
deletion anonymises the profile but leaves personal data in `leads`,
`bookings.contact_phone` and contact messages), **LOGIC-10**, **LOGIC-11**,
**PRIV-6**, **API-7**, **API-9**, **AUTH-9**.

---

## 7. False positives, retained for transparency

Two reviewer findings were refuted by their verifier: both described code that
had already been fixed earlier in the same session, so the reviewer was reading
a stale dossier rather than the tree. They are listed here because a report
that silently drops what it got wrong is not a report anybody can calibrate
against.

A third deserves its own note. A reviewer rated the TRUNCATE grant issue
**Medium (CVSS 6.8)**. The verifier reproduced every fact, corrected the
exposed set from 22 tables to 24, and then **refused the score**: a finding
whose precondition is "a SQL-execution primitive that does not exist" does not
carry `I:H/A:H` today. It is reported at Low as grant hygiene. That exchange is
the clearest example of the adversarial pass doing its job, and the severity in
this ledger is the verifier's, not the reviewer's.

---

## 8. What was NOT tested, and why

Stating this plainly matters more than the coverage it admits.

- **The owner-paid commission settlement, end to end.** A real commission order
  was opened in production (`HNC_…`, status `created`, 0 webhook events) but
  the owner did not complete the payment, so settlement and its webhook were
  never observed. The code path was read; it was not exercised.
- **Any real financial transaction.** Not authorised, and not performed.
- **Cashfree Payouts beneficiary registration against the live API.** Doing so
  would create a real beneficiary in Hallnect's production Payouts account.
  CRIT-1 was established by reading the chain end to end and by the live grant
  and schema state, not by calling Cashfree.
- **Load, denial-of-service or availability testing.** Explicitly out of scope.
  The two DoS-shaped findings (API-5, OTP-2) were established from the code and
  the ceilings, never by flooding anything.
- **Third-party infrastructure** — Cashfree, MSG91, Supabase, Vercel.
- **A staging environment.** There is none. Production was assessed read-only,
  with every database probe inside a `DO` block terminated by
  `RAISE EXCEPTION`, and row counts verified unchanged afterwards.

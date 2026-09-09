# Scheduled jobs

Three maintenance sweeps run on **Vercel Cron**, configured in `vercel.json`.
All are idempotent and safe to run repeatedly — re-running one is never
harmful — and all are also runnable on demand from the admin dashboard.

| Job | Path | Schedule (UTC) | IST |
|---|---|---|---|
| Expire unanswered booking requests | `/api/admin/bookings/expire-overdue` | `30 3,7,11 * * *` | 09:00, 12:30, 16:30 |
| Expire lapsed premium listings | `/api/admin/premium/expire-listings` | `15 0 * * *` | 05:45 |
| Reconcile open owner payouts | `/api/admin/payouts/reconcile` | `*/15 * * * *` | every 15 min |

The times are deliberate. The booking sweep sends a cancellation and refund
notice, so it lands at a civil hour in Tamil Nadu rather than the middle of the
night. The premium sweep sends nothing, and runs just after the UTC date rolls
over — `end_date < current_date` is evaluated in UTC, so running at 00:15 UTC
retires a lapsed plan within about fifteen minutes of its window truly closing,
instead of leaving it promoted for most of another day.

> The **overdue commission sweep** that used to hold the second slot was removed
> along with the owner-billed commission model. Hallnect retains its commission
> from the customer's advance at settlement, so no owner is ever invoiced,
> nothing can fall overdue, and there is nothing to sweep. The premium expiry
> job took the freed slot.

## What they do

**Expire lapsed premium listings.** Deactivates `premium_listings` rows past
their `end_date` and clears any `halls.premium_tier` left set with no live
listing behind it. This closes a real hole: `recompute_hall_premium()` is
date-aware but only ever ran as a REACTION TO A WRITE on `premium_listings`,
and nothing was scheduled — so once a window closed the hall stayed promoted in
search, on the homepage and in the `?category=premium` filter **indefinitely**,
while `/admin/premium-listings` and `/owner/premium` recomputed the window in
JS and correctly showed it as Expired. An owner could pay for one month and be
boosted forever.

**Expire unanswered booking requests.** A booking the venue never answers
inside its 48-hour window is cancelled, the customer is refunded in full —
platform-caused, so the ₹200 fee goes back too — the calendar dates are
released, and all three parties are notified. Without this an ignored request
holds the customer's money and blocks those dates against every other customer
indefinitely. The cancel is status-guarded, so an owner accepting at the same
moment wins and the sweep skips that booking.

## Authorization

Both routes accept **GET** (what Vercel Cron sends) and **POST**, and they
authorize the two verbs *differently* on purpose:

* **GET → the cron secret only.** Both sweeps mutate data. A GET that mutates
  is reachable by CSRF: an admin merely visiting a page containing
  `<img src="https://hallnect.com/api/admin/bookings/expire-overdue">` would
  fire it. A browser never attaches an `Authorization` header cross-origin, so
  requiring the bearer token closes that off completely.
* **POST → the cron secret *or* an admin session.** A cross-origin POST cannot
  be issued silently with credentials the way an image load can.

If `CRON_SECRET` is **unset**, the header path is disabled entirely — there is
no empty-secret bypass. That also means **the cron jobs will 401 on every run
without it**, which is the single most likely reason for a job that appears to
be scheduled but never does anything.

Vercel sets `Authorization: Bearer $CRON_SECRET` on cron invocations
automatically once the variable exists on the project; nothing needs to be
configured on the cron itself.

## Plan limits

**The team moved to Vercel Pro on 2026-09-09** (verified against the live
account: team `loadnect-wqs-projects`, plan `pro`). That lifted the two
constraints this file used to be written around — the two-job cap, and the
once-per-day minimum interval with up to 59 minutes of jitter. Schedules are now
per-minute and land within the specified minute.

What that changed, and what it did not:

* A booking request can sit up to roughly **56 hours** before it is swept — its
  own 48-hour deadline, plus up to 8 hours until the next run, down from ~72
  hours on a single daily slot. The deadline itself is still enforced
  immediately: `acceptBooking` refuses the moment the window closes, so no owner
  can accept late even before the sweep catches up.
* The booking sweep runs three times inside Tamil Nadu waking hours rather than
  hourly, and that is a product decision, not a scheduling one: **it sends SMS**.
  A cancellation and refund notice at 03:00 IST is worse than one that waits.
* A premium plan can still outlive its window by up to a day. The sweep sends
  nothing and activation is immediate either way — a purchase writes
  `premium_listings` and the AFTER trigger recomputes the tier on the spot — so
  the delay only ever errs in the paying owner's favour. Left at once daily
  deliberately; there is nothing to gain.
* **Cron delivery is best effort.** Vercel does not retry a failed invocation,
  can occasionally invoke the same run twice, and an Instant Rollback does not
  update active cron jobs. That is why the booking sweep still calls
  `reconcileOpenPayouts(10)` inline as a backstop even though payouts now have
  their own schedule — one delivery path on a best-effort transport is not
  enough for money.
* **A cron pointed at a path that does nothing still reports success.** Vercel
  invokes the path and records the response; a 200 from a stub is
  indistinguishable from real work on the dashboard. See the payout reconcile
  section below for the concrete instance of this.

## Overdue refunds — folded into the booking sweep

**No separate cron, and that is still deliberate** — though the reason has
changed. It was a hard constraint (Hobby capped the project at two cron jobs and
`vercel.json` already held two, so a third entry failed the BUILD). Now it is a
judgement: the report counts refunds that the expiry sweep itself has just
created, so running it anywhere else would report stale numbers.

It is safe at three runs a day because the alert dedupes on
`refunds.overdue:<IST date>` (`lib/refund-sla.ts`) — the admin still gets exactly
one SMS per day, not three. Every SMS is billed and shares the admin's per-phone
hourly ceiling with the payout-failure alerts, so that key is load-bearing.

It runs **last** in that route, after the expiry sweep. That ordering matters:
the sweep cancels unanswered bookings and records their refunds, so reporting
afterwards counts this morning's new refunds in this morning's report instead of
letting them wait until the next run to be noticed.

**What it does:** `reportOverdueRefunds()` in `lib/refund-sla.ts` reads payments
with `refund_state in ('owed','failed')` and `refund_amount > 0`, and flags

- anything owed longer than `REFUND_OVERDUE_DAYS` (4 calendar days), and
- every `failed` row **at any age** — a failed refund is not waiting on a clock,
  it is one that was attempted and did not land, so each day it sits is a day
  nobody knows the customer has not been paid.

`REFUND_OVERDUE_DAYS` is derived from the published window, not picked.
`/refund-policy` §8 promises **5–7 business days**, roughly 7–11 calendar days
depending on where the weekend falls. The alarm has to fire while that window
can still be kept — an alert on day 12 is a post-mortem, not a warning. Four
calendar days is about three business days, leaving two to four business days of
the promise still available. **If §8 changes, this changes.**

**It reports and never pays.** `issueRefund()` remains the only code that calls
Cashfree, because it is the only place with the double-spend guard and the audit
trail. A sweep that could move money on a timer is a different risk profile, and
not one worth taking to save a click.

**One SMS, never one per refund.** Every message is billed, and a backlog of
twenty would otherwise send twenty and exhaust the admin's own per-phone hourly
ceiling — which the payout-failure alerts share. The alert is keyed
`refunds.overdue:<date in IST>`, so a retry within the day is a no-op. When
nothing is overdue it sends nothing and logs the zero.

**Ageing accuracy.** `payments.refund_owed_at` (migration 0053) is stamped in
the same write that sets `refund_state='owed'`, so the clock starts exactly when
the debt does. Rows written before 0053 have no stamp and fall back to
`updated_at`, which is a **proxy**: any later touch resets it, so those refunds
read younger than they are. That errs toward under-reporting, which is the wrong
direction — but it is bounded to pre-0053 rows and beats not checking them.

## Payout reconciliation — every 15 minutes, and the stub that nearly broke it

`/api/admin/payouts/reconcile` asks Cashfree what happened to every transfer
that is not yet final. It is **read-only against Cashfree** — it cannot move
money, only record what already happened — which is what makes it safe to run
unattended and safe to retry.

**Why it needs a fast clock.** A Cashfree Payouts transfer is asynchronous:
`RECEIVED`, `QUEUED` and `PENDING` are the normal path,
`SCHEDULED_FOR_NEXT_WORKINGDAY` is a documented PENDING code, and NEFT does not
run on Sundays. While a transfer is unresolved, `payments.split_status` reads
`in_flight` — and that is precisely what `issueRefund` refuses to act on. So a
slow *owner payout* freezes a *customer's* refund. On the old once-nightly
piggyback that window was up to ~24 hours; it is now ~15 minutes.

It also samples the reversal window properly. Cashfree can REVERSE a transfer
after SUCCESS (`BENE_NAME_DIFFERS`, `ACCOUNT_BLOCKED`,
`RETURNED_FROM_BENEFICIARY`), typically within ~24h, so settled rows stay in the
sweep for 48h. Once a day sampled that window about twice and could miss a
reversal at the boundary entirely — leaving `split_status='done'` with the owner
unpaid and the customer's refund blocked forever.

**The stub.** Vercel Cron invokes with **GET**. This route's GET used to be a
health probe whose own docstring said "It reconciles nothing and reveals
nothing." Scheduling the path without first writing a real GET would have
produced a green Cron Jobs dashboard, `200 {"ok":true}` in the runtime logs, and
zero reconciliation, indefinitely. The GET is now secret-only and does the work;
POST keeps the admin-session path for the on-demand button.

GET is **CRON_SECRET only, never a session** — it mutates
`payments.split_status`, so an `<img src="…/reconcile">` on any page an admin
visits must not be able to fire it. Same rule as the other two sweeps.

**Two ordering bugs were fixed at the same time**, because a 15-minute cadence
turns both from latent into certain (`lib/payout-dispatch.ts`):

* `settled_at` was re-stamped on *every* reconcile, not just the first
  settlement. Since the sweep includes `SUCCESS` rows whose `settled_at` is
  within 48h, those rows refreshed their own eligibility forever and never aged
  out.
* The sweep ordered by `created_at ASC LIMIT 50`. Combined with the above, the
  50 oldest rows — permanently-resident settled ones, plus any `UNKNOWN_LOCAL`
  whose transfer Cashfree never resolves — occupied every slot, and a newly
  dispatched transfer might never be asked about at all. It now orders by
  `last_checked_at ASC NULLS FIRST`, so `limit` is a throughput cap again and
  every open transfer is reached within `ceil(open / limit)` runs.

`dispatched_at` was likewise being overwritten on every reconcile, which made
"how long has this been in flight?" unanswerable. It is now written by the
dispatch path only.

**Audit rows: on work, plus a daily heartbeat.** The route writes an
`admin_audit_log` row with action `cron.payouts_reconcile` whenever a run
checked something or hit an error, and otherwise at most one row per 23 hours
saying "ran, nothing open" (`metadata.heartbeat = true`).

The heartbeat is not decoration. Gating the row on `checked > 0` alone is
useless exactly when it matters most: before the first booking there are no
payouts, so every run finds nothing, the row is never written, and an empty
audit log means — indistinguishably — the cron never ran, it ran and got a 401
because `CRON_SECRET` is unset, it ran and found nothing, or the path 404s.
**So the first thing to check after deploying this is that a
`cron.payouts_reconcile` row appears within a day**, even with zero bookings.
If it does not, the cron is not reaching the route.

## Running one now

From the admin dashboard (both have a button), or by hand:

```bash
curl -X POST https://hallnect.com/api/admin/bookings/expire-overdue \
  -H "Authorization: Bearer $CRON_SECRET"
```

`CRON_SECRET` is stored in Vercel as a **Sensitive** variable, so its value
cannot be read back — from the dashboard or the CLI. To run the command above,
set a new value (which rotates it) and use that. The cron jobs keep working
either way, since Vercel injects whatever the current value is.

## Verifying

`vercel crons ls` lists what is deployed. A successful run logs a one-line JSON
summary — `[bookings:expire-overdue]` or `[premium:expire-listings]` — visible in the Vercel runtime logs, including how many rows it touched.

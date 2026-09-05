# Scheduled jobs

Two maintenance sweeps run on **Vercel Cron**, configured in `vercel.json`.
Both are idempotent and safe to run repeatedly — re-running one is never
harmful — and both are also runnable on demand from the admin dashboard.

| Job | Path | Schedule (UTC) | IST |
|---|---|---|---|
| Expire unanswered booking requests | `/api/admin/bookings/expire-overdue` | `30 3 * * *` | 09:00 |
| Expire lapsed premium listings | `/api/admin/premium/expire-listings` | `15 0 * * *` | 05:45 |

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

This project is on Vercel's **Hobby** plan, which allows **2 cron jobs, once
per day each**. Both slots are used. Two consequences worth knowing:

* A booking request can sit up to roughly **72 hours** before it is swept — its
  own 48-hour deadline, plus up to 24 hours until the next daily run. The
  deadline itself is still enforced immediately: `acceptBooking` refuses the
  moment the window closes, so no owner can accept late even before the sweep
  catches up.
* A premium plan can outlive its window by up to a day in the worst case, since
  the sweep runs once. Activation is immediate either way — a purchase writes
  `premium_listings` and the AFTER trigger recomputes the tier on the spot — so
  the delay only ever errs in the paying owner's favour.
* Adding a third scheduled job means upgrading to Pro, or folding the work into
  one of the existing two. **Both slots are full, and this is enforced at deploy
  time, not at run time**: a `vercel.json` carrying three `crons` entries is
  rejected on Hobby and the deployment fails outright. Confirmed against the
  live account — team `loadnect-wqs-projects`, plan `hobby`. So "just add
  another cron" is never a safe edit here; check the plan first.

## Overdue refunds — folded into the nightly booking sweep

**No separate cron, and that is deliberate.** This project is on the Vercel
Hobby plan, which caps a project at **two** cron jobs, and `vercel.json` already
holds exactly two. Vercel rejects an over-cap `vercel.json` at BUILD time, so a
third entry does not add a job — it fails the deployment. The report therefore
runs inside `/api/admin/bookings/expire-overdue`, the job that already runs
daily and that already creates the refunds being counted.

It runs **last** in that route, after the expiry sweep. That ordering matters:
the sweep cancels unanswered bookings and records their refunds, so reporting
afterwards counts this morning's new refunds in this morning's report instead of
letting them wait a day to be noticed.

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

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

## Not scheduled yet — the refund SLA has no timer

**This job does not exist.** It is written down here because the promise it
would keep is already published, and the gap is worth being explicit about
rather than rediscovering during a complaint.

`/refund-policy` tells customers that approved refunds are "processed within
7–10 business days". Nothing in the system counts those days. `recordBookingRefund`
(lib/refunds.ts) marks `payments.refund_state = 'owed'` and stops there —
deliberately, because it records what is due rather than moving money — and
sending it is `issueRefund()`, a **button an admin has to remember to press**.
There is no queue, no ageing, no reminder. A refund missed on the day it is
owed is missed silently and indefinitely, and the customer is the only party
who notices.

### What the job should do

A route at `app/api/admin/refunds/report-overdue/route.ts`, modelled on
`app/api/admin/premium/expire-listings/route.ts` — same shape, same two verbs,
same `hasValidCronSecret` split (GET = secret only; POST = secret or an admin
session), `runtime = "nodejs"`, `dynamic = "force-dynamic"`.

It **reports; it must not pay.** Sending money without a human is a much larger
decision than closing this gap, and `issueRefund()` stays the only path that
calls Cashfree.

1. Read, with the service-role client, `payments` where
   `refund_state in ('owed','failed')` and `refund_amount > 0`, joined to the
   booking for the customer and hall.
2. Age each row. `payments` has no `refund_owed_at`, so the workable proxy is
   `updated_at`: `recordBookingRefund` is the write that sets `'owed'`, and
   nothing else touches the row until `issueRefund` moves it to `'processing'`.
   A dedicated `refund_owed_at` column would be exact, and is the right
   follow-up if this ever needs to be defensible rather than merely useful.
3. Flag anything owed for **more than 5 calendar days** (`REFUND_OVERDUE_DAYS`),
   plus every `'failed'` row regardless of age — a failed refund is already
   past its promise and needs a human either way. Five is chosen to fire
   *before* the published window closes, not after: 7 business days is 9–11
   calendar days, so a five-day alarm leaves several days to act while the
   promise can still be kept.
4. If nothing is overdue, send nothing and log the zero. An alert that arrives
   daily saying "all clear" is an alert nobody reads.
5. Otherwise send ONE `ADMIN_ALERT` via `notifyAdminOperational`
   (lib/notifications/events.ts) — one summary, never one message per refund,
   because MSG91 is billed per SMS and a backlog of twenty would send twenty:

   ```ts
   // formatAmount from "@/lib/notifications/templates"
   await notifyAdminOperational({
     // Date in the key so the outbox dedupe allows one alert per day and
     // suppresses retries within it.
     key: `refunds.overdue:${todayInBusinessTz()}`,
     eventType: "refunds.overdue",
     event: "Refunds overdue",
     details: `${count} refund(s) totalling ${formatAmount(total)} owed for more than ${REFUND_OVERDUE_DAYS} days`,
     reference: "See /admin/payments",
   });
   ```

6. Log a one-line JSON summary as `[refunds:report-overdue]`, matching the
   other two sweeps.

### How to schedule it

Not by adding a third `crons` entry — see the plan limit above; that fails the
deploy. Two options, both an owner decision:

* **Free, and preferred.** Fold the check into
  `/api/admin/bookings/expire-overdue`, which already runs daily at a civil
  hour and already creates the refunds in question. Run the sweep first and the
  report second, so refunds created by this morning's expiries are counted in
  this morning's report. `vercel.json` needs no change at all.
* **Upgrade to Pro**, then add the entry — `0 4 * * *` (09:30 IST), half an hour
  after the booking sweep, for the same ordering reason.

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

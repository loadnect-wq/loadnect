# Scheduled jobs

Two maintenance sweeps run on **Vercel Cron**, configured in `vercel.json`.
Both are idempotent and safe to run repeatedly — re-running one is never
harmful, and both are also runnable on demand from the admin dashboard.

| Job | Path | Schedule (UTC) | IST |
|---|---|---|---|
| Expire unanswered booking requests | `/api/admin/bookings/expire-overdue` | `30 3 * * *` | 09:00 |
| Overdue commission sweep | `/api/admin/commissions/run-overdue-check` | `30 4 * * *` | 10:00 |

The times are deliberate: the messages these jobs send (a cancellation and
refund notice, an overdue-commission notice) land at a civil hour in Tamil
Nadu rather than the middle of the night, and the two run an hour apart so they
never contend for the same booking rows.

## What they do

**Expire unanswered booking requests.** A booking the venue never answers
inside its 48-hour window is cancelled, the customer is refunded in full —
platform-caused, so the ₹200 fee goes back too — the calendar dates are
released, and all three parties are notified. Without this an ignored request
holds the customer's money and blocks those dates against every other customer
indefinitely. The cancel is status-guarded, so an owner accepting at the same
moment wins and the sweep skips that booking.

**Overdue commission sweep.** Marks owner-billed commissions overdue past their
due date and applies the one-time settlement adjustment. Never double-deducts.

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
* Adding a third scheduled job means upgrading to Pro, or folding the work into
  one of the existing two.

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
summary — `[bookings:expire-overdue]` or `[commissions:run-overdue-check]` —
visible in the Vercel runtime logs, including how many rows it touched.

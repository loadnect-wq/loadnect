# Inventory: offline bookings and real-time availability

How a date stops being sellable on Hallnect, who is allowed to make that happen,
and why two people cannot claim it at once.

---

## The problem this solves

A venue takes a booking over the phone. Until they can record it, Hallnect keeps
offering that date online — and eventually sells it twice. The owner needs to be
able to say "this is gone" and have it take effect immediately, everywhere.

## The shape of the inventory

The resource is **hall + date + slot**, and it already had a table:

```
availability(hall_id, date, slot, status)   UNIQUE (hall_id, date, slot)
```

`slot` is `morning | evening | full_day`. A `full_day` claim conflicts with both
halves; each half conflicts with itself and with `full_day`.

Two things can hold a date:

| Holder | Where it lives | Written by |
|---|---|---|
| A Hallnect booking | `bookings` (active statuses) + `availability` rows stamped with `booking_id` | the payment flow |
| An offline booking | `offline_bookings` + `availability` rows stamped with `offline_booking_id` | `create_offline_booking` |
| A platform block | `availability` alone (`blocked`, `maintenance`) | Hallnect only — see Permissions |

---

## The race, and why the obvious fixes do not close it

Before this work the database enforced **booking vs booking** — `uq_booking_active_slot`
and `prevent_overlapping_booking` — and enforced **nothing** between a booking and
an availability block. `checkSlotAvailability` (lib/availability.ts) is an
application-level check-then-insert, so:

```
owner:    check availability → free
customer: check availability → free
owner:    write block          ✓
customer: write booking        ✓        ← both succeeded
```

Two things that do **not** fix this:

- **A unique index.** The two claims live in different tables. No index spans them.
- **Two triggers checking each other.** Uncommitted rows are invisible across
  transactions, so both transactions still pass their check and both commit.

## What does close it

An **advisory transaction lock**, taken by both paths before either checks:

```sql
-- assert_inventory_free(), migration 0057
while d <= _to loop
  perform pg_advisory_xact_lock(inventory_lock_key(_hall_id, d));
  d := d + 1;
end loop;
-- ...then check bookings, then check availability
```

- Keyed on **(hall, day)**, not (hall, day, slot). A `full_day` claim conflicts
  with a `morning` one, so slot-level locks would let those two run concurrently
  and both pass. The day is the smallest unit containing every conflict.
- Days are locked **ascending**, which is what makes two overlapping ranges
  deadlock-free.
- The lock is held **until commit**, so the loser blocks and then sees the
  winner's committed row instead of stale state.

Both directions are wired to it:

| Trigger | On | Guards |
|---|---|---|
| `trg_guard_booking_against_blocks` | `bookings` | a booking becoming active against any block |
| `trg_guard_block_against_bookings` | `availability` | any block against an active booking |

The availability-side trigger matters more than it looks: it also covers a
**direct** owner write through `setAvailability`, which reaches the table via
PostgREST and would otherwise bypass every check.

Rows carrying a `booking_id` are skipped by that trigger — they are the *result*
of a booking, not a competing claim on it, which is what lets the payment flow
mark the calendar for the booking it just confirmed.

### Verified, not assumed

Both directions were tested against the live database with two genuinely
parallel HTTP requests (separate connections, separate transactions):

```
full_day block ‖ morning block   → one committed, one got 23P01 INVENTORY_TAKEN
online booking ‖ owner block     → booking committed, block refused
```

The first pair is the interesting one: different slots on the same day do **not**
collide on the unique index, so only `assert_inventory_free` can catch them.

Also confirmed: a `pending_payment` booking is still allowed on a free day. A
hold claims no inventory — that is what the 20-minute expiry is for — and
checking it would have broken checkout.

---

## Privacy: two halves, one public

`availability` is **publicly readable** for approved halls; that is how the
customer calendar works. So it carries only `(hall_id, date, slot, status)` plus
two opaque uuids.

The identifying half of an offline booking — name, phone, notes — lives in
`offline_bookings`, whose only policy is `owns_hall(hall_id) OR is_admin()`.
That customer never agreed to appear on Hallnect at all.

This is also why **realtime publishes `availability` and not `bookings`**.
Publishing `bookings` would have been the shortcut and a data leak: every
subscriber would receive `customer_id`, `contact_phone`, the amounts and the
notes on every change.

### The INSERT bug, and the fix

`REPLICA IDENTITY FULL` is set, but **not** for the reason first written here. It
does *not* make a DELETE carry `hall_id`: Supabase cannot evaluate RLS against a
deleted row, so on an RLS-enabled table it broadcasts only the primary key
whatever the replica identity. It is kept because the alternative was measured
and is worse — with `DEFAULT`, the subscription received **nothing at all**.

**The defect.** An anonymous subscriber received DELETEs but **not** INSERTs, even
with no filter. Realtime evaluates the SELECT policy against the candidate row
before delivering an insert, and `availability_select` was a correlated subquery
into `halls` plus two SECURITY DEFINER calls. That does not survive Realtime's
evaluation context, so the row was dropped. Exactly the wrong half worked: a
*released* date appeared, a newly *blocked* one did not — and a date going off
sale is the one a customer must not miss.

**The fix (0062)** is `availability.is_public`, denormalised from `halls.status`
by trigger, so the read policy short-circuits on a row-local boolean:

```sql
using (is_public or owns_hall(hall_id) or is_admin())
```

Not a widening — the same rows are admitted, only the shape changed. Measured
afterwards from a real client: INSERT, UPDATE **and** DELETE all delivered.

The **60-second floor** in `useLiveAvailability` is kept anyway, at a far lower
price than the defect it used to paper over: sockets drop, phones suspend them,
and convergence should not depend on someone else's evaluator continuing to
behave.

---

## Real-time, and why it is not the safety mechanism

`useLiveAvailability(hallId)` subscribes with a `hall_id` filter, so a visitor on
one venue's page receives only that venue's changes. It is mounted on the venue
page, the booking flow **and** the owner's calendar.

**Both directions ride one table**, because every kind of claim lands in
`availability`:

| Event | Writer | Who learns |
|---|---|---|
| owner blocks a date | `create_offline_booking` inserts rows | customers watching the venue |
| customer pays | `blockAvailability()` upserts rows | the owner's calendar |
| booking cancelled | `releaseAvailabilityForBooking()` deletes rows | both |

Verified in a browser against the live database with the page left alone — no
reload, no interaction: blocking 22 September turned the venue page's calendar
cell unavailable within 10 seconds, and releasing it turned the cell back within
10 seconds, while other blocked dates stayed blocked.

**It never applies the event payload.** An event is a trigger to *re-read*:

```
event / reconnect / tab becomes visible
        ↓  (debounced 400ms)
router.refresh()
        ↓
server re-reads the authoritative window
```

Payloads arrive out of order, are missed entirely while the socket is down, and
carry only the changed row rather than the derived per-day picture the calendar
renders. Re-reading is slower and correct.

Re-subscribing also re-reads, which is the reconnect path: whatever changed while
the socket was down was never delivered, and this closes the gap without needing
to know what was in it. A `visibilitychange` listener covers a backgrounded tab,
because phones suspend sockets aggressively.

**None of this is what prevents a double booking.** A customer looking at a stale
screen is refused at checkout by `assert_inventory_free`, under the lock.
Realtime exists so that refusal is rare — not so the calendar can be trusted.

---

## Owner workflow

**Owner dashboard → the venue → Availability → tap a date → Block → done.**

There is no list of every available date to maintain, and **no Save button**. The
old screen was a 45-row × 3-column table where each cell cycled through eight
statuses and nothing persisted until a global Save — an owner hand-maintaining an
answer the database already held, on a screen that was a lie until pressed. It is
gone, along with `setAvailability`.

1. The month grid shows what HOLDS each date, derived from the booking records.
   Legend, with text labels and never colour alone: **Free**, **Online booking**,
   **Offline booking**, **Blocked by Hallnect**.
2. Tap a date → a sheet. The slot defaults to Full day; the halves are offered
   only while they are free. "Also block until" covers a multi-day event.
3. Customer name, phone, reference and notes are all **optional** — the point is
   that the date stops being sellable, and requiring details first would mean an
   owner who took the call on a bad line either invents them or leaves the date
   open.
4. **Block this date** writes immediately. The database decides under the lock;
   the form does not pre-check, because a pre-check *is* the check-then-act race.
   The request carries a `client_token`, so a retry over a flaky connection
   returns the ORIGINAL booking rather than a duplicate — or, worse, an
   `INVENTORY_TAKEN` raised by its own first attempt.
5. **Release** puts the dates back, immediately. The availability rows are deleted
   rather than set to `available` — absence is what this schema means by
   available, and deleting cannot resurrect a platform block that predated the
   offline booking, because those rows carry no `offline_booking_id`.

A **green date is not a reservation**: it means no claim existed when the page was
drawn. The screen says so, because the honest answer is that checkout decides.

Both operations write an audit entry **from inside the RPC**. They have to:
`admin_audit_log`'s INSERT policy is `is_admin() OR is_trusted_backend()`, so a
`recordAdminAction()` call from an owner's session is refused — and that helper
swallows its errors, so it would have looked fine while recording nothing for the
exact role it is meant to watch. The entry records the dates and never the
customer's name or number.

---

## Permissions

| Role | Read availability | Read offline detail | Create / release offline |
|---|---|---|---|
| Anonymous | approved halls | ✗ | ✗ |
| Customer | approved halls | ✗ | ✗ |
| Owner | own halls + approved | own halls | own halls |
| Admin | all | all | all |

`offline_bookings` has **no client write policy at all**. Writes go through the
RPCs, which hold the lock; a direct insert would skip it and is refused. The RPCs
are `SECURITY DEFINER` and check `owns_hall(hall_id) OR is_admin()` from
`auth.uid()` as their first act.

**Since 0063, `availability` has no client write access either.** The old
`availability_write` policy was `FOR ALL USING (owns_hall OR is_admin)`, and the
guard trigger fires on INSERT OR UPDATE — not DELETE. So an owner could

```
DELETE /rest/v1/availability?booking_id=eq.<a paid booking>
```

and the date a customer had paid for went back on public sale. No double booking
resulted — checkout re-checks `bookings` under the lock — but the public calendar
lied, and a venue could grief its own confirmed customer.

INSERT, UPDATE and DELETE are now revoked from `anon` and `authenticated`
outright. Grants are checked *before* RLS and are not `is_admin()`-aware, so the
revoke is the real gate; the dropped policy is documentation. Every remaining
writer is the service role (the payment flow) or a SECURITY DEFINER RPC owned by
`postgres`, both of which bypass RLS.

This is why a bare `blocked` / `maintenance` row is shown to the owner as
**Blocked by Hallnect** with no Release button: after this change nothing an
owner controls can create one.

---

## Reproducing the concurrency test

Needs the service-role key (triggers fire for it; RLS does not). Pick a hall and
a free future date, then fire two conflicting claims in parallel:

```bash
curl -s -X POST "$URL/rest/v1/availability" -H "apikey: $SRV" -H "Authorization: Bearer $SRV" \
  -H "Content-Type: application/json" \
  -d '{"hall_id":"'$HALL'","date":"'$DAY'","slot":"full_day","status":"blocked"}' &
curl -s -X POST "$URL/rest/v1/availability" -H "apikey: $SRV" -H "Authorization: Bearer $SRV" \
  -H "Content-Type: application/json" \
  -d '{"hall_id":"'$HALL'","date":"'$DAY'","slot":"morning","status":"blocked"}' &
wait
```

Exactly one should return a row; the other should return `23P01` with
`INVENTORY_TAKEN`. Delete both rows afterwards.


---

## One vocabulary, not five

`offline_booked` was added in 0056 and taught to `assert_inventory_free` — the
function that actually prevents a double booking. It was **not** taught to the
four hardcoded status lists the application kept separately:

| Copy | Consequence of the omission |
|---|---|
| `lib/availability.ts` `HARD_BLOCK_STATUSES` | the customer's booking calendar offered the date |
| `lib/halls.ts` `FULL_BLOCK_STATUSES` | a search for that exact date still listed the hall |
| `HallDetailView.tsx` `FULL_BLOCK` | the public availability strip painted the date green |
| `offline-booking.test.ts` | a test named "including an offline booking" that did not include it |

So a venue could block a date and Hallnect would keep advertising it, letting a
customer walk the whole checkout before the database refused at the last step.
No double booking ever occurred — the database's list was complete. Every other
list was a lie about it.

Measured, not reasoned about: with live `offline_booked` rows on 10 and 11
September, the public venue page rendered both cells as available.

The vocabulary now lives once, in **`lib/availability-status.ts`**, which imports
nothing so a client component can share it with the server instead of restating
it.

---

## Migrations

| File | What |
|---|---|
| `0056_availability_offline_booked.sql` | the `offline_booked` status (own migration — Postgres forbids using a new enum value in the transaction that adds it) |
| `0057_inventory_arbiter.sql` | `inventory_lock_key`, `assert_inventory_free` |
| `0058_offline_bookings.sql` | the private table + RLS |
| `0059_inventory_guards.sql` | both triggers |
| `0060_offline_booking_rpcs.sql` | `availability.offline_booking_id`, create/cancel RPCs, and their audit writes |
| `0061_availability_realtime.sql` | publication + `REPLICA IDENTITY FULL` |
| `0062_availability_public_flag.sql` | `is_public`, so Realtime can evaluate the read policy; stops copying the owner's reference onto a public row |
| `0063_availability_rpc_only_writes.sql` | revokes client writes on `availability`; `client_token` idempotency |

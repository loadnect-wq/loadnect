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
| A manual block | `availability` alone (`blocked`, `maintenance`) | the owner's calendar |

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

`REPLICA IDENTITY FULL` is set on `availability` so a DELETE carries `hall_id`
in the payload. Without it a delete arrives with only the primary key — and a
date being *released* is exactly the event a watching customer must not miss.

---

## Real-time, and why it is not the safety mechanism

`useLiveAvailability(hallId)` subscribes with a `hall_id` filter, so a visitor on
one venue's page receives only that venue's changes.

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

1. **Owner dashboard → the venue → Availability**
2. **Offline bookings → Add**
3. Enter the dates and slot. Customer name, phone, reference and notes are all
   **optional** — the point is that the date stops being sellable, and requiring
   details first would mean an owner who took the call on a bad line either
   invents them or leaves the date open.
4. **Block these dates.** The database decides under the lock; the form does not
   pre-check, because a pre-check *is* the check-then-act race.
5. **Release** puts the dates back. The availability rows are deleted rather than
   set to `available` — absence is what this schema means by available, and
   deleting cannot resurrect a manual block that predated the offline booking,
   because those rows carry no `offline_booking_id`.

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

## Migrations

| File | What |
|---|---|
| `0056_availability_offline_booked.sql` | the `offline_booked` status (own migration — Postgres forbids using a new enum value in the transaction that adds it) |
| `0057_inventory_arbiter.sql` | `inventory_lock_key`, `assert_inventory_free` |
| `0058_offline_bookings.sql` | the private table + RLS |
| `0059_inventory_guards.sql` | both triggers |
| `0060_offline_booking_rpcs.sql` | `availability.offline_booking_id`, create/cancel RPCs, and their audit writes |
| `0061_availability_realtime.sql` | publication + `REPLICA IDENTITY FULL` |

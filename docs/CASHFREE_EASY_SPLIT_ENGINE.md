# Cashfree Easy Split — Settlement Engine

**Status:** Foundation implemented (2026-08-15). Live vendor-split dispatch is
**feature-flagged off** until Cashfree Easy Split credentials exist.

## Design decisions (agreed)
- **Paise ledger alongside** the existing rupee-`numeric` booking model. The new
  ledger tables store **integer paise** and never touch `bookings`/`payments`/
  `commissions`. No existing money column was migrated.
- **Interfaces first, live split stubbed** behind `CASHFREE_EASY_SPLIT_ENABLED`.
  Everything is build-verifiable except the live Cashfree Easy Split API call,
  which is a documented `TODO(easy-split)` in `lib/settlement.ts`.

## Money representation
- ₹1 = **100 paise**. All engine amounts are `bigint` paise with `CHECK (>= 0)`.
- Split math (`lib/money.ts` → `computeCommissionSplit`) is integer-only:
  `commission = floor(gross * rate% / 100)`, `owner = gross − commission`.
  Guarantees: `commission ≥ 0`, `owner ≥ 0`, `commission + owner === gross`.
- `formatPaise` / `toPaise` / `fromPaise` handle display and conversion; math is
  never done on the rupee float.

## Schema (migration `0018_settlement_engine.sql`, additive + idempotent)
- `hall_owners`: `cashfree_vendor_id`, `vendor_kyc_status`
  (`NOT_CONNECTED | PENDING | VERIFIED | SUSPENDED`).
- `payment_transactions`: gross/commission/owner **paise**, `commission_rate`
  snapshot, `cashfree_order_id` (unique), `payment_status`, `split_status`,
  `settlement_status`; `CHECK (commission + owner <= gross)`.
- `payment_webhook_events`: `UNIQUE(provider, event_id)` idempotency + audit.
- `commission_transactions`, `settlement_transactions`: platform-earnings and
  vendor-payout ledgers (paise), one row per payment transaction (unique).
- RLS: customer reads only own `payment_transactions`; owner reads own
  payment/commission/settlement rows; admin full; webhook events admin-only;
  writes admin/trusted-backend only (RLS + `guard_ledger_writes` trigger).

## Booking → settlement state machine
`PAYMENT_PENDING → PAYMENT_SUCCESS → SPLIT_PROCESSED → SETTLEMENT_PENDING →
SETTLED`, tracked across `payment_status` / `split_status` / `settlement_status`.
Booking is only confirmed after **server-side** verification (never on a client
success redirect) — unchanged from the existing webhook.

## Routes / libs
- `POST /api/payments/checkout` — server-authoritative. Input is **`bookingId`
  only**; gross/commission/owner/vendor are resolved from the DB (zero frontend
  trust), the paise ledger row is created idempotently, and a live split is
  dispatched only when the flag is on. IDOR-guarded (booking must belong to the
  caller).
- `lib/settlement.ts` — `resolveSplitForBooking`, `submitSplitOrder` (flagged),
  `recordWebhookEvent` / `markWebhookProcessed` (idempotency).
- `lib/money.ts` — pure paise helpers.

## Enabling live Easy Split later
1. Enable Easy Split on the Cashfree account; onboard each owner as a **vendor**,
   store the returned id in `hall_owners.cashfree_vendor_id`, set
   `vendor_kyc_status = VERIFIED`.
2. Set `CASHFREE_EASY_SPLIT_ENABLED=true` (and `CASHFREE_WEBHOOK_SECRET` if using
   a dedicated webhook secret).
3. Implement the `TODO(easy-split)` in `lib/settlement.ts#submitSplitOrder`:
   call the Cashfree Easy Split order/split API with the vendor id + owner share,
   persist `cashfree_split_group_id`, advance `split_status → PROCESSED`.
4. In the webhook, on settlement events insert/advance `settlement_transactions`
   and set `settlement_status`.
5. Test end-to-end in Cashfree **sandbox** before production.

## What is NOT done (honest status)
- No live vendor split/settlement API call (feature-flagged stub).
- No vendor onboarding UI/KYC flow (fields exist; the flow is future work).
- The existing rupee checkout (server action) still creates the live gateway
  session; the paise ledger currently records intent alongside it. Unifying them
  is the follow-up once Easy Split is live.
- Runtime tests require the migration applied to a live Supabase project + auth
  sessions; see `FINAL_PAYMENT_FEATURE_TEST_REPORT.md` for the pattern.

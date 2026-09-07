# HALLNECT — Cashfree Payouts: Scope Document

**Status:** scoping only. Nothing built. Read-only investigation.
**Date:** 2026-09-07 · **Repo:** `C:/Users/csrni/OneDrive/Documents/Desktop/Hallnect` · **Prod:** https://hallnect.com

> **Two disclosures before anything else.**
> **(a) Only two of the three investigations reached me.** I have the `existing-surface` report in full and the `payouts-api` report **truncated mid-fact** (it cuts off inside the payout-mode completion-time item, at "UPI/IMPS 99% within 15 "). The third report never arrived. Whatever it covered — I do not know its area — is **not reflected in this scope**. Do not read the absence of a topic here as a finding that the topic is clear.
> **(b) Verification labels are load-bearing.** Every Cashfree claim below is marked `[V]` verified against an official Cashfree page with the URL cited, or `[U]` UNVERIFIED. I personally re-read four Cashfree pages during this write-up (marked `[V-me]`); the rest of the `[V]` items carry the API investigation's citation. Nothing marked `[U]` may be built against without someone confirming it first.

---

## 1. What we are building, in two sentences

Hallnect will keep the full customer advance in its own Cashfree balance and later push each venue's share out as an explicit, tracked bank/UPI transfer through **Cashfree Payouts V2** — a separate product from the Payment Gateway that already runs checkout, with its own host, its own credentials, its own second authentication factor, and an **asynchronous, reversible** transfer lifecycle.

The manual bank transfer an admin makes by hand today (`markPayoutSettledManually`) stays live and unchanged for the entire project and remains the permanent fallback; Payouts is added *beside* it as a second, machine-driven path, never as a replacement that can strand money if it breaks.

---

## 2. What changes and what is reused

### 2.1 Reused unchanged — do not touch

| Thing | File | Why it survives |
|---|---|---|
| Integer-paise arithmetic | `lib/money.ts` | Model-agnostic, no I/O, no gateway concept. The commission-floors / GST-rounds-to-nearest asymmetry is deliberate. |
| Booking money authority | `lib/booking-payment.ts` `calculateBookingPayment()` | Guarantees `commission + ownerNetAdvance === advance`, paise-exact, throws if commission ≥ advance. |
| Owner-share purity | `computeOwnerShare` in `lib/owner-payout.ts` | Returns `{ok:false}` rather than guessing; caller stores NULL not 0. Keep both the function and that discipline. |
| 0031 booking snapshot + freeze trigger | migration 0031 | `owner_net_advance`, `commission_amount` frozen at creation. This is what makes a payout amount defensible months later. |
| `commissions` table + `createCommission` upsert-on-`booking_id` | `lib/payments.ts:1003-1062` | Re-delivered webhook cannot double-write. |
| Split-column write guard | `trg_guard_payment_split` (migration 0028) | DB-level, independent of RLS, requires `is_trusted_backend()` or `is_admin()`. Extend the same pattern to the new table. |
| "Whose money is this" filter | `fetchStuckPayouts`, `lib/admin.ts:650-740` | Asks about ownership, not about `split_status`. It is the right question under Payouts too. |
| Admin service-role + explicit role check | `lib/admin.ts:650-676`, `757-790` | Column grants (0046, 0065) are checked before RLS and know nothing about `is_admin()`. Any new admin read of payout data must follow this exact shape or it will 42501 in production. |
| Manual settle + refund interlock | `markPayoutSettledManually` / `issueRefund`, `app/admin/actions.ts:1528-1541`, `1728-1794` | The fallback. Extended, not replaced (see §5.4). |
| `toVendorId()`'s UUID flattening | `lib/easy-split.ts:41-43` | Survives with a rename — see §2.3. It is the only piece of `easy-split.ts` worth keeping. |

### 2.2 Deleted

- `lib/easy-split.ts` — entirely (after lifting `toVendorId`).
- `lib/settlement.ts` — `resolveSplitForBooking` and `submitSplitOrder` (zero callers; `submitSplitOrder` is a stub returning a TODO string). Keep `recordWebhookEvent` / `markWebhookProcessed`, the only two things `app/api/webhooks/cashfree/route.ts:58` imports — but see the open question in §8.6 about whether they have ever worked.
- `refreshPayoutStatus` in `app/owner/(dashboard)/actions.ts:898-942` — polls `/easy-split/vendors/{id}`; no analogue as written.
- `automaticPayoutsLive` in `app/owner/(dashboard)/revenue/page.tsx:88-92`.
- `easySplitEnabled` readout in `lib/cashfree-health.ts` → `app/admin/settings/page.tsx:170-186`.
- The duplicate `isEasySplitEnabled()` in `lib/settlement.ts:27-32` and the one in `lib/easy-split.ts:49-51`, and the env var `CASHFREE_EASY_SPLIT_ENABLED`.
- `docs/CASHFREE_EASY_SPLIT_ENGINE.md` — actively misleading: it documents `POST /api/payments/checkout` as the split entry point and that directory is empty.
- **Not** deleted in this project, but flagged: `payment_transactions`, `settlement_transactions`, `commission_transactions` (zero lifetime inserts, zero code references). Leave them alone; deleting tables is a separate change with its own risk. Do **not** revive them (§3.4).

### 2.3 New

| File | What |
|---|---|
| `lib/cashfree-payouts.ts` | The Payouts client: separate base URL, separate credentials, `x-api-version: 2024-01-01`, and the RSA `x-cf-signature` generator. Must not import `getCashfreeConfig` from `lib/cashfree.ts`. |
| `lib/payout-beneficiary.ts` | `toBeneficiaryId()` (lifted from `toVendorId`), create/fetch/delete beneficiary, status mapping. |
| `lib/owner-payout.ts` (rewritten) | Eligibility, claim, dispatch, reconcile. Keeps `computeOwnerShare` verbatim. |
| `app/api/webhooks/cashfree-payouts/route.ts` | New endpoint, new secret, separate from the PG webhook route. |
| `supabase/migrations/0066_*` .. `0068_*` | §3. |

### 2.4 Rewritten in place

`app/owner/(dashboard)/profile/_components/PayoutSetup.tsx` (four card states are all vendor/KYC-shaped) · `savePayoutDetails` in `app/owner/(dashboard)/actions.ts:1096-1200` · `acceptBooking`'s call at `actions.ts:794` · `retryOwnerPayout` (`app/admin/actions.ts:1701`) · `markPayoutSettledManually` (`:1728-1794`) · `issueRefund` guard (`:1528-1541`) · `fetchStuckPayouts` + `ownerShareOf` (`lib/admin.ts:612-647`, `650-740`) · `app/admin/payments/page.tsx` · `mapAdvancePayout` (`lib/owner.ts:442-465`) · `payoutDetailsSchema` (`lib/validation/schemas.ts:201-222`) · `.env.example`.

---

## 3. Data model delta

### 3.1 New table: `owner_payouts` — one row per transfer *attempt*

This is the central design decision and it is deliberate. The existing model has **one** `payments.split_status` column with five synchronous states and **one** `split_at` timestamp. Payouts needs more than that for three reasons, each concrete:

1. **`SUCCESS` is not final.** `REVERSED` is a documented post-success state — the beneficiary bank sends the money back to the payouts balance. `[V]` (status/status_code table, https://www.cashfree.com/docs/api-reference/payouts/v2/transfers-v2/get-transfer-status-v2.md — `[V-me]`, I re-read this page: `REVERSED` → `ACCOUNT_BLOCKED, FAILED, NRE_ACCOUNT_FAIL, RETURNED_FROM_BENEFICIARY, BENE_BANK_DECLINED, IMPS_MODE_FAIL, DEST_LIMIT_REACHED, INVALID_ACCOUNT_FAIL, BENE_NAME_DIFFERS`). So one booking can legitimately have attempt #1 reversed and attempt #2 succeed. A single status column cannot hold that history, and a reversal that silently overwrites the record of the first attempt is exactly the kind of thing that makes a ledger unauditable.
2. **The status model is two-level.** `status` + `status_code` + `status_description` `[V-me]`. Collapsing ~90 status codes into five legacy values destroys the only information an operator has when money does not arrive.
3. **`transfer_id` must be unique at Cashfree and is the only idempotency mechanism we have** (§5.5). It needs a durable home with a unique constraint, written *before* the HTTP call.

```
create table public.owner_payouts (
  id                  uuid primary key default gen_random_uuid(),
  booking_id          uuid not null references public.bookings(id),
  payment_id          uuid not null references public.payments(id),
  hall_owner_id       uuid not null references public.hall_owners(id),

  attempt             int  not null,                    -- 1-based
  transfer_id         text not null unique,             -- what we send to Cashfree; see §5.5
  cf_transfer_id      text,                             -- Cashfree's own id, from the response
  transfer_utr        text,

  amount_paise        bigint not null check (amount_paise > 0),
  transfer_mode       text   not null,                  -- see §8.3; default from config, not hardcoded
  beneficiary_id      text   not null,                  -- snapshot of what we actually paid
  destination_digest  text   not null,                  -- hash of acct+ifsc (or vpa) at dispatch time

  status              text not null,                    -- Cashfree `status`, stored raw
  status_code         text,                             -- Cashfree `status_code`, stored raw
  status_description  text,
  is_terminal         boolean not null default false,   -- our classification, see §4.6

  service_charge_paise bigint,                          -- transfer_service_charge  [V, SDK]
  service_tax_paise    bigint,                          -- transfer_service_tax     [V, SDK]

  requested_by        uuid references public.profiles(id),  -- the admin who approved
  dispatched_at       timestamptz,
  last_checked_at     timestamptz,
  settled_at          timestamptz,
  reversed_at         timestamptz,

  request_snapshot    jsonb not null,                   -- exact body we sent
  last_response       jsonb,                            -- exact last response/webhook we saw
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index owner_payouts_one_live_per_booking
  on public.owner_payouts (booking_id)
  where is_terminal = false;                            -- at most one in-flight transfer per booking
create unique index owner_payouts_booking_attempt
  on public.owner_payouts (booking_id, attempt);
```

The partial unique index is the double-spend guard that Easy Split got for free from the gateway (one split per order, closed with `disable_split`). We have to build it ourselves, in Postgres, because **no idempotency header is confirmed to exist** (§5.5).

`status` is stored **raw, unmapped**. Do not normalise Cashfree's vocabulary into ours at the write. Map at the read.

**Do not deploy without RLS + column grants:** `authenticated` gets **no** access at all — not even SELECT. Owners see their payout state through the existing `mapAdvancePayout` projection, never through this table. Writes: service role only, enforced with a trigger in the shape of `guard_payment_split_writes()` (migration 0028), because column grants are checked before RLS and RLS alone has already burned this codebase twice (`lib/admin.ts:650-676` documents 17 production failures across 3 users, 2026-08-30 to 2026-09-04).

### 3.2 `hall_owners` — column changes

**Add:**
- `payout_beneficiary_id text` — the id we registered at Cashfree.
- `payout_beneficiary_status text` — raw Cashfree value. `[V]` enum is exactly `VERIFIED, INVALID, INITIATED, CANCELLED, FAILED, DELETED` (`[V-me]`, https://www.cashfree.com/docs/api-reference/payouts/v2/beneficiary-v2/create-beneficiary-v2). Only `VERIFIED` is described as ready for payouts. Store raw; do **not** re-use the `vendor_kyc_status` CHECK, whose values (`NOT_CONNECTED|PENDING|VERIFIED|SUSPENDED`) are Easy-Split's and only coincidentally overlap.
- `payout_beneficiary_synced_at timestamptz`, `payout_beneficiary_last_error text`.
- `payout_account_holder` — **already exists** (migration 0029) and has **never been written** (0 of 2 live rows). It stops being decorative and becomes required. See §5.7 — this is a bigger deal than it looks.
- `payout_details_changed_at timestamptz` — set by trigger whenever the bank/UPI destination changes. Feeds §5.6.

**Drop (after the Easy Split removal ships):** `cashfree_vendor_id`, `vendor_kyc_status`, `vendor_synced_at`, `vendor_last_error`.

**Decide (operator, §8.7):** `payout_upi` is orphaned — populated on both live rows, still read by `/admin/owners` and `lib/admin.ts:457`, written by nothing since it was deliberately removed from the Business Details form (comment at `app/owner/(dashboard)/actions.ts:90-95`). Under Payouts, UPI is a first-class transfer destination `[V]` (`vpa` under `beneficiary_instrument_details`, `transfer_mode: upi`). Either bring it back as a real, validated field or drop the column — leaving a stale, unvalidated, unwritten UPI id sitting next to a machine that sends money is the worst of the three options.

**Grants:** revoke `authenticated` UPDATE on `payout_account_number`, `payout_ifsc`, `payout_upi`, `payout_account_holder`. See §5.6 — this is the single most important line in this document.

### 3.3 `payments` — minimal change

`payments.split_*` stays as the **derived summary and interlock**, not the authority. `owner_payouts` is the authority.

- Keep `split_status`, `split_owner_amount`, `split_at`, `split_error`.
- **Drop** `split_vendor_id`.
- **Add** `split_payout_id uuid references public.owner_payouts(id)` — points at the attempt that most recently determined the summary.
- **Extend** `payments_split_status_check` (migration 0028, currently exactly `none|pending|done|failed|not_applicable`) with two values: **`in_flight`** (dispatched, not terminal — money may or may not have left) and **`reversed`** (sent, then returned by the beneficiary bank).
  - `pending` keeps its existing meaning: *claimed, not yet dispatched* — the narrow window between the DB claim and the HTTP call.
  - `done` keeps its existing meaning and its existing job: **money has left our balance.** It is `issueRefund`'s double-spend guard (`app/admin/actions.ts:1534`) and `mapAdvancePayout`'s only "money left" value (`lib/owner.ts:442-465`). Do not weaken it.
  - `in_flight` is new and it is the one that changes refund behaviour (§5.4).

Update the partial index `idx_payments_split_status` (currently `where split_status in ('pending','failed')`) to include `in_flight` and `reversed`.

### 3.4 Explicitly *not* doing

**Do not revive `settlement_transactions` / `payment_transactions` / `commission_transactions`.** All three have `n_tup_ins = 0` lifetime with `stats_reset` NULL, and repo-wide grep finds their names only inside comment blocks (`lib/money.ts:6`, `lib/settlement.ts:7-8`, `:212`). They were shaped for a design that never happened. Building on five years of never-executed scaffolding to save one CREATE TABLE is a false economy — you inherit every assumption in them without knowing which ones were wrong.

**Do not touch `owner_settlement_adjustments`.** Read by `lib/admin.ts:907` and `lib/owner.ts:622`, written by nothing since migration 0039 removed the sweep. Out of scope.

---

## 4. The flow, end to end

### 4.0 Setup (one-time, operator)
Payouts must be activated on the existing Cashfree account. `[V]` A separate merchant account is **not** needed ("You don't need separate accounts for Payment Gateway and Payouts"), but a **separate client id/secret pair is** ("Each Cashfree product requires its own unique client ID and client secret... you must generate separate credentials for each" — https://www.cashfree.com/docs/docs/api-keys). `[V]` A `403 apis_not_enabled` error exists for accounts where Payouts is not switched on — expect exactly this if activation has not completed, and it will look like a credentials bug.

### 4.1 Owner supplies a destination
`PayoutSetup.tsx` → `savePayoutDetails`. The form grows from four fields to **five or six**: account number, IFSC, **account holder name** (new, mandatory, §5.7), PAN, business phone, and optionally VPA.

Write the columns, then attempt beneficiary registration. `POST /beneficiary` on the Payouts base `[V]`. Required: `beneficiary_id` (max 50, **alphanumeric + underscore + pipe + dot — no hyphen**) and `beneficiary_name` (max 100, **alphabets and whitespace only**) `[V-me]`. Instrument nested under `beneficiary_instrument_details`: `bank_account_number` (4-25 chars, alphanumeric) and `bank_ifsc` (11 chars) are **mutually mandatory** — one without the other is a 400 `[V-me]`; or `vpa` alone for UPI.

`beneficiary_id` = `toBeneficiaryId(hall_owners.id)` — the existing UUID-hyphen-stripping function, 32 hex chars, comfortably inside the 50 limit and inside the charset. This is a genuine reuse: `lib/easy-split.ts:41-43` already strips hyphens because Cashfree rejected the hyphenated form, and the documented Payouts charset confirms the same restriction applies here.

**Branches:**
- `409 beneficiary_id_already_exists` `[V-me]` → the owner already has one; treat as success and `GET /beneficiary` to read current status.
- `409 beneficiary_already_exists` (account/IFSC pair already registered) `[V-me]` → **this is a fraud and a data-integrity signal, not a retry.** Two Hallnect owners claiming one bank account. Do not auto-resolve. Flag to admin.
- `422 bank_account_number_same_as_source` / `422 vba_beneficiary_not_allowed` `[V-me]` → the owner gave our own account, or a virtual account. Show a specific error.
- `403 apis_not_enabled` → Payouts not activated. Fail the whole feature closed, loudly, with the manual queue still working.
- Beneficiary comes back `INITIATED` (verification in progress) `[V]` → save the details, do **not** dispatch. Whether `INITIATED` reaches `VERIFIED` on its own or needs re-polling is `[U]` — the docs describe it as "verification in progress" but do not state whether a callback fires. Plan to poll.

### 4.2 Booking accepted
`acceptBooking` (`app/owner/(dashboard)/actions.ts:~775-800`) keeps its count-checked status flip and `notifyBookingEvent`. **The call to `payOwnerOnAcceptance` at line 794 changes meaning: it computes and records eligibility, it does not dispatch money.** It writes `split_owner_amount` (or NULL, per `computeOwnerShare`'s refusal contract) and leaves `split_status` at `none`. The booking then appears in the admin queue as payable.

This is the smallest safe design. Auto-dispatch on acceptance can come later (§7, phase 2); starting with a human approving each transfer means the first real rupee that moves through this system moved because someone looked at it.

### 4.3 Admin dispatches
One screen (§7.9 merges `/admin/payments` and `/admin/owners`' `BankPayout` block, because today making one transfer requires cross-referencing two pages). The admin sees hall, booking, **amount**, **destination**, beneficiary status, and any estimate warning, and clicks Send.

Server-side, in order, and the order matters:

1. Re-run every existing guard in `lib/owner-payout.ts:105-145` unchanged — gateway payment exists and is `payment_success`; not already `done`; `refund_state` not in `(owed, processing, completed)` ("the advance belongs to the customer"); booking status in `(owner_confirmed, completed)`.
2. Beneficiary is `VERIFIED`, and its `destination_digest` matches what is on the owner row now (§5.6).
3. Amount comes from `ownerShareOf`'s chain; **refuse to dispatch on the estimated branch** (`isEstimatedShare() === true`). Today the admin screen just prints "Estimated — check the booking before transferring" and a human decides. A machine must not.
4. **Insert the `owner_payouts` row first**, with `status = 'RECEIVED_LOCAL'` (our own pre-flight marker, clearly not a Cashfree value), attempt = max+1, and the generated `transfer_id`. The partial unique index refuses if anything non-terminal already exists for this booking. **This insert is the idempotency guard.**
5. Set `payments.split_status = 'pending'`.
6. `POST /transfers` `[V]`. Body per the official SDK interface `[V]`: `{ transfer_id, transfer_amount, transfer_currency?, transfer_mode?, beneficiary_details?, transfer_remarks?, fundsource_id? }` (https://raw.githubusercontent.com/cashfree/cashfree-payout-sdk-nodejs/main/api.ts).
7. On any response, write it verbatim into `last_response`, update `status`/`status_code`, and set `payments.split_status` from the mapping in §4.6.

### 4.4 Failure branches at dispatch

| Branch | Handling | Source |
|---|---|---|
| **5XX** | **Never retry the transfer.** Leave the row in place, mark it for reconciliation, poll `GET /transfers`. | `[V]` "When you get a 5XX response, do not initiate another transaction. Check the status... and then proceed further." |
| **Network timeout / fetch throws** | Identical to 5XX. The row exists with its `transfer_id`, so reconcile can find out what actually happened. **This is the case that today strands a row forever** (§5.3). | — |
| **`REJECTED` + `INSUFFICIENT_BALANCE`** | Terminal, no money moved. Alert operator. Do not retry automatically — the balance problem is human. | `[V-me]` (`REJECTED` code list) |
| **`REJECTED` + `BENE_NOT_EXIST` / `BENE_INVALID` / `BANK_ACCOUNT_INVALID` / `BANK_IFSC_INVALID` / `VPA_INVALID` / `NAME_INVALID`** | Terminal. Send the owner back to `PayoutSetup`; invalidate the beneficiary. | `[V-me]` |
| **`REJECTED` + `INSIDE_BLACKOUT_WINDOW` / `TRANSFER_LIMIT_BREACH` / `VELOCITY_CHECK_FAILED`** | Terminal for this attempt but transient in nature — schedule a new attempt with a **new** `transfer_id`, subject to §8.2. | `[V-me]` |
| **`APPROVAL_PENDING`** | Cashfree is holding it for manual/risk approval (16 documented codes including `MANUAL_APPROVAL_REQUIRED`, `RISK_CHECK_*`, `COMPLIANCE_REVIEW_PENDING`). **Not terminal, and possibly not resolvable from the API at all** — it may need action in the Cashfree dashboard. Surface it as its own admin state with the raw `status_code` shown. | `[V-me]` |
| **`RECEIVED` / `QUEUED` / `PENDING`** | Expected normal path. `in_flight`. Poll. | `[V]` "async request by default" |
| **`VALIDATION_PENDING`** | Non-terminal. Poll. | `[V-me]` |

### 4.5 Reconciliation (the primary status source — see §8.6)
A cron/scheduled job polls `GET /transfers` for every non-terminal `owner_payouts` row on a backoff, plus an admin-triggered "Reconcile now" button on each queue row. `[V-me]` Lookup is by "either the `transfer_id` or `cf_transfer_id`"; **whether both may be sent simultaneously is not documented** `[U]` — send exactly one, `transfer_id`, which we always have.

Reconcile is also the fix for the strand bug: a row whose dispatch died mid-flight gets its truth from Cashfree, not from a human guess.

### 4.6 Terminal classification and the summary mapping

Store raw; classify at the boundary, in one function, with the raw value always visible to admins.

| Cashfree `status` | terminal? | `payments.split_status` | Owner sees (`mapAdvancePayout`) |
|---|---|---|---|
| `RECEIVED`, `QUEUED`, `PENDING`, `VALIDATION_PENDING`, `APPROVAL_PENDING` | no | `in_flight` | "on its way" (new copy) |
| `SUCCESS` | yes* | `done` | "Advance paid to you", with amount and date |
| `REJECTED`, `MANUALLY_REJECTED` | yes | `failed` | "not sent yet" |
| `FAILED` | yes | `failed` — **but see below** | "not sent yet" |
| `REVERSED` | yes | `reversed` | "not sent yet" |

**\* `SUCCESS` is terminal for the transfer and provisional for the money.** `[V]` The FAQ says a bad transfer "may reverse to your payouts account within 24 hours". So a `TRANSFER_REVERSED` webhook or a reconcile can move a row from `SUCCESS` to `REVERSED` *after* we wrote `done`. Handle it: `reversed_at` set, `payments.split_status` moved `done → reversed`, `split_at` cleared, owner notified, booking returned to the payable queue as attempt N+1. This backward transition is the single most unusual thing in this design and it needs its own test.

**The `FAILED` ambiguity — flag, do not resolve in code.** `[V-me]` `RETURNED_FROM_BENEFICIARY`, `IMPS_MODE_FAIL`, `NRE_ACCOUNT_FAIL`, `ACCOUNT_BLOCKED` and `DEST_LIMIT_REACHED` appear under **both** `FAILED` and `REVERSED` in Cashfree's own table. I cannot tell from the documentation whether a `FAILED` carrying one of those codes means the debit never happened or means it happened and unwound. `[U]` **Until Cashfree confirms this, treat `FAILED` with a shared code as "unknown — do not auto-retry", route it to a human, and let the manual queue handle it.** A wrong assumption here is a double payment.

### 4.7 Webhook (secondary confirmation, not the trigger)
New route `app/api/webhooks/cashfree-payouts/route.ts`. `[V]` Nine events: `TRANSFER_ACKNOWLEDGED, TRANSFER_SUCCESS, TRANSFER_FAILED, TRANSFER_REVERSED, TRANSFER_REJECTED, BULK_TRANSFER_REJECTED, BENEFICIARY_INCIDENT, CREDIT_CONFIRMATION, LOW_BALANCE_ALERT`.

`[V]` Signature scheme is the same shape the repo already implements at `lib/cashfree.ts:266` — `base64(HMAC-SHA256(timestamp + rawBody, secret))` with `x-webhook-signature` / `x-webhook-timestamp` — **but with the Payouts secret, and Cashfree says to use the oldest active client secret.** That "oldest active" instruction is easy to miss and produces a 100%-failure signature mismatch that looks like a code bug.

`[V]` **Five consecutive non-200 responses disable the endpoint**, and 3xx counts as failure. So: return 200 the moment the payload is authenticated and persisted, and do all real work after. A thrown exception in business logic must not become a non-200.

Subscribe `LOW_BALANCE_ALERT` and `CREDIT_CONFIRMATION` too — they are the cheapest available answer to the balance question (§4.8).

### 4.8 Where the money actually is — the unresolved link
`[V]` The payouts balance (Cashfree Wallet) "can be funded from your registered bank account only", and "recharges from any bank accounts not registered with Cashfree will not be credited... will be refunded to the source account within 7 business days" (https://www.cashfree.com/docs/docs/cashfree-wallet).

`[V-me]` I re-read that page specifically to check for a PG link. **It documents no connection whatsoever between Payment Gateway settlements and the Cashfree Wallet.** A search across Cashfree's settlement docs surfaced a claim that settlements can be directed to virtual accounts and that "virtual account funds can be used to pay vendors" — that is `[U]`, from a search summary, not from a page I read, and it may describe Easy Split's vendor settlements rather than Payouts. **Do not design around it.**

The concrete consequence: **as documented, the advance lands in the PG settlement flow and goes to Hallnect's bank account, and the payouts balance is a separate pot that Hallnect tops up by bank transfer.** That is an operational cash-management burden the operator has probably not budgeted for, and it is question §8.1 — the first one to ask Cashfree.

We do **not** build a balance reader in v1. `[V]` The balance endpoint exists only in **V1** (`GET https://payout-api.cashfree.com/payout/v1.2/getBalance`, returning `balance` and `availableBalance` = "ledger balance minus the sum of all pending transfers") — a different host, a different API version, and the V1 6-minute bearer-token auth flow. Building a second auth implementation to read one number is not worth it when `REJECTED/INSUFFICIENT_BALANCE` tells us the same thing at the moment it matters and `LOW_BALANCE_ALERT` warns beforehand.

---

## 5. Money-safety rules, each traceable

**5.1 — The base is `payments.advance_amount`, never `payments.amount`.**
`lib/owner-payout.ts:160-170` already does this, with `amount` as a fallback only for pre-0031 legacy rows (migration 0031: "NULL = legacy payment where amount was the advance alone"). Using `amount` on a current row overpays the owner the customer's platform fee **plus GST**. Carry the exact expression across unchanged.

**5.2 — Never use `commissions.owner_payout_amount` as a transfer amount.**
It is `base_amount − commission` — the hall price minus commission, i.e. the owner's share across both the advance *and* the cash balance they collect at the venue. On a 25% advance it is roughly **four times** what Hallnect owes. It is also what `/owner/revenue` prints as "Your share" (`lib/payments.ts:1040-1060`). Under Easy Split nobody could have used it by accident because the gateway computed the split. Under Payouts, a human or an LLM reading the schema will find a column literally named `owner_payout_amount` and reach for it. **Add a comment on that column in the migration saying it is not a transfer amount.**

**5.3 — A dispatch that dies mid-flight must be recoverable.**
Today it is not: `payOwnerOnAcceptance`'s claim accepts only `['none','failed','not_applicable']` (`lib/owner-payout.ts:290-300`), so a row stuck at `pending` returns "A payout is already in progress" forever, while `fetchStuckPayouts` keeps showing it with a Retry button that errors permanently. Easy Split was synchronous, so this was rare. **Payouts is asynchronous by definition and this will happen routinely.** The fix is structural, not a widened `.in()` list: the `owner_payouts` row is written before the HTTP call with a deterministic `transfer_id`, so recovery is a `GET /transfers`, not a guess.

**5.4 — The refund interlock must cover in-flight money, not just settled money.**
`issueRefund` currently refuses only when `split_status === 'done'` (`app/admin/actions.ts:1534`). Under Easy Split, `pending` lasted milliseconds. Under Payouts, `in_flight` can last hours or overnight (`SCHEDULED_FOR_NEXT_WORKINGDAY` is a documented `PENDING` code `[V-me]`, and `[V]` NEFT runs Mon-Sat 1 AM-6:45 PM excluding 2nd and 4th Saturdays). **That is a real double-spend window: refund the customer in full while a transfer to the owner is on its way.** `issueRefund` must refuse on `in_flight` as well, with a distinct message, and the operator must resolve the transfer before refunding. Symmetrically, `payOwnerOnAcceptance`'s existing refund guard (`refund_state in (owed, processing, completed)`) stays.

The commit history shows this class of bug has bitten before: `app/admin/actions.ts:1742-1750` records that while `markPayoutSettledManually` was failing under RLS, "a venue could be paid by hand and the customer refunded in full on top."

**5.5 — Idempotency is ours, in Postgres. Not Cashfree's.**
`[U]` **An `x-idempotency-key` header could not be confirmed on any official Payouts page, and Cashfree's own Node SDK does not send it.** I re-read the Batch Transfer V2 page specifically and confirmed no idempotency header appears there either `[V-me]`. **Do not build against an idempotency header.** Idempotency rests entirely on the merchant-supplied unique `transfer_id` plus our own `owner_payouts` unique indexes.

`transfer_id` format — and here Cashfree contradicts itself `[V-me]`, both pages read by me today:
- Standard Transfer V2: "can contain only alphabets, numbers, underscore (_), hyphen (-)"
- Batch Transfer V2: "transfer_id should be alphanumeric"

**Take the intersection: `[A-Za-z0-9]` only.** Proposed: `hn` + `toBeneficiaryId`-style 32-hex booking id + 2-digit attempt = 36 chars, e.g. `hn7f3a...c21b01`. `[U]` **No maximum length is documented on either page** — confirm in the sandbox before committing to 36 characters. (For comparison, `beneficiary_id` is capped at 50 `[V-me]`, which suggests a similar order of magnitude, but that is inference, not documentation.)

`transfer_remarks`: `[V-me]` "can contain only alphabets, numbers and space" — so no hyphens, no `#`, no booking-id punctuation. Max length undocumented `[U]`. Keep remarks boring and short.

**5.6 — The destination must not be silently mutable.**
Today `authenticated` holds UPDATE on `payout_account_number`, `payout_ifsc`, `payout_upi` and `pan_number` for the owner's own row, with **no re-verification, no penny-drop, and no notification to anyone** (live `information_schema.column_privileges` + `hall_owners_update` policy). The vendor/KYC columns were correctly locked to the trusted backend; the bank destination was not. Today that only feeds a human who eyeballs it. **Under Payouts it is the machine-readable destination of real money, and an account-takeover becomes a cash-out.**

Required, minimum:
1. Revoke `authenticated` UPDATE on all destination columns. Route every change through a server action that runs the full validation, re-registers/re-verifies the beneficiary, and stamps `payout_details_changed_at`.
2. **Refuse to dispatch while a transfer is in flight and the destination changed after dispatch** — the `destination_digest` snapshot on `owner_payouts` makes this a comparison, not a judgement call.
3. Notify the owner (SMS/email) on any destination change — a change they did not make is the only signal they will get.
4. `[U]` Whether an existing beneficiary's instrument can be *updated* in place, or must be `DELETE`d and re-created, is not documented on the pages read. Design for delete-and-recreate; confirm. Note the `409 beneficiary_already_exists` on account/IFSC pairs `[V-me]` means a naive recreate-with-new-id will collide.
5. A cooling-off period before a changed destination is payable is worth considering — operator call, §8.7.

This is a decision for the operator, not a code detail, but code cannot ship without an answer.

**5.7 — The beneficiary name is a hard constraint, and we do not currently collect it.**
`[V-me]` `beneficiary_name`: **"Only alphabets and whitespaces are allowed"**, max 100 chars. Easy Split substituted `hall_owners.business_name`. A business name containing `&`, `.`, digits, `Pvt. Ltd.` or `(P)` **will be rejected** — and `payout_account_holder`, the column that should hold a bank-matching name, has never been written on any row.

Worse, the name is not merely a format check: `[V-me]` `BENE_NAME_DIFFERS` is a documented **`REVERSED`** status code. A name that passes Cashfree's charset filter but does not match the bank record can produce a transfer that reports `SUCCESS` and then reverses. So the fifth form field is not cosmetic — it is the difference between a payout landing and a payout unwinding a day later.

**5.8 — Store amounts in paise; convert once, at the boundary.**
`transfer_amount` is a `number` in the SDK interface `[V]`, i.e. rupees. `[U]` **No minimum, maximum, or decimal precision is documented on the Standard Transfer page** — I checked `[V-me]`. Convert `amount_paise → rupees` with exactly two decimals in one place, assert the round-trip, and confirm precision handling in the sandbox before the first live transfer. `lib/money.ts` stays the only arithmetic.

**5.9 — Never claim money moved when it did not.**
`mapAdvancePayout` (`lib/owner.ts:442-465`) encodes the rule that only `done` means money left, and that `split_error` is never shown to the owner. Preserve both. Add: `in_flight` and `reversed` map to "not sent yet" for the owner, never to "paid". And fix the existing gap — a hand transfer writes no `split_at` and often no `split_owner_amount`, so `/owner/revenue` can show "Advance paid to you" with no amount and no date, which is why that page deliberately refuses to print a rupee total. A machine transfer records both, so the total can eventually come back — but only once **every** row has them, not before.

**5.10 — The manual path stays, and the two paths must be mutually exclusive.**
`markPayoutSettledManually` keeps working throughout and remains the escape hatch for every `[U]` in this document. But it must now refuse when a non-terminal `owner_payouts` row exists for the booking — asserting by hand that money was sent, while a machine transfer is in flight to the same account, is the double-spend this whole design exists to prevent. It should also start recording what it has always omitted: amount, timestamp, destination, method. Today it writes only `split_status='done'` and stuffs the reference into `split_error` as `Settled manually: <ref>` (`app/admin/actions.ts:1772-1779`).

---

## 6. Blocked on Cashfree vs not blocked

**Blocked — cannot be finished without Cashfree or the operator:**
- Payouts activation on the account. `[V]` KYC + activation, quoted at 24-48 working hours after document verification. Until then every call returns `403 apis_not_enabled`.
- Payouts client id/secret (separate from PG). `[V]`
- The 2FA decision and the public key. `[V]` Production requires **either** IP allowlisting **or** the RSA `x-cf-signature`; without it you get "Signature missing in the request". The public key is generated at Payouts Dashboard → Developers → Two-Factor Authentication → Public Key, **only one key can exist at a time**, and in production the downloaded key is password-protected with the registered email (no password in test). Someone with dashboard access must do this.
- How the payouts balance gets funded (§4.8, §8.1).
- The webhook endpoint registration and its secret.
- The answers to every `[U]` in §8.

**Not blocked — start now:**
- Sandbox: `[V]` `https://sandbox.cashfree.com/payout`, and the 2FA public key needs **no password** in test. The signature implementation, the client, beneficiary create/fetch/delete, and a full transfer lifecycle can all be exercised in sandbox before production activation lands. **Do this first** (§7.1) — it is where the unknowns collapse.
- Every migration in §3.
- Every guard, interlock and refusal in §5 — none of them need a live gateway.
- The admin screen merge, the owner UI rewrite, the Easy Split deletion, and the test suite.
- The `[U]` list itself can be narrowed by sandbox experiment even before Cashfree answers: transfer_id max length, decimal precision, whether a REJECTED `transfer_id` is reusable.

---

## 7. Work breakdown, ordered

Sizes are engineer-days for one engineer who knows this codebase. They do not include operator lead time on §6.

| # | Item | Size | Notes |
|---|---|---|---|
| 0 | **Operator decisions + credentials** (§6, §8) | — | Blocking. Start today, in parallel with 1. |
| 1 | **Sandbox spike**: RSA signature, create beneficiary, one transfer, poll status, force a failure | **2-3 d** | **Do this first.** Highest-uncertainty work, earliest. Output is a written answer to as many `[U]`s as sandbox can settle. If the signature does not work, everything else is theoretical. |
| 2 | Migrations: `owner_payouts` + `hall_owners` columns + `split_status` CHECK + grants + guard trigger | **1 d** | §3. Ship the grant revoke (§5.6) in this migration even if nothing else lands. |
| 3 | `lib/cashfree-payouts.ts`: base URL, headers, `x-cf-signature` with a 10-minute cache, typed errors | **2 d** | `[V]` signature expires after 10 minutes; cache and regenerate, do not compute per request. |
| 4 | Beneficiary lifecycle: create/fetch/delete, status mapping, `savePayoutDetails` rewrite, account-holder field, destination-change invalidation | **2 d** | §4.1, §5.6, §5.7. |
| 5 | Dispatch: eligibility, DB claim, `POST /transfers`, response handling, all §4.4 branches | **2 d** | The insert-before-HTTP ordering is the whole point. |
| 6 | Reconcile: `GET /transfers`, terminal classification, `SUCCESS → REVERSED` backward transition, cron + manual button | **1.5 d** | §4.5, §4.6. This is what makes 5.3 true. |
| 7 | Webhook route: signature verify (oldest active secret), persist-then-200, event handling | **1.5 d** | §4.7. Treated as confirmation, not trigger — see §8.6. |
| 8 | Refund interlock extension both directions | **1 d** | §5.4. Small code, high stakes, needs its own tests. |
| 9 | Admin UI: merge amount + destination onto one screen, raw status/status_code visible, reconcile button, manual-settle mutual exclusion | **1.5 d** | §5.10. |
| 10 | Owner UI: `PayoutSetup` states, `mapAdvancePayout`, `/owner/revenue` copy | **1 d** | Delete `automaticPayoutsLive`. |
| 11 | Delete Easy Split: `lib/easy-split.ts`, `refreshPayoutStatus`, dead `lib/settlement.ts` fns, vendor columns, `cashfree-health` readout, the stale doc, env var | **1 d** | Last, not first — keep the old code compiling until the new path is proven. |
| 12 | Tests | **2 d** | See below. |
| 13 | Runbook + canary plan | **1 d** | One real booking, smallest amount, manual queue armed. |

**Total: ~20-22 engineer-days**, plus operator lead time on §6 (activation alone is quoted at 24-48 working hours after document verification, and that clock starts after documents are submitted).

**On tests (item 12).** Current coverage of this surface is *pure functions only*: `computeOwnerShare` (`lib/__tests__/owner-money.test.ts`, `booking-payment.test.ts`) and `payoutDetailsSchema` (`payout-onboarding.test.ts`). **There is no test of `payOwnerOnAcceptance`, of the claim/dispatch sequence, or of any gateway interaction.** That was survivable when no money moved automatically. It is not survivable now. Minimum new coverage: the claim/insert race (two concurrent dispatches for one booking → exactly one row), the 5XX-never-retry path, `SUCCESS → REVERSED`, the refund interlock in both directions, the manual/machine mutual exclusion, and the paise↔rupee round trip.

---

## 8. Open questions — answers required before code

**To Cashfree (support ticket, before item 5 ships):**

1. **How do PG settlements reach the payouts balance?** The Cashfree Wallet page documents funding "from your registered bank account only" and says nothing about the Payment Gateway `[V-me]`. Is there a supported route from PG settlement to the payouts balance (virtual account? auto-recharge? a dashboard setting?), or must Hallnect settle to its bank and manually top up? **This determines whether this project is an automation or a new manual treasury task.** Highest-priority question in this document.
2. **Can a `transfer_id` from a `REJECTED`, `FAILED` or `REVERSED` transfer be reused?** `[U]` Nothing in the docs read says. This decides whether `transfer_id` is a function of the booking or of the attempt. The design above assumes **not reusable** (attempt counter in the id), which is the safe assumption but produces a longer id.
3. **Does `FAILED` ever mean money left the balance?** `[V-me]` `RETURNED_FROM_BENEFICIARY`, `ACCOUNT_BLOCKED`, `IMPS_MODE_FAIL`, `NRE_ACCOUNT_FAIL` and `DEST_LIMIT_REACHED` appear under **both** `FAILED` and `REVERSED`. A wrong answer here is a double payment (§4.6).
4. **Is there any idempotency header?** `[U]` Not found on any official page and absent from the official Node SDK. Ask explicitly; if one exists, we want it as a second layer.
5. **`transfer_id` charset and max length.** Cashfree's own two pages disagree on charset `[V-me]` and neither documents a length limit `[U]`.
6. **`transfer_amount` decimal precision and minimum.** `[U]` Undocumented on the Standard Transfer page.
7. **Does `beneficiary_status: INITIATED` resolve on its own, and is there a beneficiary webhook?** `[U]` Only `BENEFICIARY_INCIDENT` appears in the event list, and it is described as a *service disruption*, not a verification result.
8. **Can a beneficiary's instrument be updated in place, or is it delete-and-recreate?** `[U]` (§5.6.4). Note `409 beneficiary_already_exists` on account/IFSC pairs constrains the recreate path.
9. **Is there a rate limit on Payouts?** `[U]` The investigation found none published anywhere; the rate-limit pages cover Payments and SecureID only.
10. **Which OAEP hash for `x-cf-signature`?** The Java sample says `RSA/ECB/OAEPWithSHA-1AndMGF1Padding` and the PHP sample `OPENSSL_PKCS1_OAEP_PADDING` `[V]`. Node's `crypto.publicEncrypt` with `RSA_PKCS1_OAEP_PADDING` defaults to SHA-1, so it *should* match — **that is my inference, not documentation.** Settle it in the sandbox (item 1), not in production.

**To the operator (before item 2 ships):**

11. **IP allowlist or RSA signature?** `[V]` Production needs one. Vercel serverless functions do not have stable egress IPs on the standard plan — `[U]` I did not verify Vercel's current plan tiers or whether this account has static egress available. If it does, allowlisting is dramatically simpler than the signature path. **Check the Vercel plan before committing 2 days to RSA.** Also note Cashfree's own pages disagree on the allowlist maximum: 10 on the 2FA page, 25 on the Getting Started page and the IP whitelist FAQ `[V]`. IPv4 only.
12. **Should a venue owner be able to change their bank destination freely?** (§5.6) Options: locked with admin re-approval; self-editable with a cooling-off period before payability; self-editable with notification only. **This is an operator risk decision, not an engineering one.**
13. **`payout_upi`: revive as a validated field, or drop the column?** (§3.2)
14. **Default `transfer_mode`.** `[V]` Valid values: `banktransfer, imps, neft, rtgs, upi, paytm, amazonpay, card, cardupi`, default `banktransfer`. `[V]` Documented limits: IMPS ₹5 lakh per payout; UPI ₹1 lakh (bank-specific floors from ₹10,000); Amazon Pay ₹10,000; NEFT is the default above ₹2 lakh and runs Mon-Sat 1 AM-6:45 PM excluding 2nd and 4th Saturdays; IMPS/UPI/wallets are 24x7. **The completion-time figures were in the truncated part of the API report and I am not restating them.** Typical Hallnect advances are well inside every limit — the practical choice is speed vs per-transfer cost.
15. **Who absorbs the payout fee?** `[V]` The transfer response returns `transfer_service_charge` and `transfer_service_tax`. Easy Split never surfaced a per-payout cost. Under Payouts there is one per transfer, and at 2.5% commission on a hall price it is not negligible relative to the margin. Does Hallnect eat it, or does it come out of the owner's share? **If it comes out of the owner's share, that changes `computeOwnerShare` and the booking snapshot, and it is a terms-of-service change — not a code change.**
16. **Human approval per transfer, forever or only at first?** This scope assumes admin-approved dispatch (§4.3). Auto-dispatch is a phase-2 flag.

**Internal, must be answered before item 7:**

17. **Has the PG webhook *ever* fired against production?** `payment_webhook_events` has **zero lifetime inserts** despite 17 lifetime `payments` rows and a live receiver at `app/api/webhooks/cashfree/route.ts` that calls `recordWebhookEvent` on every event. Either the webhook has never reached production, or every insert has failed silently (`recordWebhookEvent` swallows non-23505 errors into an `{ok:false}` the caller may ignore). **This is why §4.5 makes polling the primary status source and §4.7 makes webhooks confirmation.** But it needs a real answer — if webhook delivery is broken at the infrastructure level, the Payouts webhook will be broken the same way, and `[V]` five consecutive non-200s disable the endpoint permanently until someone re-enables it in the dashboard.

---

## 9. What could go wrong, and how we would know

| Failure | Blast radius | Detection |
|---|---|---|
| **Double payment** — one booking transferred twice | Direct cash loss, unrecoverable without the owner's cooperation | The partial unique index on `owner_payouts (booking_id) where not is_terminal` makes it a DB error, not a discovery. Plus a daily reconcile: `sum(owner_payouts where status='SUCCESS')` per booking must be ≤ `ownerShareOf(booking)`. **Alert on any booking with two `SUCCESS` rows.** |
| **Pay + refund** — customer refunded while a transfer is in flight | Cash loss, and it has nearly happened before (`app/admin/actions.ts:1742-1750`) | §5.4 interlock refuses at the action. Detection: any payment with `refund_state in (processing, completed)` and an `owner_payouts` row in `SUCCESS` or non-terminal → page immediately. |
| **Silent reversal** — money returns, we still show the owner "paid" | Trust damage; owner chases a payment that came back | The `SUCCESS → REVERSED` backward transition (§4.6) plus a reconcile that re-checks `SUCCESS` rows for at least 48 hours (`[V]` "may reverse... within 24 hours"; give it double). Alert on every `reversed_at`. |
| **Stranded in-flight rows accumulate** | Owners unpaid, admin queue untrustworthy, exactly today's bug at higher volume | Alert on any `owner_payouts` non-terminal for > 24h, and on any `last_checked_at` older than the poll interval. The manual queue remains the resolution path. |
| **2FA signature breaks in production** (key rotated, clock skew, wrong OAEP hash) | 100% of transfers fail; **no money moves at all** | Every call returns a signature error at once, not intermittently. This is the loud failure, which is the good kind. `[V]` The signature expires after 10 minutes — a cached signature past its window fails cleanly. Alert on any auth-class error, and fall back to the manual queue automatically. |
| **Webhook endpoint auto-disabled** after 5 non-200s `[V]` | Status updates stop arriving silently; **the worst kind of failure** because everything looks fine | Precisely why reconcile-by-polling is primary (§4.5, §8.17). Additionally: alert if no payout webhook has been received in 24h while transfers were dispatched. |
| **Payouts balance runs dry** | Transfers `REJECTED/INSUFFICIENT_BALANCE`; owners unpaid | `[V]` `LOW_BALANCE_ALERT` webhook + the `REJECTED` reason code, both routed to admin SMS. **This is the failure most likely to actually happen**, because §8.1 is unresolved and topping up may be a manual bank transfer someone has to remember. |
| **Beneficiary name mismatch** | Transfer reports `SUCCESS`, reverses a day later, repeatedly | `[V-me]` `BENE_NAME_DIFFERS` under `REVERSED`. Alert specifically on that code — it means the stored account-holder name is wrong and every future attempt to that owner will fail the same way. Block further attempts to that beneficiary until a human fixes the name. |
| **Compromised owner account redirects payouts** | Cash loss, and it looks like a normal successful transfer | §5.6: locked columns, `destination_digest` comparison at dispatch, owner notification on change. Detection: alert on any destination change within N days of a pending payout. |
| **Amount wrong** — `payments.amount` instead of `advance_amount`, or `commissions.owner_payout_amount` (~4x) | Systematic overpayment on every booking | Assert at dispatch that `amount_paise ≤ payment.advance_amount_paise` and `amount_paise == ownerShareOf(booking)`, and **refuse on the estimated branch**. A unit test pinning the four-step preference chain (`lib/admin.ts:627-647`). |
| **Cron stops running** | Nothing reconciles; in-flight rows freeze; looks like everything is fine | A heartbeat: alert if reconcile has not run in 2× its interval. |

**Canary plan.** First production transfer: one real booking, smallest available amount, dispatched manually by an admin who watches it through to `SUCCESS`, with reconcile polling and the manual queue armed. Then a week of single-transfer-per-day before any batching or auto-dispatch. `[V]` Batch transfer exists (`POST /transfers/batch`, up to 5,000 in production, 1,000 in test — `[V-me]`) and is explicitly **out of scope for v1**: it multiplies the blast radius of every row in this table by up to 5,000.

---

### Where the reports disagree, and where they are silent

- **On `x-idempotency-key`:** a search snippet attributed it to standard transfer; the API investigation could not confirm it from any official page or from Cashfree's own SDK, and I independently confirmed its absence from the Batch Transfer page. **The snippet is not evidence.** Treated as non-existent throughout (§5.5).
- **Cashfree contradicts itself twice, in its own official documentation:** IP allowlist maximum (10 vs 25) and `transfer_id` charset (alphanumeric+`_`+`-` vs alphanumeric). Both are recorded above rather than resolved by picking one; the design takes the stricter reading in each case.
- **On PG-settlement-to-payouts-balance:** marketing pages assert a connection; the Cashfree Wallet doc, which I re-read specifically to check, documents none. §4.8 follows the documentation, not the marketing, and §8.1 asks the question.
- **The third investigation's report never arrived, and the API report is truncated.** Nothing in this scope should be read as covering ground those reports may have covered.

---

## 10. Addendum — two things added after the synthesis, and why

The scope above was assembled by an agent that received only two of three
investigations: the orchestrator truncated the research payload, so the
**money-safety** report never reached it. That report completed and its
conclusions are recorded here rather than silently folded in, because one of
them changes a design decision above.

### 10.1 `failed` is retryable, and under Payouts that is the double-payment path

This is the sharpest finding in the exercise, and §5 does not state it plainly.

`lib/owner-payout.ts:209-216` — `failAndAlert()` writes `split_status='failed'`
on **any** gateway error. The file header at `:20-23` says so as a feature:
"Every outcome is recorded on payments.split_status so an admin can see and
**retry** it."

Under Easy Split that was safe, and safe for a specific reason: the split was
synchronous, and Cashfree's `disable_split: true` closed the order **at the
gateway**, so a retry physically could not split twice. There were two
independent locks — the DB claim and the gateway's own.

**Moving to Payouts deletes the second lock and puts nothing in its place.** A
transfer that times out, or returns a 5XX, has an *unknown* outcome — the money
may well have moved. Marking that row `failed`, i.e. retryable, and offering an
admin a Retry button is exactly how a venue gets paid twice.

The rule, and it belongs in §5 as a first-class item:

> **A transfer whose outcome is unknown is never `failed`.** It is
> `in_flight_unknown`, it is not retryable by anyone, and it is resolved only by
> `GET /transfers` against its deterministic `transfer_id`. Only a response that
> positively says the money did not move may become retryable.

This is why §3's `owner_payouts` row must be written **before** the HTTP call.
The row is not bookkeeping; it is the thing that makes an unknown outcome
recoverable rather than a guess.

### 10.2 The payout trigger is a policy decision, not an implementation detail

Today `payOwnerOnAcceptance` fires on **acceptance**. The booking state machine
explicitly allows `owner_confirmed → cancelled` by the customer afterwards, and
the refund schedule then returns 100 / 75 / 50 / 0% of the advance — while the
published cancellation policy says the venue is owed nothing out of a forfeited
advance.

So paying on acceptance opens a window, **as long as the lead time of a wedding
booking**, in which Hallnect has paid the venue and may still owe the customer
everything back. Easy Split carried the same risk in principle; it never fired
only because Easy Split was never switched on. Automating payouts makes it real.

The three candidate triggers, for the operator to choose:

| Trigger | Exposure | Venue experience |
|---|---|---|
| On acceptance (today's code) | Full advance at risk until the event | Fastest; venues like it |
| After the free-cancellation window closes | Bounded to the non-refundable portion | Slight delay, defensible |
| After the event completes | Effectively nil | Slowest; venues will push back |

The safe answer from the money side is the second. It is not a code question,
and §7 item 5 cannot be finished without an answer.

### 10.3 Corroborated by the money-safety report

- The DB claim becomes the **only** lock once `disable_split` is gone (§5.3, §5.5).
- `owner_confirmed → cancelled` is permitted by `validate_booking_transition`.
- `issueRefund` hard-refuses at `split_status === 'done'` and tells the admin to
  recover from the owner's next settlement — evidence this class of problem has
  been reasoned about before, and the reason §5.4 must extend that refusal to
  in-flight transfers.
- Its independent conclusion that the payout lifecycle needs **its own table**
  rather than more `split_*` columns matches §3.1. Two investigations reaching
  that design separately is the strongest signal in this document.

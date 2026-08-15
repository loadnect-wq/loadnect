# UPI Commission Payment Flow (manual, admin-verified)

**Status:** Implemented (2026-08-15). No payment gateway required.

Because there is no live UPI gateway/webhook yet, commission payment uses a
**production-safe manual flow with mandatory admin verification**. An owner-entered
UPI reference is treated as a *claim*, never as proof of payment.

## Owner side
1. On `/owner/commissions`, an outstanding commission shows **Pay Now**.
2. The owner sees the **Hallnect UPI ID / QR** (from `platform_settings`,
   admin-configured) and the exact amount owed (from the DB, not the form).
3. The owner pays in their own UPI app, then enters the **UPI reference / UTR**
   (validated `^[A-Za-z0-9._-]{6,40}$`) and an optional screenshot link.
4. `submitCommissionUpiPayment` (`app/owner/(dashboard)/commissions/actions.ts`)
   inserts an `owner_commission_payments` row with `status = payment_submitted`.
   The commission is **not** marked paid.
5. The UI shows **"Waiting for admin verification."**

Guards:
- The amount is read from the commission row, never the client.
- The commission must belong to the owner (re-checked server-side + RLS).
- A partial unique index blocks a second open submission for the same commission.
- `guard_commission_payment_writes` blocks any owner attempt to set
  `verified`/`rejected` or the `verified_*` fields.

## Admin side (`/admin/commissions`)
- "UPI payments awaiting verification" lists each submission with owner, hall,
  booking id, amount, UTR, screenshot link, and date.
- **Approve & mark paid** → `verifyCommissionPayment(id, "approve", note)`:
  sets the submission `verified` (+ `verified_by`, `verified_at`) and the
  commission `paid` (+ `paid_at`, `payment_method`, `payment_reference`, note).
- **Reject** → submission `rejected`; the commission stays pending/overdue so the
  owner can retry.
- Idempotent: an already-verified/rejected submission cannot be re-decided.

All admin writes use the admin **session** client so `is_admin()` satisfies RLS and
the guard triggers while keeping the `auth.uid()` audit trail.

## Attaching a real gateway later
Replace the manual submission with a gateway order + webhook. On a
signature-verified webhook success you may mark the commission paid directly
(the "unless webhook confirms it" exception). Until then, **admin verification is
required** — do not auto-mark paid from an owner-entered reference.

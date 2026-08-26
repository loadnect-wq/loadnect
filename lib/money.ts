// ─────────────────────────────────────────────────────────────────────────────
// lib/money.ts — Integer-paise money helpers for the settlement engine.
//
// WHY PAISE INTEGERS: floating-point rupees accumulate rounding error and can
// produce fractions of a paise that never reconcile. The settlement engine
// (payment_transactions / commission_transactions / settlement_transactions)
// stores every amount as an INTEGER number of paise (₹1 = 100 paise) and does
// ALL arithmetic with integers, so commission + owner_share always sums exactly
// to the gross with no drift.
//
// This module is framework-agnostic and pure (no I/O), so it is safe to import
// anywhere. It does NOT change the existing rupee-`numeric` booking model — the
// paise ledger runs ALONGSIDE it (see supabase/migrations/0018).
// ─────────────────────────────────────────────────────────────────────────────

export const PAISE_PER_RUPEE = 100;

/** Rupees (number, possibly fractional) → integer paise. Rounds to nearest paise. */
export function toPaise(rupees: number): number {
  if (!Number.isFinite(rupees) || rupees < 0) {
    throw new RangeError(`toPaise: invalid rupee amount ${rupees}`);
  }
  return Math.round(rupees * PAISE_PER_RUPEE);
}

/** Integer paise → rupees (number). For display/format only — never for math. */
export function fromPaise(paise: number): number {
  assertIntPaise(paise);
  return paise / PAISE_PER_RUPEE;
}

/** Formats integer paise as an en-IN rupee string, e.g. 1000000 → "₹10,000". */
export function formatPaise(paise: number, opts?: { withDecimals?: boolean }): string {
  assertIntPaise(paise);
  const rupees = paise / PAISE_PER_RUPEE;
  return rupees.toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: opts?.withDecimals ? 2 : 0,
    maximumFractionDigits: opts?.withDecimals ? 2 : 0,
  });
}

export type CommissionSplit = {
  grossPaise:      number;
  commissionPaise: number;
  ownerPaise:      number;
  /** The rate actually applied, snapshotted for the ledger. */
  ratePercent:     number;
};

/**
 * Splits a gross advance (paise) into platform commission + owner share using
 * INTEGER math only, matching the spec:
 *   commission = floor(gross * rate / 100)   (rate is a percent, e.g. 10 or 7.5)
 *   owner      = gross - commission
 *
 * Guarantees (enforced, not assumed):
 *   • commission ≥ 0 and owner ≥ 0
 *   • commission + owner === gross   (no drift, ever)
 *   • commission ≤ gross
 *
 * Fractional percents are supported without floats by scaling to basis points
 * (rate * 100) and dividing by 10_000 with integer division.
 */
/**
 * Commission in paise charged on an arbitrary BASE, at `ratePercent`.
 *
 * Extracted so the commission base can differ from the amount being split.
 * Hallnect charges its percentage on the FULL HALL PRICE but retains it out of
 * the (smaller) advance, so "what the rate is applied to" and "what the money
 * comes out of" are two different numbers — see lib/booking-payment.ts.
 *
 * Integer arithmetic throughout, floor()ed, so the platform can never round a
 * fraction of a paisa in its own favour.
 */
export function commissionPaiseOn(basePaise: number, ratePercent: number): number {
  assertIntPaise(basePaise);
  if (!Number.isFinite(ratePercent) || ratePercent < 0 || ratePercent > 100) {
    throw new RangeError(`commissionPaiseOn: rate ${ratePercent} out of [0,100]`);
  }
  // rate percent → basis points (integer). 10% → 1000 bps; 7.5% → 750 bps.
  const rateBps = Math.round(ratePercent * 100);
  // floor(base * bps / 10000) using integer arithmetic.
  return Math.floor((basePaise * rateBps) / 10_000);
}

/**
 * Builds a split from an ALREADY-DECIDED commission, rather than recomputing.
 *
 * Needed because the commission base (the hall price) is not the amount being
 * split (the advance): re-applying the rate to the gross would produce a
 * different — and much smaller — number than the one actually charged. Callers
 * holding an authoritative commission snapshot must use this, so the ledger
 * records what the customer was really charged.
 *
 * Enforces the same invariants computeCommissionSplit does, so a corrupted
 * snapshot cannot write a split that fails to reconcile.
 */
export function splitFromParts(
  grossPaise: number,
  commissionPaise: number,
  ratePercent: number,
): CommissionSplit {
  assertIntPaise(grossPaise);
  assertIntPaise(commissionPaise);
  if (commissionPaise > grossPaise) {
    throw new RangeError(
      `splitFromParts: commission ${commissionPaise} exceeds gross ${grossPaise}`,
    );
  }
  const ownerPaise = grossPaise - commissionPaise;
  if (commissionPaise + ownerPaise !== grossPaise) {
    throw new RangeError("splitFromParts: split does not reconcile to gross");
  }
  return { grossPaise, commissionPaise, ownerPaise, ratePercent };
}

export function computeCommissionSplit(grossPaise: number, ratePercent: number): CommissionSplit {
  assertIntPaise(grossPaise);
  if (!Number.isFinite(ratePercent) || ratePercent < 0 || ratePercent > 100) {
    throw new RangeError(`computeCommissionSplit: rate ${ratePercent} out of [0,100]`);
  }

  const commissionPaise = commissionPaiseOn(grossPaise, ratePercent);
  const ownerPaise = grossPaise - commissionPaise;

  // Defensive invariants — should be impossible given the math above.
  if (commissionPaise < 0 || ownerPaise < 0 || commissionPaise > grossPaise) {
    throw new RangeError("computeCommissionSplit: split violated non-negative/bound invariants");
  }
  if (commissionPaise + ownerPaise !== grossPaise) {
    throw new RangeError("computeCommissionSplit: split does not reconcile to gross");
  }

  return { grossPaise, commissionPaise, ownerPaise, ratePercent };
}

function assertIntPaise(paise: number): void {
  if (!Number.isInteger(paise) || paise < 0) {
    throw new RangeError(`Expected a non-negative integer paise value, got ${paise}`);
  }
}

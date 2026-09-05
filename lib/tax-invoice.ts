// ─────────────────────────────────────────────────────────────────────────────
// lib/tax-invoice.ts — GST tax invoices for Hallnect's own supplies.
//
// WHAT IS INVOICED HERE, AND WHAT IS NOT.
//
// Hallnect invoices its OWN taxable supplies: the platform fee charged to the
// customer, and (when wired) the listing subscription sold to an owner. It does
// NOT invoice the hall booking. The venue rental is the OWNER's supply — the
// advance is collected as agent and passed on — so any invoice for it is the
// owner's to issue against the owner's own GSTIN. A marketplace that invoices a
// supply it did not make is claiming someone else's turnover as its own.
//
// This is the same boundary lib/booking-payment.ts draws when it taxes the fee
// and leaves the advance alone. If that boundary ever moves, both files move.
// ─────────────────────────────────────────────────────────────────────────────

import { CONTACT } from "@/lib/constants";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { PAISE_PER_RUPEE, toPaise } from "@/lib/money";

/**
 * SAC for the service being sold.
 *
 * 998599 — "Other support services nowhere else classified". This is the code
 * commonly applied to online-marketplace facilitation, and it is the best fit
 * for "we introduced you to a venue and processed the payment".
 *
 * CONFIRM THIS WITH YOUR CA BEFORE THE FIRST RETURN IS FILED. The code drives
 * the rate and the classification on GSTR-1; nobody should discover it was
 * wrong at assessment. It is a named constant precisely so changing it is one
 * edit, and historic invoices keep the code they were issued under because the
 * value is snapshotted onto each row.
 */
export const PLATFORM_FEE_SAC = "998599";

/**
 * Where the supply is treated as made.
 *
 * s.12(2) IGST Act: for a service supplied to an UNREGISTERED person, the place
 * of supply is the recipient's location where an address is on record, and
 * otherwise the supplier's location. Hallnect does not collect a customer's
 * address at checkout, so the supplier's state governs — Tamil Nadu.
 *
 * That makes every current invoice INTRA-state, so the 18% splits into CGST 9%
 * + SGST 9% rather than becoming IGST 18%. The customer pays the same either
 * way; what changes is which government is credited, which is why the split has
 * to be right rather than approximated.
 *
 * When customer addresses start being collected, this becomes a real decision
 * per invoice and splitTax() below is where it is made.
 */
export const SUPPLIER_STATE = "Tamil Nadu";
export const SUPPLIER_STATE_CODE = "33";

/**
 * The Indian financial year containing a date, as "2026-27".
 *
 * April to March, not January to December. An invoice series is unique per
 * financial year under Rule 46(b), so getting this boundary wrong silently
 * restarts or fails to restart the numbering.
 */
export function fiscalYearOf(date: Date): string {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth(); // 0 = January
  // Jan/Feb/Mar belong to the financial year that STARTED the previous April.
  const startYear = month >= 3 ? year : year - 1;
  const endShort = String((startYear + 1) % 100).padStart(2, "0");
  return `${startYear}-${endShort}`;
}

/**
 * Rule 46(b) invoice number: consecutive, unique for the financial year, and at
 * most sixteen characters. "HN/2026-27/00001" is exactly sixteen and leaves room
 * for 99,999 invoices in a year.
 */
export function formatInvoiceNumber(fiscalYear: string, serial: number): string {
  return `HN/${fiscalYear}/${String(serial).padStart(5, "0")}`;
}

export type TaxSplit = {
  taxableValue: number;
  cgstRate: number; cgstAmount: number;
  sgstRate: number; sgstAmount: number;
  igstRate: number; igstAmount: number;
  total: number;
};

/**
 * Splits a taxable value and a total rate into the CGST/SGST or IGST columns.
 *
 * INTEGER PAISE, AND THE HALVES ARE NOT COMPUTED INDEPENDENTLY. CGST is derived
 * and SGST is the remainder, so on an odd number of paise the two still sum
 * EXACTLY to the tax charged. Computing both as round(value * 9%) would, on
 * some amounts, produce a pair that sums to one paisa more or less than the
 * amount actually collected — and an invoice that does not add up is the one
 * document that must.
 */
export function splitTax(
  taxableValueRupees: number,
  totalRatePercent: number,
  interState = false,
): TaxSplit {
  const basePaise = toPaise(taxableValueRupees);
  const rateBps = Math.round(totalRatePercent * 100);
  const taxPaise = Math.round((basePaise * rateBps) / 10_000);

  if (interState) {
    return {
      taxableValue: basePaise / PAISE_PER_RUPEE,
      cgstRate: 0, cgstAmount: 0,
      sgstRate: 0, sgstAmount: 0,
      igstRate: totalRatePercent,
      igstAmount: taxPaise / PAISE_PER_RUPEE,
      total: (basePaise + taxPaise) / PAISE_PER_RUPEE,
    };
  }

  const cgstPaise = Math.floor(taxPaise / 2);
  const sgstPaise = taxPaise - cgstPaise; // remainder, so the halves reconcile
  const halfRate = totalRatePercent / 2;

  return {
    taxableValue: basePaise / PAISE_PER_RUPEE,
    cgstRate: halfRate, cgstAmount: cgstPaise / PAISE_PER_RUPEE,
    sgstRate: halfRate, sgstAmount: sgstPaise / PAISE_PER_RUPEE,
    igstRate: 0, igstAmount: 0,
    total: (basePaise + taxPaise) / PAISE_PER_RUPEE,
  };
}

export type IssueInvoiceInput = {
  kind: "platform_fee" | "subscription";
  bookingId?: string | null;
  planPurchaseId?: string | null;
  paymentId?: string | null;
  recipientName: string;
  recipientEmail?: string | null;
  recipientPhone?: string | null;
  recipientGstin?: string | null;
  description: string;
  /** The fee, EXCLUSIVE of tax. */
  taxableValue: number;
  /** Total GST percent, e.g. 18. */
  gstRate: number;
  interState?: boolean;
};

export type IssuedInvoice = { invoiceNumber: string; id: string };

/**
 * Issues a tax invoice, or returns the existing one for the same payment.
 *
 * IDEMPOTENT BY CONSTRUCTION. Cashfree can deliver the same webhook more than
 * once and verifyAndApplyPayment is deliberately replayable, so this is called
 * more than once for one supply. A unique index on payment_id makes a duplicate
 * insert fail with 23505 rather than mint a second document for the same
 * supply — and a second invoice for one supply is a real filing problem, not a
 * cosmetic one. The 23505 path re-reads and returns the invoice that already
 * exists.
 *
 * NEVER THROWS INTO THE PAYMENT PATH. Returns null on failure and logs. A
 * booking must not fail because its paperwork did — the payment is captured and
 * the customer is owed their booking either way. A missing invoice is fixable
 * afterwards; a failed capture is not.
 */
export async function issueTaxInvoice(
  input: IssueInvoiceInput,
): Promise<IssuedInvoice | null> {
  if (!CONTACT.gstin) {
    console.error("[tax-invoice] no GSTIN configured — cannot issue an invoice");
    return null;
  }
  if (!(input.taxableValue > 0)) {
    // A waived fee is not a supply. No invoice is due and none is issued.
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getSupabaseAdminClient() as any;

  // Already issued? Cheaper than provoking a constraint violation, and it keeps
  // the counter untouched on the common replay path.
  if (input.paymentId) {
    const { data: existing } = await db
      .from("tax_invoices")
      .select("id, invoice_number")
      .eq("payment_id", input.paymentId)
      .maybeSingle();
    if (existing) {
      return { invoiceNumber: existing.invoice_number, id: existing.id };
    }
  }

  const now = new Date();
  const fiscalYear = fiscalYearOf(now);

  const { data: serial, error: serialErr } = await db
    .rpc("next_invoice_serial", { _fiscal_year: fiscalYear });
  if (serialErr || typeof serial !== "number") {
    console.error("[tax-invoice] could not allocate a serial:", serialErr?.message);
    return null;
  }

  const split = splitTax(input.taxableValue, input.gstRate, input.interState ?? false);
  const invoiceNumber = formatInvoiceNumber(fiscalYear, serial);

  const { data: row, error } = await db
    .from("tax_invoices")
    .insert({
      invoice_number:   invoiceNumber,
      fiscal_year:      fiscalYear,
      serial,
      booking_id:       input.bookingId ?? null,
      plan_purchase_id: input.planPurchaseId ?? null,
      payment_id:       input.paymentId ?? null,
      kind:             input.kind,
      supplier_name:    CONTACT.legalName,
      supplier_gstin:   CONTACT.gstin,
      supplier_address: CONTACT.address,
      recipient_name:   input.recipientName,
      recipient_email:  input.recipientEmail ?? null,
      recipient_phone:  input.recipientPhone ?? null,
      recipient_gstin:  input.recipientGstin ?? null,
      sac_code:         PLATFORM_FEE_SAC,
      description:      input.description,
      place_of_supply:  `${SUPPLIER_STATE} (${SUPPLIER_STATE_CODE})`,
      taxable_value:    split.taxableValue,
      cgst_rate:        split.cgstRate,  cgst_amount: split.cgstAmount,
      sgst_rate:        split.sgstRate,  sgst_amount: split.sgstAmount,
      igst_rate:        split.igstRate,  igst_amount: split.igstAmount,
      total_amount:     split.total,
    })
    .select("id, invoice_number")
    .single();

  if (error) {
    // 23505 = another replay won the race and issued it first. Return theirs.
    if (error.code === "23505" && input.paymentId) {
      const { data: raced } = await db
        .from("tax_invoices")
        .select("id, invoice_number")
        .eq("payment_id", input.paymentId)
        .maybeSingle();
      if (raced) return { invoiceNumber: raced.invoice_number, id: raced.id };
    }
    console.error("[tax-invoice] insert failed:", error.code, error.message);
    return null;
  }

  return { invoiceNumber: row.invoice_number, id: row.id };
}

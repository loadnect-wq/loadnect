import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PrintButton } from "./_components/PrintButton";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { formatPrice } from "@/lib/mock-data";

// WHY THIS PAGE IS READ THROUGH THE SESSION CLIENT AND NOT THE SERVICE ROLE.
//
// tax_invoices carries an RLS policy that admits an admin, or the customer on
// the invoice's booking, and nobody else. Reading through the session client
// means that policy IS the authorisation check — there is no second, hand-rolled
// ownership test in this file that could disagree with it. A service-role read
// here would bypass RLS and make this page's correctness depend on my
// remembering to re-implement the same rule.
//
// An id belonging to someone else therefore returns no row, and this renders a
// 404 rather than leaking that the invoice exists.

export const metadata: Metadata = {
  title: "Tax Invoice",
  robots: { index: false, follow: false },
};

type Props = { params: Promise<{ id: string }> };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type InvoiceRow = any;

export default async function InvoicePage({ params }: Props) {
  const { id } = await params;
  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: inv }: { data: InvoiceRow } = await db
    .from("tax_invoices")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!inv) notFound();

  const interState = Number(inv.igst_amount) > 0;

  return (
    <div className="min-h-screen bg-ivory-50 py-8 print:bg-white print:py-0">
      <div className="mx-auto max-w-3xl px-4 print:max-w-none print:px-0">

        {/* Screen-only controls. An invoice is a document, so the chrome around
            it disappears when it is printed or saved as PDF. */}
        <div className="mb-6 flex items-center justify-between print:hidden">
          <Link
            href={inv.booking_id ? `/customer/bookings/${inv.booking_id}` : "/customer/bookings"}
            className="inline-flex items-center gap-1.5 text-sm text-charcoal-600 hover:text-maroon-700"
          >
            <ArrowLeft className="h-4 w-4" /> Back to booking
          </Link>
          <PrintButton />
        </div>

        <article className="rounded-xl border border-border bg-white p-8 shadow-card print:rounded-none print:border-0 print:p-0 print:shadow-none">

          <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-6">
            <div>
              <h1 className="font-serif text-2xl font-bold text-charcoal-900">Tax Invoice</h1>
              <p className="mt-1 text-xs uppercase tracking-widest text-gold-600">
                Original for recipient
              </p>
            </div>
            <dl className="text-right text-sm">
              <div className="flex justify-end gap-2">
                <dt className="text-muted-foreground">Invoice no.</dt>
                <dd className="font-mono font-semibold text-charcoal-900">{inv.invoice_number}</dd>
              </div>
              <div className="mt-1 flex justify-end gap-2">
                <dt className="text-muted-foreground">Date</dt>
                <dd className="text-charcoal-800">
                  {new Date(inv.issued_at).toLocaleDateString("en-IN", {
                    day: "2-digit", month: "short", year: "numeric",
                  })}
                </dd>
              </div>
            </dl>
          </header>

          <div className="grid gap-8 border-b border-border py-6 sm:grid-cols-2">
            <Party
              heading="Supplier"
              name={inv.supplier_name}
              lines={[inv.supplier_address]}
              gstinLabel="GSTIN"
              gstin={inv.supplier_gstin}
            />
            <Party
              heading="Recipient"
              name={inv.recipient_name}
              lines={[inv.recipient_email, inv.recipient_phone].filter(Boolean) as string[]}
              gstinLabel="GSTIN"
              gstin={inv.recipient_gstin}
            />
          </div>

          <div className="border-b border-border py-4 text-sm">
            <span className="text-muted-foreground">Place of supply: </span>
            <span className="text-charcoal-800">{inv.place_of_supply}</span>
          </div>

          {/* Rule 46 line items. overflow-x-auto so a narrow phone scrolls the
              table rather than the whole page. */}
          <div className="-mx-2 overflow-x-auto py-6">
            <table className="w-full min-w-[520px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-2 pb-2 font-semibold">Description</th>
                  <th className="px-2 pb-2 font-semibold">SAC</th>
                  <th className="px-2 pb-2 text-right font-semibold">Taxable value</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-border">
                  <td className="px-2 py-3 text-charcoal-800">{inv.description}</td>
                  <td className="px-2 py-3 font-mono text-xs text-charcoal-600">{inv.sac_code}</td>
                  <td className="px-2 py-3 text-right tabular-nums text-charcoal-900">
                    {formatPrice(Number(inv.taxable_value))}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="ml-auto max-w-xs space-y-1.5 text-sm">
            <Row label="Taxable value" value={Number(inv.taxable_value)} />
            {interState ? (
              <Row label={`IGST @ ${fmtRate(inv.igst_rate)}%`} value={Number(inv.igst_amount)} />
            ) : (
              <>
                <Row label={`CGST @ ${fmtRate(inv.cgst_rate)}%`} value={Number(inv.cgst_amount)} />
                <Row label={`SGST @ ${fmtRate(inv.sgst_rate)}%`} value={Number(inv.sgst_amount)} />
              </>
            )}
            <div className="!mt-3 flex items-center justify-between border-t border-charcoal-900 pt-2">
              <span className="font-semibold text-charcoal-900">Total</span>
              <span className="font-serif text-lg font-bold tabular-nums text-charcoal-900">
                {formatPrice(Number(inv.total_amount))}
              </span>
            </div>
          </div>

          {/* What this invoice covers, stated plainly. A customer who paid an
              advance as well will otherwise wonder why the total is smaller
              than the amount that left their account. */}
          <footer className="mt-8 border-t border-border pt-5 text-xs leading-relaxed text-charcoal-600">
            <p>
              This invoice covers <strong>Hallnect&apos;s platform fee only</strong>. Any advance
              paid towards the venue booking is consideration for the venue&apos;s own supply,
              collected by Hallnect on the venue&apos;s behalf, and is not invoiced here — the
              venue issues its own document for that where it is required to.
            </p>
            <p className="mt-2">
              This is a computer-generated invoice and does not require a signature.
            </p>
          </footer>
        </article>
      </div>
    </div>
  );
}

/** Trailing zeros on a rate read as noise: 9.00% becomes 9%, 2.50% stays 2.5%. */
function fmtRate(rate: unknown): string {
  const n = Number(rate ?? 0);
  return Number.isInteger(n) ? String(n) : String(n);
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-charcoal-600">{label}</span>
      <span className="tabular-nums text-charcoal-900">{formatPrice(value)}</span>
    </div>
  );
}

function Party({
  heading, name, lines, gstin, gstinLabel,
}: {
  heading: string; name: string; lines: string[]; gstin?: string | null; gstinLabel: string;
}) {
  return (
    <div>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {heading}
      </h2>
      <p className="mt-2 font-semibold text-charcoal-900">{name}</p>
      {lines.map((l) => (
        <p key={l} className="text-sm leading-relaxed text-charcoal-600">{l}</p>
      ))}
      {gstin ? (
        <p className="mt-1.5 text-sm text-charcoal-700">
          <span className="text-muted-foreground">{gstinLabel}: </span>
          <span className="font-mono">{gstin}</span>
        </p>
      ) : null}
    </div>
  );
}

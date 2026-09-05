"use client";

import { Printer } from "lucide-react";

/**
 * The only interactive element on the invoice.
 *
 * window.print() is what turns this page into the PDF a customer files or
 * forwards to their accountant, so it is worth the one client component. The
 * page's print styles strip the surrounding chrome, including this button.
 */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-sm font-medium text-charcoal-700 transition-colors hover:border-maroon-300 hover:text-maroon-700"
    >
      <Printer className="h-4 w-4" aria-hidden="true" />
      Print or save as PDF
    </button>
  );
}

"use client";

import { Printer } from "lucide-react";

/**
 * Opens the print dialog, where "Save as PDF" is also offered — which is how
 * most owners will get the standee to a print shop from a phone.
 */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-maroon-600 text-base font-semibold text-white hover:bg-maroon-700 print:hidden"
    >
      <Printer className="h-5 w-5" aria-hidden /> Print or save as PDF
    </button>
  );
}

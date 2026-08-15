"use client";

import Link from "next/link";
import { Mic, Search } from "lucide-react";

export function HomeSearchEntry() {
  return (
    <Link
      href="/halls"
      className="flex items-center gap-3 rounded-2xl bg-white px-4 py-3.5 shadow-card transition-transform active:scale-[0.99]"
    >
      <Search className="h-5 w-5 shrink-0 text-maroon-500" aria-hidden />
      <span className="flex-1 truncate text-sm text-charcoal-500">
        Search by hall name, city or area…
      </span>
      <span
        aria-label="Voice search"
        className="flex h-8 w-8 items-center justify-center rounded-full bg-maroon-50 text-maroon-600"
      >
        <Mic className="h-4 w-4" />
      </span>
    </Link>
  );
}

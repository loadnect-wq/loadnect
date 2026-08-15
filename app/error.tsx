"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, Home, RefreshCcw } from "lucide-react";

interface Props {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: Props) {
  useEffect(() => {
    // Log to the browser console; the server already logged with redaction.
    // Don't render error.message — Next App Router replaces it with a generic
    // message in production builds anyway, but locally it can include internals.
    console.error("[route-error] digest=", error.digest);
  }, [error]);

  return (
    <section className="flex min-h-[60vh] flex-col items-center justify-center bg-ivory-100 px-4 py-20 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-50 text-red-600">
        <AlertTriangle className="h-8 w-8" />
      </div>
      <h1 className="mt-5 font-serif text-3xl font-bold text-charcoal-900 sm:text-4xl">
        Something went wrong
      </h1>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-charcoal-500">
        We hit an unexpected error. The team has been notified. You can try the
        page again, or head back to the home page.
      </p>
      {error.digest && (
        <p className="mt-2 text-[11px] text-charcoal-400">
          Reference: <code className="font-mono">{error.digest}</code>
        </p>
      )}
      <div className="mt-8 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-maroon-700 px-5 py-2.5 text-sm font-semibold text-ivory-100 shadow-card transition-colors hover:bg-maroon-800"
        >
          <RefreshCcw className="h-4 w-4" /> Try again
        </button>
        <Link
          href="/"
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-white px-5 py-2.5 text-sm font-semibold text-charcoal-700 transition-colors hover:border-maroon-300 hover:text-maroon-700"
        >
          <Home className="h-4 w-4" /> Back to Home
        </Link>
      </div>
    </section>
  );
}

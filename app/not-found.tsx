import Link from "next/link";
import { Home, Search } from "lucide-react";

export default function NotFound() {
  return (
    <section className="flex min-h-[60vh] flex-col items-center justify-center bg-ivory-100 px-4 py-20 text-center">
      <p className="text-sm font-semibold uppercase tracking-widest text-gold-500">✦ 404 ✦</p>
      <h1 className="mt-3 font-serif text-5xl font-bold text-maroon-800 sm:text-6xl">Page not found</h1>
      <p className="mt-4 max-w-md text-sm leading-relaxed text-charcoal-500">
        The page you&apos;re looking for doesn&apos;t exist or has been moved.
        Try searching for a venue or head back to the home page.
      </p>
      <div className="mt-8 flex flex-col gap-2 sm:flex-row">
        <Link
          href="/"
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-maroon-700 px-5 py-2.5 text-sm font-semibold text-ivory-100 shadow-card transition-colors hover:bg-maroon-800"
        >
          <Home className="h-4 w-4" /> Back to Home
        </Link>
        <Link
          href="/halls"
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-white px-5 py-2.5 text-sm font-semibold text-charcoal-700 transition-colors hover:border-maroon-300 hover:text-maroon-700"
        >
          <Search className="h-4 w-4" /> Browse Halls
        </Link>
      </div>
    </section>
  );
}

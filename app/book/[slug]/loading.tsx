import { Skeleton } from "@/components/ui/skeleton";

// Shown while the booking flow loads the hall + availability window, so the
// stepped booking screen never flashes blank on entry.
export default function BookFlowLoading() {
  return (
    <div className="min-h-screen bg-ivory-100 pb-32">
      {/* Sticky header + progress bar */}
      <header className="sticky top-0 z-30 border-b border-border bg-white">
        <div className="flex h-14 items-center gap-3 px-4">
          <Skeleton className="h-9 w-9 rounded-full" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-2.5 w-16 rounded-full" />
            <Skeleton className="mt-1 h-4 w-40 rounded-full" />
          </div>
          <Skeleton className="h-3 w-12 rounded-full" />
        </div>
        <div className="h-1 w-full bg-ivory-200">
          <div className="h-full w-1/6 bg-gradient-to-r from-maroon-500 to-gold-500" />
        </div>
      </header>

      {/* Step content — date-grid skeleton */}
      <main className="container-app pt-5 lg:max-w-2xl">
        <Skeleton className="h-6 w-44 rounded-full" />
        <Skeleton className="mt-2 h-4 w-64 rounded-full" />
        <div className="mt-5 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} className="h-[76px] rounded-2xl" />
          ))}
        </div>
      </main>

      {/* Sticky CTA */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-white px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3">
        <div className="mx-auto max-w-lg">
          <Skeleton className="h-12 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}

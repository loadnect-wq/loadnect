import { Skeleton, SkeletonCard } from "@/components/ui/skeleton";

export default function HallsLoading() {
  return (
    <div className="min-h-screen bg-ivory-100">
      {/* AppHeader skeleton */}
      <div className="h-14 border-b border-border bg-white" />

      {/* SearchControls skeleton */}
      <div className="sticky top-14 z-20 border-b border-border bg-white/95 px-4 py-3">
        <Skeleton className="h-11 w-full rounded-2xl" />
        <div className="mt-3 flex gap-2 overflow-hidden">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-24 shrink-0 rounded-full" />
          ))}
        </div>
        <Skeleton className="mt-2 h-3 w-20 rounded-full" />
      </div>

      {/* Cards skeleton */}
      <section className="container-app py-4 lg:max-w-7xl">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      </section>
    </div>
  );
}

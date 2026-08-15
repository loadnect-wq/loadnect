import { Skeleton } from "@/components/ui/skeleton";

export default function CustomerLoading() {
  return (
    <div className="min-h-screen bg-ivory-100 pb-10">
      {/* Header bar */}
      <div className="h-14 border-b border-border bg-white" />

      {/* Hero greeting */}
      <div className="px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="mt-2 h-7 w-56" />
        <Skeleton className="mt-2 h-3 w-40" />
      </div>

      {/* Stats / quick-action cards */}
      <div className="px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
      </div>

      {/* Booking cards section */}
      <div className="mt-7 px-4 sm:px-6 lg:px-8">
        <Skeleton className="h-5 w-32" />
        <div className="mt-3 space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
      </div>
    </div>
  );
}

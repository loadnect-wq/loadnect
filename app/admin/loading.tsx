import { Skeleton } from "@/components/ui/skeleton";

export default function AdminLoading() {
  return (
    <div className="min-h-screen bg-ivory-100">
      {/* Page header */}
      <div className="px-4 py-5 sm:px-6 lg:px-8">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="mt-2 h-3 w-80" />
      </div>

      {/* Stats grid */}
      <div className="px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-2xl bg-white p-4 shadow-card">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-2 h-7 w-20" />
              <Skeleton className="mt-2 h-3 w-28" />
            </div>
          ))}
        </div>
      </div>

      {/* Table skeleton */}
      <div className="mt-7 px-4 sm:px-6 lg:px-8">
        <div className="overflow-hidden rounded-2xl bg-white shadow-card">
          <div className="border-b border-border bg-ivory-50 px-4 py-3">
            <Skeleton className="h-4 w-32" />
          </div>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="grid grid-cols-4 items-center gap-4 border-b border-border px-4 py-3 last:border-b-0">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-8 w-24 justify-self-end rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

import { Skeleton } from "@/components/ui/skeleton";

export default function OwnerDashboardLoading() {
  return (
    <div className="min-h-screen bg-ivory-100">
      {/* Page header */}
      <div className="px-4 py-5 sm:px-6 lg:px-8">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="mt-2 h-3 w-72" />
      </div>

      {/* Stats grid */}
      <div className="px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-2xl bg-white p-4 shadow-card">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-2 h-6 w-16" />
              <Skeleton className="mt-2 h-3 w-24" />
            </div>
          ))}
        </div>
      </div>

      {/* Two-column data sections */}
      <div className="mt-7 grid grid-cols-1 gap-4 px-4 sm:px-6 lg:grid-cols-2 lg:px-8">
        {Array.from({ length: 2 }).map((_, col) => (
          <div key={col} className="rounded-2xl bg-white p-4 shadow-card">
            <Skeleton className="h-5 w-32" />
            <div className="mt-3 space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between rounded-xl border border-border px-3 py-2.5">
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                  <Skeleton className="h-7 w-16 rounded-lg" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

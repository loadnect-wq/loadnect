import { Skeleton } from "@/components/ui/skeleton";

export default function HallDetailLoading() {
  return (
    <div className="min-h-screen bg-ivory-100">
      {/* Mirrors ImageGallery's box: full-bleed and pinned-height on mobile,
          then bounded to the content container with a 2:1 mosaic block at lg.
          A skeleton that describes a different box than the thing it stands in
          for produces a visible jump and a sideways shift on first paint. */}
      <div className="lg:mx-auto lg:max-w-6xl lg:px-6">
        <Skeleton className="h-64 w-full rounded-none sm:h-80 lg:h-auto lg:aspect-[2/1] lg:rounded-2xl" />
      </div>
      <div className="container-page py-8">
        <div className="grid gap-8 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-8">
            <div className="space-y-3">
              <Skeleton className="h-9 w-2/3" />
              <Skeleton className="h-4 w-1/3" />
            </div>
            <div className="space-y-3">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
            </div>
            <div className="space-y-3">
              <Skeleton className="h-6 w-32" />
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-6" />
                ))}
              </div>
            </div>
          </div>
          <div className="lg:col-span-1">
            <Skeleton className="h-72 rounded-2xl" />
          </div>
        </div>
      </div>
    </div>
  );
}

import { cn } from "@/lib/utils";
import { HTMLAttributes } from "react";

function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg bg-ivory-200",
        "before:absolute before:inset-0",
        "before:bg-shimmer-gradient before:bg-[length:200%_100%]",
        "before:animate-shimmer",
        className
      )}
      {...props}
    />
  );
}

// Pre-composed skeletons for common patterns
function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn("h-4", i === lines - 1 && lines > 1 ? "w-3/4" : "w-full")}
        />
      ))}
    </div>
  );
}

function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-xl border border-border bg-card shadow-card", className)}>
      <Skeleton className="h-48 w-full rounded-none" />
      <div className="p-5 space-y-3">
        <Skeleton className="h-5 w-2/3" />
        <SkeletonText lines={2} />
        <div className="flex items-center justify-between pt-1">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-9 w-28 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

export { Skeleton, SkeletonText, SkeletonCard };

import { Skeleton } from "@/components/ui/skeleton";

// Shown while the server verifies the payment with Cashfree and loads the
// booking — prevents a blank flash on the page the customer lands on straight
// after checkout (the highest-anxiety moment in the flow).
export default function BookingStatusLoading() {
  return (
    <div className="min-h-screen bg-ivory-100 px-4 py-10">
      <div className="mx-auto max-w-md">
        <div className="rounded-2xl bg-white p-6 shadow-card">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-ivory-200">
            <Skeleton className="h-8 w-8 rounded-full" />
          </div>
          <Skeleton className="mx-auto mt-4 h-5 w-40 rounded-full" />
          <Skeleton className="mx-auto mt-2 h-3 w-56 rounded-full" />

          <div className="mt-6 space-y-3">
            <Skeleton className="h-4 w-full rounded-full" />
            <Skeleton className="h-4 w-5/6 rounded-full" />
            <Skeleton className="h-4 w-2/3 rounded-full" />
          </div>

          <Skeleton className="mt-6 h-11 w-full rounded-xl" />
        </div>
        <p className="mt-4 text-center text-xs text-charcoal-500">Confirming your payment…</p>
      </div>
    </div>
  );
}

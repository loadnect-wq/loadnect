// A pass-through layout, and it is load-bearing: it keeps this route's
// loading.tsx (the venue skeleton, shown while a preview renders per request)
// scoped to /halls/[slug]/preview. Without it the skeleton was attached to the
// public venue page as well, and wrapped it in a Suspense boundary — see
// app/halls/(browse)/layout.tsx for what that costs.
export default function PreviewLayout({ children }: { children: React.ReactNode }) {
  return children;
}

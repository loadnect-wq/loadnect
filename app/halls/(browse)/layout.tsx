// A pass-through layout, and it is load-bearing. Without a layout of its own,
// this group's loading.tsx (the listing skeleton) was attached a level up and
// wrapped the venue pages at /halls/[slug] too — a Suspense boundary that made
// a missing venue a soft 404 and hid the venue's text in a streamed block
// until JavaScript ran. With this layout the skeleton covers /halls only.
export default function BrowseLayout({ children }: { children: React.ReactNode }) {
  return children;
}

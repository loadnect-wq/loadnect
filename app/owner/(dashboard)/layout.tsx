import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { OwnerSidebarNav } from "./_components/OwnerSidebarNav";
import { OwnerBottomNav } from "./_components/OwnerBottomNav";

// SEO: this whole subtree is private. Declaring robots ONCE on the layout means
// every nested page inherits noindex — a new page added under here cannot leak
// into the index by forgetting a directive.
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

export default async function OwnerDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireRole(["owner_approved"]);
  const initial = (profile.full_name ?? profile.email ?? "?")[0].toUpperCase();

  return (
    <div className="min-h-screen bg-ivory-100">
      <div className="lg:mx-auto lg:max-w-7xl lg:flex">
        {/* Desktop sidebar */}
        <aside className="hidden lg:flex lg:w-56 lg:shrink-0 lg:flex-col">
          <div className="sticky top-16 h-[calc(100vh-4rem)] overflow-y-auto border-r border-border bg-white">
            <div className="px-4 py-5 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-maroon-700 font-bold text-white text-sm">
                  {initial}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-charcoal-900">
                    {profile.full_name ?? "My Account"}
                  </p>
                  <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-gold-600">
                    Owner
                  </p>
                </div>
              </div>
            </div>
            <OwnerSidebarNav />
          </div>
        </aside>

        {/* Page content. Bottom padding on mobile only, so the tab bar never
            covers the last row of a list or a submit button. */}
        <div className="min-w-0 flex-1 pb-20 lg:pb-0">{children}</div>
      </div>

      {/* Phone navigation. The sidebar above is lg-only, so without this an
          owner on a phone had no way to move around their own dashboard. */}
      <OwnerBottomNav />
    </div>
  );
}

import { requireRole } from "@/lib/auth";
import { CustomerSidebarNav } from "./_components/CustomerSidebarNav";

export default async function CustomerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireRole(["customer"]);
  const initial = (profile.full_name ?? profile.email ?? "?")[0].toUpperCase();

  return (
    <div className="min-h-screen bg-ivory-100">
      <div className="lg:mx-auto lg:max-w-6xl lg:flex">
        {/* Desktop sidebar */}
        <aside className="hidden lg:flex lg:w-56 lg:shrink-0 lg:flex-col">
          <div className="sticky top-16 h-[calc(100vh-4rem)] overflow-y-auto border-r border-border bg-white">
            <div className="px-4 py-5 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-maroon-100 font-bold text-maroon-700">
                  {initial}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-charcoal-900">
                    {profile.full_name ?? "My Account"}
                  </p>
                  <p className="truncate text-[11px] text-charcoal-500">{profile.email}</p>
                </div>
              </div>
            </div>
            <CustomerSidebarNav />
          </div>
        </aside>

        {/* Page content */}
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}

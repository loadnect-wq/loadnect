import Link from "next/link";
import { Shield } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { fetchAdminStats } from "@/lib/admin";
import { AdminSidebarNav } from "./_components/AdminSidebarNav";
import { AdminMobileNav } from "./_components/AdminMobileNav";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // SERVER-SIDE guard. Anything other than role='admin' is redirected here.
  // This runs on every nested page render — no way to bypass via client routing.
  const profile = await requireRole(["admin"]);
  const stats   = await fetchAdminStats();
  const initial = (profile.full_name ?? profile.email ?? "?")[0].toUpperCase();

  return (
    <div className="min-h-screen bg-ivory-100">
      <div className="lg:flex">
        {/* Desktop sidebar */}
        <aside className="hidden lg:flex lg:w-64 lg:shrink-0 lg:flex-col">
          <div className="sticky top-0 h-screen overflow-y-auto border-r border-border bg-white">
            {/* Brand */}
            <Link
              href="/admin/dashboard"
              className="flex items-center gap-2 border-b border-border px-4 py-4 hover:bg-ivory-100/40"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-maroon-700 text-ivory-100">
                <Shield className="h-4 w-4" />
              </span>
              <div>
                <p className="font-serif text-base font-bold text-maroon-800 leading-tight">Hallnect</p>
                <p className="text-[10px] font-bold uppercase tracking-wider text-charcoal-500 leading-none">Admin</p>
              </div>
            </Link>

            {/* User card */}
            <div className="border-b border-border px-4 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-charcoal-900 font-bold text-white text-sm">
                  {initial}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-charcoal-900">
                    {profile.full_name ?? "Admin"}
                  </p>
                  <p className="truncate text-[11px] text-charcoal-500">{profile.email}</p>
                </div>
              </div>
            </div>

            {/* Navigation */}
            <AdminSidebarNav counts={{
              pendingHalls:  stats.open.pendingHalls,
              pendingOwners: stats.open.pendingOwners,
              openTickets:   stats.open.openTickets,
              pendingAds:    stats.open.pendingAds,
            }} />
          </div>
        </aside>

        {/* Page content */}
        <div className="min-w-0 flex-1">
          {/* Mobile-only section nav — the sidebar above is hidden below lg and
              the customer BottomNav excludes /admin, so without this the admin
              area is unnavigable on a phone. lg:hidden keeps desktop identical. */}
          <AdminMobileNav counts={{
            pendingHalls:  stats.open.pendingHalls,
            pendingOwners: stats.open.pendingOwners,
            openTickets:   stats.open.openTickets,
            pendingAds:    stats.open.pendingAds,
          }} />
          {children}
        </div>
      </div>
    </div>
  );
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LogOut } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { fetchOwnerRow } from "@/lib/owner";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/app/AppHeader";
import { OwnerProfileForm } from "./_components/OwnerProfileForm";

export const metadata: Metadata = { title: "Owner Profile" };

export default async function OwnerProfilePage() {
  const profile  = await requireRole(["owner_approved"]);
  const ownerRow = await fetchOwnerRow();

  return (
    <div className="min-h-screen bg-ivory-100">
      <AppHeader title="Profile" />

      <div className="px-4 py-5 sm:px-6 lg:px-8 max-w-2xl space-y-5">

        {/* Identity card */}
        <div className="rounded-2xl bg-gradient-to-br from-maroon-800 to-maroon-950 p-5 text-ivory-100 shadow-elevated">
          <div className="flex items-center gap-3">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gold-400 text-maroon-900 font-serif text-xl font-bold">
              {(profile.full_name ?? profile.email ?? "?")[0].toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="truncate font-serif text-lg font-bold">{profile.full_name ?? "Owner"}</p>
              <p className="truncate text-xs text-ivory-400">{profile.email}</p>
              <span className="mt-1 inline-block rounded-full bg-gold-400/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gold-300">
                Verified Owner
              </span>
            </div>
          </div>
        </div>

        <OwnerProfileForm
          ownerRow={ownerRow}
          fullName={profile.full_name}
          email={profile.email}
          phone={null}
        />

        {/* Sign out */}
        <form
          action={async () => {
            "use server";
            const sc = await getSupabaseServerClient();
            await sc.auth.signOut();
            redirect("/login");
          }}
        >
          <button
            type="submit"
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-white py-3 text-sm font-semibold text-red-600 shadow-card active:scale-[0.99] transition-transform"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </form>
      </div>
    </div>
  );
}

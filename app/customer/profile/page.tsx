import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LogOut, Shield } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/app/AppHeader";
import { ProfileEditForm } from "./_components/ProfileEditForm";

export const metadata: Metadata = { title: "Profile" };

export default async function ProfilePage() {
  const profile = await requireRole(["customer"]);

  // Fetch phone — not included in the cached requireRole profile
  const supabase = await getSupabaseServerClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: extra } = await (supabase as any)
    .from("profiles")
    .select("phone")
    .eq("id", profile.id)
    .maybeSingle();

  const initial = (profile.full_name ?? profile.email ?? "?")[0].toUpperCase();

  return (
    <div className="min-h-screen bg-ivory-100 pb-10">
      <AppHeader title="Profile" />

      <div className="px-4 py-5 sm:px-6 lg:px-8 space-y-5">
        {/* Avatar card */}
        <div className="flex items-center gap-4 rounded-2xl bg-gradient-to-br from-maroon-800 to-maroon-950 p-5 text-ivory-100 shadow-elevated">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-gold-400 font-serif text-2xl font-bold text-maroon-900">
            {initial}
          </div>
          <div className="min-w-0">
            <p className="truncate font-serif text-lg font-bold">
              {profile.full_name ?? "My Account"}
            </p>
            <p className="truncate text-sm text-ivory-400">{profile.email}</p>
            <span className="mt-1 inline-block rounded-full bg-gold-400/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gold-300">
              Customer
            </span>
          </div>
        </div>

        {/* Edit form */}
        <div className="rounded-2xl bg-white shadow-card p-5 space-y-1">
          <h2 className="font-serif text-base font-semibold text-charcoal-900 mb-4">
            Edit Profile
          </h2>
          <ProfileEditForm
            initialName={profile.full_name}
            initialPhone={(extra as { phone?: string | null } | null)?.phone ?? null}
            email={profile.email}
          />
        </div>

        {/* Security info */}
        <div className="rounded-2xl bg-white shadow-card p-4 flex items-start gap-3">
          <Shield className="h-5 w-5 shrink-0 mt-0.5 text-maroon-500" />
          <div>
            <p className="text-sm font-semibold text-charcoal-900">Account security</p>
            <p className="mt-0.5 text-xs text-charcoal-500 leading-relaxed">
              Your role and email address are managed by Hallnect and cannot be changed here.
              To update your email, contact support.
            </p>
          </div>
        </div>

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
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </form>

        <p className="text-center text-[11px] text-charcoal-400">Hallnect · Customer Dashboard</p>

        {/* Back to full profile / settings */}
        <div className="text-center space-y-1">
          <Link href="/customer/support" className="block text-xs text-maroon-600 underline underline-offset-2">
            Contact support
          </Link>
          <Link href="/profile" className="text-xs text-charcoal-400 underline underline-offset-2">
            View full settings
          </Link>
        </div>
      </div>
    </div>
  );
}

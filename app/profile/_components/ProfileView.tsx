"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bell, ChevronRight, CreditCard, FileText, HelpCircle,
  LayoutDashboard, LogIn, LogOut, MapPin, Phone, Settings, ShieldCheck, User,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { getSupabaseClient } from "@/lib/supabase/client";
import { getDashboardPath } from "@/lib/constants";

type ProfileState = {
  fullName: string | null;
  email: string | null;
  role: string;
  phone: string | null;
  phoneVerified: boolean;
} | null;

export function ProfileView() {
  const router = useRouter();
  const [profile, setProfile] = useState<ProfileState>(null);
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    const supabase = getSupabaseClient();
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setProfile(null); setLoading(false); return; }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await supabase
        .from("profiles" as any)
        .select("full_name, email, role, phone, phone_verified")
        .eq("id", user.id)
        .single();
      if (data) {
        const d = data as {
          full_name: string | null; email: string | null; role: string;
          phone: string | null; phone_verified: boolean | null;
        };
        setProfile({
          fullName: d.full_name, email: d.email, role: d.role,
          phone: d.phone, phoneVerified: Boolean(d.phone_verified),
        });
      }
      setLoading(false);
    }
    load();
  }, []);

  async function signOut() {
    setSigningOut(true);
    await getSupabaseClient().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  if (loading) {
    return (
      <div className="container-app py-6 space-y-3">
        <div className="h-24 animate-pulse rounded-2xl bg-white/70" />
        <div className="h-12 animate-pulse rounded-2xl bg-white/70" />
        <div className="h-12 animate-pulse rounded-2xl bg-white/70" />
      </div>
    );
  }

  return (
    <div className="container-app py-5 space-y-5 pb-6">

      {/* Identity card */}
      {profile ? (
        <div className="rounded-2xl bg-gradient-to-br from-maroon-800 to-maroon-950 p-5 text-ivory-100 shadow-elevated">
          <div className="flex items-center gap-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gold-400 text-maroon-900 font-serif text-xl font-bold">
              {(profile.fullName ?? profile.email ?? "?").slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="truncate font-serif text-lg font-bold">{profile.fullName ?? "Welcome"}</p>
              <p className="truncate text-xs text-ivory-400">{profile.email}</p>
              <span className="mt-1 inline-block rounded-full bg-gold-400/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gold-300">
                {profile.role.replace("_", " ")}
              </span>
            </div>
          </div>
          <div className="mt-4">
            <Link href={getDashboardPath(profile.role)}>
              <Button variant="gold" className="w-full">
                <LayoutDashboard className="h-4 w-4" /> Open Dashboard
              </Button>
            </Link>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl bg-white p-5 shadow-card">
          <p className="font-serif text-lg font-bold text-charcoal-900">You&apos;re not signed in</p>
          <p className="mt-1 text-sm text-charcoal-600">Sign in to manage bookings, save halls, and book venues.</p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Link href="/login"><Button variant="outline" className="w-full"><LogIn className="h-4 w-4" /> Sign In</Button></Link>
            <Link href="/signup"><Button variant="gold" className="w-full">Sign Up</Button></Link>
          </div>
        </div>
      )}

      {/* Quick links */}
      <SettingsGroup title="Account">
        {/* /verify-phone existed but nothing anywhere linked to it, so the
            whole OTP flow was unreachable. It is the number booking updates
            are sent to, which is worth telling people about. */}
        {profile && (
          <SettingsRow
            icon={<Phone className="h-4 w-4" />}
            label={profile.phoneVerified ? "Phone verified" : "Verify your phone"}
            href={profile.phoneVerified ? undefined : "/verify-phone"}
            badge={profile.phoneVerified ? "Verified" : undefined}
          />
        )}
        {/* Notifications is a real page — it was labelled "Soon" while working. */}
        {profile && (
          <SettingsRow icon={<Bell className="h-4 w-4" />} label="Notifications" href="/customer/notifications" />
        )}
        {/* "Edit profile" was marked Soon while /profile/edit was already
            built and shipped. "Saved addresses" and "Payment methods" do not
            exist at all — three permanently greyed rows advertising nothing.
            Removed rather than left as furniture; they come back when they are
            real. */}
      </SettingsGroup>

      <SettingsGroup title="Support">
        <SettingsRow icon={<HelpCircle className="h-4 w-4" />} label="Help Center" href="/contact" />
        <SettingsRow icon={<FileText className="h-4 w-4" />} label="Terms of Service" href="/terms" />
        <SettingsRow icon={<ShieldCheck className="h-4 w-4" />} label="Privacy Policy" href="/privacy" />
      </SettingsGroup>

      <SettingsGroup title="Become a partner">
        <SettingsRow icon={<Settings className="h-4 w-4" />} label="List your hall" href="/owner/register" />
      </SettingsGroup>

      {profile && (
        <button
          type="button"
          onClick={signOut}
          disabled={signingOut}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-white py-3 text-sm font-semibold text-red-600 shadow-card active:scale-[0.99]"
        >
          <LogOut className="h-4 w-4" /> {signingOut ? "Signing out…" : "Sign out"}
        </button>
      )}

      <p className="pt-2 text-center text-[11px] text-charcoal-400">Hallnect v0.1 · Made with ♥ in India</p>
    </div>
  );
}

function SettingsGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-charcoal-500">{title}</p>
      <div className="overflow-hidden rounded-2xl bg-white shadow-card">{children}</div>
    </div>
  );
}

function SettingsRow({
  icon, label, href, comingSoon, badge,
}: {
  icon: React.ReactNode;
  label: string;
  href?: string;
  comingSoon?: boolean;
  /** A completed state, e.g. "Verified" — distinct from the "Soon" pill. */
  badge?: string;
}) {
  const inner = (
    <>
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-maroon-50 text-maroon-600">
        {icon}
      </span>
      <span className="flex-1 text-sm font-medium text-charcoal-800">{label}</span>
      {comingSoon ? (
        <span className="rounded-full bg-ivory-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-charcoal-500">
          Soon
        </span>
      ) : badge ? (
        <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-green-700">
          {badge}
        </span>
      ) : (
        <ChevronRight className="h-4 w-4 text-charcoal-400" />
      )}
    </>
  );

  const classes = "flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0";

  if (comingSoon || !href) {
    return <div className={classes + " opacity-60"} aria-disabled>{inner}</div>;
  }

  return (
    <Link href={href} className={classes + " active:bg-ivory-200/60"}>
      {inner}
    </Link>
  );
}

import type { Metadata } from "next";
import { getProfile } from "@/lib/auth";
import { getDashboardPath } from "@/lib/constants";
import { redirect } from "next/navigation";

// SEO: this whole subtree is private. Declaring robots ONCE on the layout means
// every nested page inherits noindex — a new page added under here cannot leak
// into the index by forgetting a directive.
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile();

  // A SUSPENDED ACCOUNT MUST BE ABLE TO REACH THIS PAGE, and the is_active test
  // is the whole reason. /login lives under this layout, so without it the two
  // redirects chase each other forever:
  //
  //   /login    -> this layout sees a profile -> getDashboardPath(role)
  //   dashboard -> requireAuth sees !is_active -> /login?error=account_disabled
  //
  // The suspended user never lands anywhere, and the account_disabled message
  // that /login is holding for them can never render. They are left with a
  // browser redirect error and no idea why — which turns every suspension into
  // a support ticket, and makes a deliberate ban look like a broken site.
  //
  // Sending them on is only correct for an account that can actually USE the
  // destination.
  if (profile && profile.is_active) {
    redirect(getDashboardPath(profile.role));
  }
  return <>{children}</>;
}

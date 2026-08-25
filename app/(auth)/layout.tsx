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
  if (profile) {
    redirect(getDashboardPath(profile.role));
  }
  return <>{children}</>;
}

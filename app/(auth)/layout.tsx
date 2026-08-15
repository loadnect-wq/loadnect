import { getProfile } from "@/lib/auth";
import { getDashboardPath } from "@/lib/constants";
import { redirect } from "next/navigation";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile();
  if (profile) {
    redirect(getDashboardPath(profile.role));
  }
  return <>{children}</>;
}

import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "./supabase/server";
import { getDashboardPath } from "./constants";

export type UserRole = "customer" | "owner_pending" | "owner_approved" | "admin";

export type Profile = {
  id: string;
  full_name: string | null;
  email: string | null;
  role: UserRole;
  avatar_url: string | null;
};

export async function getSession() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function getProfile(): Promise<Profile | null> {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await supabase
    .from("profiles" as any)
    .select("id, full_name, email, role, avatar_url")
    .eq("id", user.id)
    .single();

  return (data as unknown as Profile) ?? null;
}

export async function requireAuth(): Promise<Profile> {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  return profile;
}

export async function requireRole(allowed: UserRole[]): Promise<Profile> {
  const profile = await requireAuth();
  if (!allowed.includes(profile.role)) {
    redirect(getDashboardPath(profile.role));
  }
  return profile;
}

export { getDashboardPath };

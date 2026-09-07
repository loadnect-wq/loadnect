import { cache } from "react";
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
  /** Admin suspension flag. false = access revoked (see requireAuth). */
  is_active: boolean;
};

export async function getSession() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/**
 * MEMOIZED PER REQUEST. Every admin and owner page now asserts its own role
 * rather than trusting the layout to have done it (see below), and without this
 * that would mean a second auth.getUser() round trip plus a second profiles read
 * on every render. React's cache() is request-scoped, so the layout's guard and
 * the page's guard share one lookup and the extra assertions are free.
 *
 * Request-scoped is the important word: this must never be a module-level cache,
 * or one visitor's profile would answer another visitor's request.
 */
export const getProfile = cache(async function getProfile(): Promise<Profile | null> {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await supabase
    .from("profiles" as any)
    .select("id, full_name, email, role, avatar_url, is_active")
    .eq("id", user.id)
    .single();

  if (!data) return null;
  // Older rows predate the column; treat a missing value as active so a schema
  // gap can never lock out an entire user base.
  const row = data as unknown as Profile & { is_active?: boolean | null };
  return { ...row, is_active: row.is_active !== false };
});

export async function requireAuth(): Promise<Profile> {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  // ENFORCE ADMIN SUSPENSION. profiles.is_active was previously written by the
  // admin "Deactivate user" action but read by nothing — not this path, not any
  // RLS policy — so a suspended owner/admin kept full access and could even sign
  // in again cleanly. Every role-gated page funnels through here, so this is the
  // single choke point that makes deactivation real.
  if (!profile.is_active) redirect("/login?error=account_disabled");

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

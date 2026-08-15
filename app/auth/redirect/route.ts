import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getDashboardPath } from "@/lib/constants";

export async function GET(request: Request) {
  const { origin } = new URL(request.url);
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(`${origin}/login`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: profile } = await supabase
    .from("profiles" as any)
    .select("role")
    .eq("id", user.id)
    .single();

  const role = (profile as { role: string } | null)?.role ?? "customer";
  return NextResponse.redirect(`${origin}${getDashboardPath(role)}`);
}

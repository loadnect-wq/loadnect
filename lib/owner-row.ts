// ─────────────────────────────────────────────────────────────────────────────
// lib/owner-row.ts — the caller's hall_owners row, created on their first hall.
//
// WHY THIS EXISTS (2026-10-12). Every hall hangs off a hall_owners row, and the
// row used to be created only by saving Business Details on /owner/profile. So
// a new owner who tapped "Add your first hall" was redirected to Profile with
// no explanation, filled in one required field (the business name), and then
// had to find their way back. The hall form now asks for that name and
// createHall calls this.
//
// THE NAME IS ASKED FOR, NEVER GUESSED. business_name is the "Listed by" line
// on every venue page, a statutory seller disclosure (see HallDetailView), so
// it must be what the owner says it is, not a copy of the hall name.
//
// SECURITY. `db` is the caller's SESSION client, never the service role:
// hall_owners_insert still enforces profile_id = auth.uid() and
// is_verified = false, and profile_id is UNIQUE, so this can only ever create
// the caller's own single row. The caller must have checked the role first.
// ─────────────────────────────────────────────────────────────────────────────

import { sanitizeError } from "@/lib/errors";

export type EnsureOwnerRowResult = { id: string; created: boolean } | { error: string };

export const MISSING_BUSINESS_NAME =
  "Enter your business name — it is shown on your listing as \"Listed by\".";

export async function ensureOwnerRow(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  userId: string,
  businessName: string | undefined,
): Promise<EnsureOwnerRowResult> {
  const read = () => db.from("hall_owners").select("id").eq("profile_id", userId).maybeSingle();

  const { data: existing, error: readErr } = await read();
  // A failed read is an error, never "no row": treating it as absent would try
  // an insert that the unique index then refuses, with a worse message.
  if (readErr) return { error: sanitizeError(readErr, "owner") };
  // An existing row wins and the name is ignored. Renaming happens in Profile.
  if (existing?.id) return { id: existing.id as string, created: false };

  if (!businessName) return { error: MISSING_BUSINESS_NAME };

  const { data: created, error: insErr } = await db
    .from("hall_owners")
    .insert({ profile_id: userId, business_name: businessName })
    .select("id")
    .single();
  if (!insErr && created?.id) return { id: created.id as string, created: true };

  // A double submit can race to create the row; the loser reads the winner's.
  if (insErr?.code === "23505") {
    const { data: again } = await read();
    if (again?.id) return { id: again.id as string, created: false };
  }
  return { error: sanitizeError(insErr, "owner") };
}

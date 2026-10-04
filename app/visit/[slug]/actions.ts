"use server";

// The family's half of a site visit. Identity is the SESSION's; the phone the
// hall receives is the profile's verified number, read in
// lib/site-visits.server.ts — the form cannot supply one.

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { parseSafe, siteVisitRequestSchema, uuidSchema } from "@/lib/validation/schemas";
import { cancelSiteVisit, requestSiteVisit, type RequestVisitResult } from "@/lib/site-visits.server";

export async function requestVisit(input: unknown): Promise<RequestVisitResult> {
  const user = await getSession();
  if (!user) return { ok: false, error: "Please sign in to ask for a visit." };
  const parsed = parseSafe(siteVisitRequestSchema, input);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const v = parsed.data;
  const result = await requestSiteVisit({
    hallId: v.hallId,
    customerId: user.id,
    date: v.date,
    window: v.window,
    partySize: v.partySize,
    contactName: v.contactName,
    note: v.note || null,
  });
  if (result.ok) revalidatePath("/customer/visits");
  return result;
}

export async function cancelVisit(visitId: unknown): Promise<{ ok: boolean }> {
  const user = await getSession();
  if (!user) return { ok: false };
  const id = uuidSchema.safeParse(visitId);
  if (!id.success) return { ok: false };
  const result = await cancelSiteVisit({ visitId: id.data, customerId: user.id });
  if (result.ok) revalidatePath("/customer/visits");
  return { ok: result.ok };
}

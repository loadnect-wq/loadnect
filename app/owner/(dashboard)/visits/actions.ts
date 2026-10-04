"use server";

// The owner's answer to a site visit request. Who is answering comes from the
// session; whether they may answer is proven in answerSiteVisit, through
// hall_owners.profile_id — a server action is a public endpoint, so the
// dashboard layout's role check is not authorisation.

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { parseSafe, siteVisitAnswerSchema } from "@/lib/validation/schemas";
import { answerSiteVisit, type AnswerVisitResult } from "@/lib/site-visits.server";

export async function answerVisit(input: unknown): Promise<AnswerVisitResult> {
  const user = await getSession();
  if (!user) return { ok: false, error: "Not signed in." };
  const parsed = parseSafe(siteVisitAnswerSchema, input);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const v = parsed.data;
  const result = await answerSiteVisit({
    visitId: v.visitId,
    ownerProfileId: user.id,
    decision: v.decision,
    message: v.message || null,
  });
  if (result.ok) {
    revalidatePath("/owner/visits");
    revalidatePath("/owner/dashboard");
  }
  return result;
}

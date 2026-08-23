// ─────────────────────────────────────────────────────────────────────────────
// lib/twilio/approvals.ts — reads Meta's approval verdict for each WhatsApp
// Content Template (SERVER-ONLY, admin surfaces only).
//
// WHY THIS EXISTS
//   A Content SID being present in the environment only means "we know which
//   template to reference". It says nothing about whether Meta has approved
//   that template — and an unapproved template fails at send time with error
//   63016. Those two facts were previously only knowable in two different
//   places (our env, and the Twilio console), so the admin dashboard could
//   show a confident "14/14 configured" while every send was doomed.
//
//   This closes that gap: the dashboard reports the approval verdict itself.
//
// ONE CALL, NOT FOURTEEN
//   /v1/ContentAndApprovals returns every template with its approval state in
//   a single paginated response, so showing the status costs one request per
//   dashboard render rather than one per template.
//
// FAILS SOFT, ALWAYS
//   This is decoration on an operational page. Twilio being unreachable, or
//   credentials being absent, must never blank the notification centre — every
//   failure path returns a reason string and the page renders without it.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

const CONTENT_BASE = "https://content.twilio.com/v1";

/** How long a fetched verdict is reused before Twilio is asked again. */
const CACHE_SECONDS = 120;

/** Guard against a malformed pagination loop walking forever. */
const MAX_PAGES = 10;

const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Meta's verdict, normalised to lower case.
 *   received    — Twilio has it, not yet passed to Meta
 *   pending     — Meta is reviewing
 *   approved    — usable for business-initiated messages
 *   rejected    — unusable; `rejectionReason` says why
 *   unsubmitted — created but never sent for review
 *   unknown     — Twilio returned a shape we do not recognise
 */
export type TemplateApprovalStatus =
  | "approved" | "pending" | "received" | "rejected" | "unsubmitted" | "unknown";

export type ApprovalRecord = {
  contentSid: string;
  friendlyName: string | null;
  status: TemplateApprovalStatus;
  /** Populated only when status is 'rejected'. */
  rejectionReason: string | null;
  /** UTILITY / MARKETING / AUTHENTICATION, as filed with Meta. */
  category: string | null;
};

export type ApprovalsResult =
  | { ok: true; bySid: Record<string, ApprovalRecord> }
  | { ok: false; reason: string };

const KNOWN: ReadonlySet<string> = new Set([
  "approved", "pending", "received", "rejected", "unsubmitted",
]);

function normaliseStatus(raw: unknown): TemplateApprovalStatus {
  const v = String(raw ?? "").trim().toLowerCase();
  return KNOWN.has(v) ? (v as TemplateApprovalStatus) : "unknown";
}

/**
 * Pulls the approval block out of one content record.
 *
 * Twilio documents two shapes for this depending on the endpoint: the
 * per-content endpoint nests it under `whatsapp`, while the list endpoint has
 * been seen returning the fields flat. Both are read, so a shape change on
 * either side degrades to 'unknown' rather than throwing.
 */
export function readApprovalRecord(content: unknown): ApprovalRecord | null {
  const c = content as {
    sid?: string;
    friendly_name?: string;
    approval_requests?: Record<string, unknown> | null;
  } | null;

  if (!c?.sid) return null;

  const req = c.approval_requests ?? {};
  const wa = (req.whatsapp ?? req) as Record<string, unknown>;

  const rejection = String(wa.rejection_reason ?? "").trim();
  const status = normaliseStatus(wa.status);

  return {
    contentSid: c.sid,
    friendlyName: c.friendly_name ?? null,
    status,
    // Only meaningful on a rejection; Twilio sends "" otherwise.
    rejectionReason: status === "rejected" && rejection ? rejection : null,
    category: wa.category ? String(wa.category) : null,
  };
}

/**
 * Fetches approval state for every Content Template on the account.
 *
 * Returns a map keyed by Content SID so the caller can look up the templates
 * it actually cares about without matching on names, which are editable.
 */
export async function fetchTemplateApprovals(): Promise<ApprovalsResult> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();

  if (!accountSid || !authToken) {
    return { ok: false, reason: "Twilio credentials are not configured" };
  }

  const auth = "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const bySid: Record<string, ApprovalRecord> = {};

  let url: string | null = `${CONTENT_BASE}/ContentAndApprovals?PageSize=100`;
  let pages = 0;

  try {
    while (url && pages < MAX_PAGES) {
      const res: Response = await fetch(url, {
        headers: { Authorization: auth },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        // Reused briefly so opening the dashboard repeatedly does not hammer
        // Twilio; an approval verdict changes on the order of hours.
        next: { revalidate: CACHE_SECONDS },
      });

      if (!res.ok) {
        // Status only — the body carries template content and account detail.
        console.error(`[twilio-approvals] HTTP ${res.status}`);
        return {
          ok: false,
          reason:
            res.status === 401 || res.status === 403
              ? "Twilio rejected the credentials"
              : `Twilio returned HTTP ${res.status}`,
        };
      }

      const body = (await res.json()) as {
        contents?: unknown[];
        meta?: { next_page_url?: string | null };
      };

      for (const item of body.contents ?? []) {
        const rec = readApprovalRecord(item);
        if (rec) bySid[rec.contentSid] = rec;
      }

      url = body.meta?.next_page_url ?? null;
      pages += 1;
    }

    return { ok: true, bySid };
  } catch (e) {
    console.error(
      "[twilio-approvals] request failed:",
      e instanceof Error ? e.message : "unknown",
    );
    return { ok: false, reason: "Could not reach Twilio" };
  }
}

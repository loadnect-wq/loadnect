// ─────────────────────────────────────────────────────────────────────────────
// lib/notifications/templates.ts — shared formatting helpers for notification
// content (PURE).
//
// The MESSAGE COPY itself lives in lib/notifications/whatsapp-templates.ts,
// because every message this platform sends is a Meta-approved WhatsApp
// template and the copy has to match what was approved. What remains here is
// the small set of value formatters those templates share, kept separate so
// they can be unit-tested and reused without pulling in the registry.
//
// This file previously held three objects of hand-written SMS strings
// (customerTemplates / ownerTemplates / adminTemplates). They were deleted
// with the SMS channel: keeping them would have left two competing sources of
// copy, and only one of them was the text Meta actually approved.
// ─────────────────────────────────────────────────────────────────────────────

/** Short human booking reference from the uuid — full uuids are unreadable. */
export function bookingRef(id: string): string {
  return id.replace(/-/g, "").slice(0, 8).toUpperCase();
}

/**
 * Rupee display for messages: integer rupees with en-IN grouping.
 * Exact, never abbreviated — "₹1.5L" cannot distinguish ₹1,49,000 from
 * ₹1,52,000, and a customer reading an amount owed needs the real figure.
 */
export function formatAmount(amount: number): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "—";
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

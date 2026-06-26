// Shared support-ticket types + constants. PURE: safe to import from client
// components. Server reads/writes live in lib/tickets-server.ts and
// app/*/actions.ts.

export type TicketStatus = "open" | "in_progress" | "resolved" | "closed";
export type TicketPriority = "low" | "medium" | "high" | "urgent";

export const TICKET_STATUSES: { value: TicketStatus; label: string }[] = [
  { value: "open",        label: "Open" },
  { value: "in_progress", label: "In Progress" },
  { value: "resolved",    label: "Resolved" },
  { value: "closed",      label: "Closed" },
];

export const TICKET_PRIORITIES: { value: TicketPriority; label: string }[] = [
  { value: "low",    label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high",   label: "High" },
  { value: "urgent", label: "Urgent" },
];

export const TICKET_CATEGORIES = [
  "Booking issue",
  "Payment problem",
  "Account",
  "Listing issue",
  "Refund request",
  "Other",
] as const;

export type MyTicket = {
  id:             string;
  subject:        string;
  message:        string;
  category:       string | null;
  status:         TicketStatus;
  priority:       TicketPriority;
  admin_response: string | null;
  created_at:     string;
  updated_at:     string;
};

export function isValidStatus(v: unknown): v is TicketStatus {
  return typeof v === "string" && TICKET_STATUSES.some((s) => s.value === v);
}

export function isValidPriority(v: unknown): v is TicketPriority {
  return typeof v === "string" && TICKET_PRIORITIES.some((p) => p.value === v);
}

// Strip HTML angle brackets + ASCII control chars. React escapes at render —
// this is defense in depth in case text is serialized elsewhere.
//
// BUGFIX: the previous pattern was `/[<> -]/g`. Because `-` sits at the end of
// the class it was a LITERAL dash, so the class was `<`, `>`, space AND `-` —
// it silently stripped every space and hyphen from ticket text ("can't log in"
// → "can'tlogin"). The corrected class removes only angle brackets and the
// ASCII control range. (Ticket creation now validates via ticketSchema in
// lib/validation/schemas.ts, but this exported helper is fixed for any caller.)
// eslint-disable-next-line no-control-regex
const STRIP = /[<>\x00-\x1F\x7F]/g;
export function sanitizeTicketText(input: unknown, maxLen: number): string {
  if (typeof input !== "string") return "";
  return input.replace(STRIP, "").trim().slice(0, maxLen);
}

export const TICKET_LIMITS = {
  subject: 200,
  message: 4000,
  category: 60,
  response: 4000,
  notes: 4000,
} as const;

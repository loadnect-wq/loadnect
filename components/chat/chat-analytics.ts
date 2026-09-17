// ─────────────────────────────────────────────────────────────────────────────
// components/chat/chat-analytics.ts — chatbot events for Google Analytics.
//
// CONSENT IS INHERITED, NOT RE-ASKED. window.gtag only exists after the visitor
// accepts analytics (components/analytics/AnalyticsConsent.tsx), so when it is
// absent this does nothing at all. Events carry ids and route keys only —
// never message text, names, phone numbers or anything typed.
// ─────────────────────────────────────────────────────────────────────────────

export type ChatEvent =
  | "chatbot_opened"
  | "chatbot_message_sent"
  | "quick_action_clicked"
  | "hall_result_clicked"
  | "booking_help_requested"
  | "owner_help_requested"
  | "support_requested";

type Gtag = (command: "event", name: string, params?: Record<string, string | number>) => void;

export function trackChatEvent(name: ChatEvent, params?: Record<string, string | number>): void {
  try {
    const gtag = (window as unknown as { gtag?: Gtag }).gtag;
    if (typeof gtag === "function") gtag("event", name, params);
  } catch {
    /* analytics must never break the chat */
  }
}

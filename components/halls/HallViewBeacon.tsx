"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Tells the server a venue page was opened, once per browser per hall per day,
// so the owner's Insights can show how many families looked (0117).
//
// Renders nothing. The once-a-day memory is this browser's own localStorage;
// no cookie is set and no id is sent, only the hall's slug. Automated browsers
// (navigator.webdriver) are skipped here, and the server also ignores bots and
// the hall's own owner.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect } from "react";

const KEY = "hallnect:viewed";

/** India's date, so "today" turns over at midnight IST, as the server's count does. */
function indiaToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

export function HallViewBeacon({ slug }: { slug: string }) {
  useEffect(() => {
    if (navigator.webdriver) return;
    const today = indiaToday();
    let seen: Record<string, string> = {};
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}");
      if (raw && typeof raw === "object") seen = raw as Record<string, string>;
    } catch {
      /* unreadable storage: count this view, it just will not be remembered */
    }
    if (seen[slug] === today) return;

    // Keep only today's entries, so the list never grows.
    const next: Record<string, string> = Object.fromEntries(Object.entries(seen).filter(([, d]) => d === today));
    next[slug] = today;
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* private window: still counted once for this page load */
    }
    void fetch("/api/halls/view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug }),
      keepalive: true,
    }).catch(() => {});
  }, [slug]);
  return null;
}

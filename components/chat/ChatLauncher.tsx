"use client";

// ─────────────────────────────────────────────────────────────────────────────
// components/chat/ChatLauncher.tsx — the floating Hallnect Assistant button.
//
// LIGHT UNTIL USED. This file is all that ships with every page: a button. The
// chat window, the AI SDK client and its markdown/tool renderers live in
// ChatPanel, loaded with next/dynamic on first open (and pre-warmed on hover or
// focus), so visitors who never open the chat never download it.
//
// ONCE OPENED, THE PANEL STAYS MOUNTED. Closing or minimising only hides it, so
// the conversation survives until the page is reloaded or the user clears it.
//
// PLACEMENT. On phones the button sits above the bottom bars this site already
// has (BottomNav, the owner nav, and the sticky Book/Enquire bars on hall and
// booking pages) rather than on top of them; on desktop it sits bottom-right.
// ─────────────────────────────────────────────────────────────────────────────

import dynamic from "next/dynamic";
import { useCallback, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { AssistantLogo } from "./AssistantLogo";
import { CHAT_HIDDEN_PREFIXES, ASSISTANT_NAME } from "@/lib/ai/chat-config";
import { trackChatEvent } from "./chat-analytics";

const loadPanel = () => import("./ChatPanel");
const ChatPanel = dynamic(loadPanel, { ssr: false });

export function ChatLauncher() {
  const pathname = usePathname() ?? "/";
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const openChat = useCallback(() => {
    setLoaded(true);
    setOpen(true);
    trackChatEvent("chatbot_opened", { page_type: pathname.split("/")[1] || "home" });
  }, [pathname]);

  const closeChat = useCallback(() => {
    setOpen(false);
    // Return focus to where the user started (WCAG 2.4.3).
    // A macrotask, not requestAnimationFrame: rAF does not fire in a tab that is
    // not painting, and the button only exists again after this re-render.
    window.setTimeout(() => buttonRef.current?.focus(), 0);
  }, []);

  if (CHAT_HIDDEN_PREFIXES.some((p) => pathname.startsWith(p))) return null;

  return (
    <>
      {!open && (
        <button
          ref={buttonRef}
          type="button"
          onClick={openChat}
          onMouseEnter={() => void loadPanel()}
          onFocus={() => void loadPanel()}
          aria-label={`Open ${ASSISTANT_NAME}`}
          aria-haspopup="dialog"
          className="group fixed right-4 z-[45] flex h-14 w-14 items-center justify-center rounded-full bg-maroon-900 text-gold-300 shadow-elevated ring-1 ring-gold-400/40 transition duration-200 hover:-translate-y-0.5 hover:bg-maroon-800 hover:shadow-gold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-gold-400/60 active:scale-95 motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:active:scale-100 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] lg:bottom-6 lg:right-6"
        >
          <AssistantLogo size={32} className="transition-transform duration-200 group-hover:scale-105 motion-reduce:group-hover:scale-100" />
          <span className="absolute right-1 top-1 h-3 w-3 rounded-full border-2 border-maroon-900 bg-emerald-400" aria-hidden />
        </button>
      )}
      {loaded && <ChatPanel open={open} onClose={closeChat} />}
    </>
  );
}

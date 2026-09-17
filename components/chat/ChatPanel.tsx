"use client";

// ─────────────────────────────────────────────────────────────────────────────
// components/chat/ChatPanel.tsx — the HallNect Assistant window. Loaded lazily
// by ChatLauncher on first open.
//
// LAYOUT. Phones: a full-screen sheet whose height follows visualViewport, so
// the on-screen keyboard shrinks the sheet instead of covering the composer.
// Larger screens: a 400px floating card anchored bottom-right.
//
// STATE. The conversation lives in useChat's memory for as long as this
// component is mounted (ChatLauncher keeps it mounted after the first open).
// Nothing is written to storage: chats can contain names and phone numbers.
//
// WHAT IS SENT. Only the last MAX_HISTORY_MESSAGES messages and the current
// pathname — never the role, a hall's data or anything else the server should
// decide for itself (see app/api/chat/route.ts).
// ─────────────────────────────────────────────────────────────────────────────

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type InferUITools, type UIDataTypes, type UIMessage } from "ai";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowUp, Gem, Minus, RotateCcw, Square, X } from "lucide-react";
import {
  ASSISTANT_NAME,
  ASSISTANT_TAGLINE,
  CHAT_API_PATH,
  CHAT_BUSY_MESSAGE,
  CHAT_ERROR_MESSAGE,
  CHAT_RATE_LIMIT_MESSAGE,
  MAX_HISTORY_MESSAGES,
  MAX_INPUT_CHARS,
  QUICK_ACTIONS,
  WELCOME_MESSAGE,
} from "@/lib/ai/chat-config";
import type { ChatTools } from "@/lib/ai/tools.server";
import { ActionButtons, AvailabilityDays, FormattedText, HallCards, MyBookingsList } from "./ChatParts";
import { trackChatEvent } from "./chat-analytics";

type ChatMessage = UIMessage<unknown, UIDataTypes, InferUITools<ChatTools>>;

const TOOL_BUSY_LABEL: Record<string, string> = {
  "tool-searchHalls": "Searching halls…",
  "tool-getHallDetails": "Reading hall details…",
  "tool-checkHallAvailability": "Checking the calendar…",
  "tool-getMyBookings": "Looking up your bookings…",
};

/** Sends only the recent history and the page path the caller passed in `body`. */
function createTransport() {
  return new DefaultChatTransport<ChatMessage>({
    api: CHAT_API_PATH,
    credentials: "same-origin",
    prepareSendMessagesRequest: ({ messages, body }) => ({
      body: {
        messages: messages.slice(-MAX_HISTORY_MESSAGES),
        pathname: typeof body?.pathname === "string" ? body.pathname : undefined,
      },
    }),
  });
}

function useVisualViewportHeight(active: boolean): number | null {
  const [h, setH] = useState<number | null>(null);
  useEffect(() => {
    if (!active) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setH(Math.round(vv.height));
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, [active]);
  return h;
}

function useIsSmallScreen(): boolean {
  const [small, setSmall] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const update = () => setSmall(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return small;
}

export default function ChatPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname() ?? "/";
  const [transport] = useState(createTransport);

  const { messages, sendMessage, status, error, stop, regenerate, setMessages, clearError } = useChat<ChatMessage>({
    transport,
    throttle: 50,
  });

  const [input, setInput] = useState("");
  const [minimized, setMinimized] = useState(false);
  const small = useIsSmallScreen();
  const vvHeight = useVisualViewportHeight(open && small);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const titleId = useId();

  const busy = status === "submitted" || status === "streaming";

  // Focus the composer when the window opens or is restored.
  useEffect(() => {
    if (open && !minimized) {
      const t = window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 60);
      return () => window.clearTimeout(t);
    }
  }, [open, minimized]);

  // Keep the newest message in view while it streams.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, status, open, minimized]);

  // Lock page scroll behind the full-screen sheet on phones.
  useEffect(() => {
    if (!(open && small && !minimized)) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open, small, minimized]);

  const send = useCallback(
    (text: string, source: "typed" | "quick_action", quickId?: string) => {
      const value = text.trim().slice(0, MAX_INPUT_CHARS);
      if (!value || busy) return;
      if (error) clearError();
      void sendMessage({ text: value }, { body: { pathname } });
      if (source === "quick_action" && quickId) {
        trackChatEvent("quick_action_clicked", { action: quickId });
        if (quickId === "how_booking") trackChatEvent("booking_help_requested", { source: "quick_action" });
        if (quickId === "owner") trackChatEvent("owner_help_requested", { source: "quick_action" });
        if (quickId === "support") trackChatEvent("support_requested", { source: "quick_action" });
      } else {
        trackChatEvent("chatbot_message_sent", { length_bucket: value.length > 200 ? "long" : "short" });
      }
    },
    [busy, clearError, error, pathname, sendMessage],
  );

  const submit = () => {
    if (!input.trim()) return;
    send(input, "typed");
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "";
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const clearChat = () => {
    if (busy) stop();
    clearError();
    setMessages([]);
    setInput("");
    inputRef.current?.focus();
  };

  const navigateAway = () => {
    if (small) onClose();
  };

  // Only ever one of our own fixed sentences — never text from the network.
  const errorText = error
    ? /a lot of messages/i.test(error.message) ? CHAT_RATE_LIMIT_MESSAGE
      : error.message.includes(CHAT_BUSY_MESSAGE) ? CHAT_BUSY_MESSAGE
      : CHAT_ERROR_MESSAGE
    : null;

  const hasUserMessage = messages.some((m) => m.role === "user");
  const last = messages[messages.length - 1];
  const lastHasVisibleOutput =
    last?.role === "assistant" && last.parts.some((p) => (p.type === "text" && p.text.trim()) || p.type.startsWith("tool-"));
  const showTyping = busy && !lastHasVisibleOutput;

  const shellStyle = small && vvHeight ? { height: `${vvHeight}px` } : undefined;

  if (!open) return null;

  if (minimized && !small) {
    return (
      <div className="fixed bottom-6 right-6 z-[55] animate-in fade-in slide-in-from-bottom-2 motion-reduce:animate-none">
        <button
          type="button"
          onClick={() => setMinimized(false)}
          className="flex items-center gap-3 rounded-full bg-maroon-950 py-2 pl-2 pr-4 text-left text-ivory-100 shadow-elevated ring-1 ring-gold-400/30 transition hover:bg-maroon-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-gold-400/60"
          aria-label={`Restore ${ASSISTANT_NAME}`}
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gold-gradient text-maroon-950"><Gem className="h-4 w-4" aria-hidden /></span>
          <span className="text-sm font-semibold">{ASSISTANT_NAME}</span>
          {busy && <span className="text-xs text-gold-300">typing…</span>}
        </button>
      </div>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal={small}
      aria-labelledby={titleId}
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}
      style={shellStyle}
      className="fixed inset-x-0 top-0 z-[55] flex h-[100dvh] flex-col overflow-hidden bg-ivory-50 animate-in fade-in slide-in-from-bottom-4 duration-200 motion-reduce:animate-none sm:inset-auto sm:bottom-6 sm:right-6 sm:top-auto sm:h-[min(640px,calc(100dvh-3rem))] sm:w-[400px] sm:rounded-2xl sm:border sm:border-gold-400/25 sm:shadow-elevated"
    >
      {/* Header */}
      <div className="flex items-center gap-3 bg-maroon-950 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-ivory-100 sm:pt-3">
        <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gold-gradient text-maroon-950 shadow-gold">
          <Gem className="h-5 w-5" aria-hidden />
          <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-maroon-950 bg-emerald-400" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="truncate font-serif text-base font-semibold leading-tight">{ASSISTANT_NAME}</h2>
          <p className="truncate text-xs text-ivory-400">
            <span className="sr-only">Online. </span>{ASSISTANT_TAGLINE}
          </p>
        </div>
        <div className="flex items-center gap-0.5">
          {hasUserMessage && (
            <button type="button" onClick={clearChat} aria-label="Clear chat" title="Clear chat"
              className="flex h-10 w-10 items-center justify-center rounded-full text-ivory-300 transition hover:bg-white/10 hover:text-ivory-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400">
              <RotateCcw className="h-4 w-4" aria-hidden />
            </button>
          )}
          {!small && (
            <button type="button" onClick={() => setMinimized(true)} aria-label="Minimize chat" title="Minimize"
              className="flex h-10 w-10 items-center justify-center rounded-full text-ivory-300 transition hover:bg-white/10 hover:text-ivory-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400">
              <Minus className="h-4 w-4" aria-hidden />
            </button>
          )}
          <button type="button" onClick={onClose} aria-label="Close chat" title="Close"
            className="flex h-10 w-10 items-center justify-center rounded-full text-ivory-300 transition hover:bg-white/10 hover:text-ivory-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
      </div>
      <div className="h-px bg-gradient-to-r from-transparent via-gold-400/60 to-transparent" aria-hidden />

      {/* Messages */}
      <div
        ref={listRef}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        className="flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4"
      >
        <AssistantBubble>
          <FormattedText text={WELCOME_MESSAGE} />
        </AssistantBubble>

        {!hasUserMessage && (
          <div className="flex flex-wrap gap-2 pl-9" role="group" aria-label="Suggested questions">
            {QUICK_ACTIONS.map((q) => (
              <button
                key={q.id}
                type="button"
                disabled={busy}
                onClick={() => send(q.prompt, "quick_action", q.id)}
                className="min-h-[40px] rounded-full border border-gold-400/50 bg-white px-3.5 text-left text-xs font-medium text-charcoal-800 shadow-sm transition hover:-translate-y-px hover:border-gold-500 hover:bg-gold-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 disabled:opacity-50 motion-reduce:hover:translate-y-0"
              >
                {q.label}
              </button>
            ))}
          </div>
        )}

        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="flex justify-end animate-in fade-in slide-in-from-bottom-1 motion-reduce:animate-none">
              <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-maroon-900 px-3.5 py-2.5 text-sm text-ivory-50 shadow-sm">
                <span className="sr-only">You said: </span>
                {m.parts.map((p, i) => (p.type === "text" ? <span key={i}>{p.text}</span> : null))}
              </div>
            </div>
          ) : (
            <AssistantMessage key={m.id} message={m} onNavigate={navigateAway} />
          ),
        )}

        {showTyping && (
          <AssistantBubble>
            <span className="sr-only">{ASSISTANT_NAME} is typing</span>
            <span className="flex items-center gap-1 py-1" aria-hidden>
              <span className="h-2 w-2 animate-bounce rounded-full bg-gold-500 [animation-delay:-0.3s] motion-reduce:animate-none" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-gold-500 [animation-delay:-0.15s] motion-reduce:animate-none" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-gold-500 motion-reduce:animate-none" />
            </span>
          </AssistantBubble>
        )}

        {errorText && (
          <div className="ml-9 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800" role="alert">
            <p>{errorText}</p>
            <button
              type="button"
              onClick={() => { clearError(); void regenerate({ body: { pathname } }); }}
              className="mt-1.5 text-xs font-semibold text-red-900 underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
            >
              Try again
            </button>
          </div>
        )}
      </div>

      {/* Composer */}
      <form
        onSubmit={(e) => { e.preventDefault(); submit(); }}
        className="border-t border-border bg-white px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3"
      >
        <div className="flex items-end gap-2 rounded-2xl border border-border bg-ivory-50 p-1.5 pl-3 transition focus-within:border-gold-400 focus-within:ring-2 focus-within:ring-gold-400/30">
          <label htmlFor={`${titleId}-input`} className="sr-only">Message {ASSISTANT_NAME}</label>
          <textarea
            id={`${titleId}-input`}
            ref={inputRef}
            rows={1}
            value={input}
            maxLength={MAX_INPUT_CHARS}
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = "";
              e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
            }}
            onKeyDown={onKeyDown}
            placeholder="Ask about halls, bookings or HallNect…"
            enterKeyHint="send"
            className="max-h-[120px] min-h-[40px] flex-1 resize-none bg-transparent py-2 text-base text-charcoal-900 placeholder:text-charcoal-400 focus:outline-none sm:text-sm"
          />
          {busy ? (
            <button type="button" onClick={() => stop()} aria-label="Stop response"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-charcoal-800 text-white transition hover:bg-charcoal-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400">
              <Square className="h-3.5 w-3.5 fill-current" aria-hidden />
            </button>
          ) : (
            <button type="submit" disabled={!input.trim()} aria-label="Send message"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gold-gradient text-maroon-950 shadow-sm transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-maroon-700 disabled:opacity-40">
              <ArrowUp className="h-5 w-5" aria-hidden />
            </button>
          )}
        </div>
        <p className="mt-1.5 px-1 text-[10px] leading-snug text-charcoal-400">
          {input.length > MAX_INPUT_CHARS - 100
            ? `${MAX_INPUT_CHARS - input.length} characters left`
            : "AI assistant — may make mistakes. Never share OTPs, passwords or card details."}
        </p>
      </form>
    </div>
  );
}

function AssistantBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 animate-in fade-in slide-in-from-bottom-1 motion-reduce:animate-none">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-maroon-950 text-gold-300" aria-hidden>
        <Gem className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 max-w-[88%] rounded-2xl rounded-tl-md border border-border bg-white px-3.5 py-2.5 text-sm leading-relaxed text-charcoal-800 shadow-sm">
        {children}
      </div>
    </div>
  );
}

function AssistantMessage({ message, onNavigate }: { message: ChatMessage; onNavigate: () => void }) {
  const blocks: React.ReactNode[] = [];
  // A reply that used a tool arrives as several text parts (one per step);
  // separate them, or the last sentence of one runs into the next.
  const text = message.parts
    .filter((p) => p.type === "text")
    .map((p) => p.text.trim())
    .filter(Boolean)
    .join("\n\n");

  message.parts.forEach((part, i) => {
    const key = `${message.id}-${i}`;
    const pad = (node: React.ReactNode) => blocks.push(<div key={key} className="pl-9">{node}</div>);

    switch (part.type) {
      case "tool-searchHalls":
        if (part.state === "output-available") {
          if (part.output.status === "ok" && part.output.halls.length > 0) pad(<HallCards halls={part.output.halls} onNavigate={onNavigate} />);
        } else if (part.state !== "output-error") {
          blocks.push(<BusyLine key={key} label={TOOL_BUSY_LABEL[part.type]} />);
        }
        break;
      case "tool-checkHallAvailability":
        if (part.state === "output-available") {
          const out = part.output;
          if (out.status === "ok") pad(<AvailabilityDays name={out.name} days={out.days} bookHref={out.bookHref} onNavigate={onNavigate} />);
        } else if (part.state !== "output-error") {
          blocks.push(<BusyLine key={key} label={TOOL_BUSY_LABEL[part.type]} />);
        }
        break;
      case "tool-getMyBookings":
        if (part.state === "output-available") {
          if (part.output.status === "ok") pad(<MyBookingsList bookings={part.output.bookings} onNavigate={onNavigate} />);
        } else if (part.state !== "output-error") {
          blocks.push(<BusyLine key={key} label={TOOL_BUSY_LABEL[part.type]} />);
        }
        break;
      case "tool-getHallDetails":
        if (part.state === "output-available") {
          const out = part.output;
          if (out.status === "ok") {
            pad(
              <ActionButtons
                actions={[
                  { key: "view_hall", label: "View Hall", href: out.pageHref },
                  { key: "primary", label: out.primaryLabel, href: out.primaryHref },
                ]}
                onNavigate={onNavigate}
              />,
            );
          }
        } else if (part.state !== "output-error") {
          blocks.push(<BusyLine key={key} label={TOOL_BUSY_LABEL[part.type]} />);
        }
        break;
      case "tool-suggestActions":
        if (part.state === "output-available") pad(<ActionButtons actions={part.output.actions} onNavigate={onNavigate} />);
        break;
    }
  });

  return (
    <div className="space-y-2">
      {text && (
        <AssistantBubble>
          <FormattedText text={text} />
        </AssistantBubble>
      )}
      {blocks}
    </div>
  );
}

function BusyLine({ label }: { label: string | undefined }) {
  if (!label) return null;
  return <p className="pl-9 text-xs italic text-charcoal-500">{label}</p>;
}

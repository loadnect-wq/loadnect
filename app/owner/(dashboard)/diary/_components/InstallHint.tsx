"use client";

// ─────────────────────────────────────────────────────────────────────────────
// "Keep the diary on your home screen."
//
// Chrome on Android fires `beforeinstallprompt` when the page is installable
// (this route links /diary.webmanifest); holding on to that event lets a
// button open the real install dialog. Safari on iPhone has no such event, so
// it gets the one sentence that works there: Share, then Add to Home Screen.
//
// Hidden when the diary is already running as an installed app, and once
// dismissed on this device. Every browser read goes through
// useSyncExternalStore with a server snapshot of "hidden", so the server and
// the first client render agree and nothing flashes.
// ─────────────────────────────────────────────────────────────────────────────

import { useSyncExternalStore } from "react";
import { Smartphone, X } from "lucide-react";
import { dt, type DiaryLang } from "@/lib/diary";

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

const DISMISS_KEY = "hn_diary_install_dismissed";

// ── A tiny store over the browser facts this needs ───────────────────────────
let deferred: InstallPromptEvent | null = null;
let dismissed = false;
let dismissedRead = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function readDismissed(): boolean {
  if (!dismissedRead) {
    dismissedRead = true;
    try { dismissed = localStorage.getItem(DISMISS_KEY) === "1"; } catch { dismissed = false; }
  }
  return dismissed;
}

// Registered when this module first loads, not when the component mounts:
// Chrome can fire beforeinstallprompt before hydration, and a listener added
// later would never see it.
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // our button replaces Chrome's mini-infobar
    deferred = e as InstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => { deferred = null; emit(); });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

type Mode = "hidden" | "prompt" | "ios";

function snapshot(): Mode {
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (standalone || readDismissed()) return "hidden";
  if (deferred) return "prompt";
  return /iPhone|iPad|iPod/.test(navigator.userAgent) ? "ios" : "hidden";
}

export function InstallHint({ lang }: { lang: DiaryLang }) {
  const mode = useSyncExternalStore(subscribe, snapshot, () => "hidden" as Mode);
  if (mode === "hidden") return null;

  function dismiss() {
    dismissed = true;
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* private mode: hide for this visit only */ }
    emit();
  }

  async function install() {
    const e = deferred;
    if (!e) return;
    await e.prompt();
    await e.userChoice.catch(() => undefined);
    deferred = null;
    emit();
  }

  return (
    <div className="flex items-start gap-3 rounded-2xl bg-white p-4 shadow-card ring-1 ring-maroon-100">
      <Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-maroon-600" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-charcoal-900">{dt(lang, "installTitle")}</p>
        <p className="mt-0.5 text-xs text-charcoal-600">
          {mode === "ios" ? dt(lang, "installIos") : dt(lang, "installBody")}
        </p>
        {mode === "prompt" && (
          <button
            type="button"
            onClick={install}
            className="mt-2 inline-flex min-h-[40px] items-center rounded-xl bg-maroon-600 px-4 text-sm font-semibold text-white hover:bg-maroon-700"
          >
            {dt(lang, "installButton")}
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label={dt(lang, "notNow")}
        className="-mr-1 -mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-full text-charcoal-500 hover:bg-ivory-100"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}

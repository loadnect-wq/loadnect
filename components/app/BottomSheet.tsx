"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useEffect, useRef } from "react";

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

// Everything a keyboard user can reach inside the sheet.
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function BottomSheet({ open, onClose, title, children, footer }: BottomSheetProps) {
  const panelRef   = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Move focus into the sheet on open and put it back where it came from on
  // close. The sheet covers the page but the page underneath stayed in the tab
  // order, so a keyboard user opening Filters was still tabbing through the
  // results behind it, and on close was dropped at the top of the document.
  //
  // Depends on `open` ALONE, deliberately. Every call site passes an inline
  // arrow for onClose, so a dependency on it would re-run this on every render
  // and yank focus out of whatever the user was typing into.
  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    // Focus the panel itself rather than its first control, so the sheet's own
    // name is announced before its contents.
    const frame = requestAnimationFrame(() => panelRef.current?.focus());
    return () => {
      cancelAnimationFrame(frame);
      restoreRef.current?.focus?.();
    };
  }, [open]);

  // Escape closes, Tab cycles within the panel. These two live in one effect on
  // purpose: a sheet that traps focus but cannot be dismissed is far worse than
  // one that leaks it.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) { e.preventDefault(); panel.focus(); return; }
      const first = items[0];
      const last  = items[items.length - 1];
      const active  = document.activeElement;
      const outside = !panel.contains(active);
      if (e.shiftKey && (outside || active === first)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (outside || active === last)) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-50 bg-black/50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            aria-hidden
          />
          <motion.div
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal
            aria-label={title}
            className="fixed inset-x-0 bottom-0 z-50 flex max-h-[90vh] flex-col rounded-t-3xl bg-white shadow-elevated outline-none sm:left-1/2 sm:max-w-lg sm:-translate-x-1/2"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 320 }}
          >
            <div className="flex flex-col items-center pt-2">
              <span className="h-1.5 w-10 rounded-full bg-ivory-300" aria-hidden />
            </div>
            <div className="flex items-center justify-between px-5 py-3">
              <h2 className="font-serif text-lg font-semibold text-charcoal-900">{title}</h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="-mr-2 flex h-11 w-11 items-center justify-center rounded-full text-charcoal-600 transition hover:bg-ivory-200 active:scale-95 motion-reduce:active:scale-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 pb-4">{children}</div>
            {footer && (
              <div className="border-t border-border bg-white px-5 py-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
                {footer}
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

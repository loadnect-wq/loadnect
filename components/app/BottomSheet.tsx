"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

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

/** The document never changes under us; this only answers "are we on the client". */
const subscribeToNothing = () => () => {};

export function BottomSheet({ open, onClose, title, children, footer }: BottomSheetProps) {
  const panelRef   = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  // THE SHEET IS PORTALLED TO <body>, AND THAT IS THE WHOLE FIX.
  //
  // `position: fixed` is only relative to the viewport while no ancestor
  // establishes a containing block — and transform, filter, perspective,
  // contain and BACKDROP-FILTER all do. /halls renders this sheet inside
  // `<div class="sticky top-14 ... backdrop-blur">`, so `bottom: 0` resolved to
  // the bottom edge of that sticky search bar rather than the bottom of the
  // window. Measured at 1025x768: the panel's bottom landed at y=217 — the
  // exact bottom of the bar — leaving most of the filters scrolled off the top
  // of the screen with the buttons stranded under the header.
  //
  // It is not a one-off: the same class of bug already cost this codebase a
  // fix when a `data-reveal` transform on HomeLocation's wrapper broke this
  // very component. An ancestor three levels up should not be able to decide
  // where a modal lands, so the sheet now leaves the tree entirely.
  //
  // useSyncExternalStore rather than a mounted flag in an effect: it takes an
  // explicit server snapshot, so there is no hydration mismatch and no
  // setState inside an effect (which this repo's lint forbids).
  const onClient = useSyncExternalStore(subscribeToNothing, () => true, () => false);

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

  // Nothing is rendered on the server: the sheet only ever opens from a click.
  if (!onClient) return null;

  return createPortal(
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
          {/* POSITIONING LIVES ON THIS WRAPPER, NOT ON THE ANIMATED PANEL.
              The panel used to carry `sm:left-1/2 sm:-translate-x-1/2` itself.
              Tailwind implements -translate-x-1/2 by writing a `transform`
              declaration — and framer-motion animates `y` by setting an INLINE
              `transform` on the same element, which beats a class every time.
              So on any viewport ≥640px the -50% X shift was silently discarded
              while `left: 50%` survived, and the sheet opened with its LEFT EDGE
              at the middle of the screen instead of straddling it. Measured at
              1025px wide: x=512 where centred would be x=257, with the panel's
              own bottom 141px below the fold and its buttons unreachable.

              It never showed up on a phone because the `sm:` classes do not
              apply there — below 640px `inset-x-0` makes the sheet full-bleed
              and nothing needs a transform.

              Centring with flexbox instead means the wrapper owns position and
              the panel owns motion, so the two can no longer collide however the
              animation changes. pointer-events are handed back on the panel so
              the full-width strip cannot swallow clicks meant for the backdrop. */}
          <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center">
          <motion.div
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal
            aria-label={title}
            className="pointer-events-auto flex max-h-[90vh] w-full flex-col rounded-t-3xl bg-white shadow-elevated outline-none sm:max-w-lg"
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
          </div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}

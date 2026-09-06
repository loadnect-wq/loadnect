"use client";

// Accessible confirmation dialog for destructive actions.
//
// USAGE — controlled:
//   const [open, setOpen] = useState(false);
//   <ConfirmationDialog
//     open={open}
//     onOpenChange={setOpen}
//     title="Delete this image?"
//     description="This cannot be undone."
//     confirmLabel="Delete"
//     tone="destructive"
//     onConfirm={async () => { await deleteImage(); }}
//   />
//
// USAGE — uncontrolled trigger:
//   <ConfirmationDialog
//     title="…" description="…" onConfirm={…}
//     trigger={<button>Delete</button>}
//   />
//
// Notes:
//   • Closes on Esc, backdrop click, and after a successful confirm.
//   • If onConfirm throws, the dialog stays open and shows the error.
//   • Focus moves to Cancel on open, is trapped inside the panel while open,
//     and returns to whatever opened the dialog on close. (This line used to
//     claim the trap that the code did not implement.)
//   • No animation library dependency — uses Tailwind for transitions.

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "destructive" | "warning" | "info";

type ControlledProps = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  trigger?: never;
};
type UncontrolledProps = {
  open?: never;
  onOpenChange?: never;
  trigger: React.ReactNode;
};

type Props = (ControlledProps | UncontrolledProps) & {
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: Tone;
  /** Returning a string treats it as an error; throwing also keeps the dialog open. */
  onConfirm: () => void | string | Promise<void | string>;
};

// Everything a keyboard user can reach inside the panel. `:not([disabled])`
// matters here: while a confirm is in flight every control is disabled, and the
// trap must not park focus on a control that cannot be activated.
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const TONE_STYLES: Record<Tone, { icon: string; iconBg: string; button: string }> = {
  destructive: {
    icon:    "text-red-600",
    iconBg:  "bg-red-50",
    button:  "bg-red-600 hover:bg-red-700 text-white",
  },
  warning: {
    icon:    "text-amber-600",
    iconBg:  "bg-amber-50",
    button:  "bg-amber-600 hover:bg-amber-700 text-white",
  },
  info: {
    icon:    "text-maroon-600",
    iconBg:  "bg-maroon-50",
    button:  "bg-maroon-700 hover:bg-maroon-800 text-white",
  },
};

export function ConfirmationDialog(props: Props) {
  const {
    title, description, confirmLabel = "Confirm", cancelLabel = "Cancel",
    tone = "destructive", onConfirm,
  } = props;

  // Support both controlled and uncontrolled patterns.
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = "open" in props && props.open !== undefined;
  const open    = isControlled ? props.open!    : internalOpen;
  const setOpen = useCallback(
    (v: boolean) => (isControlled ? props.onOpenChange!(v) : setInternalOpen(v)),
    [isControlled, props],
  );

  const [pending, setPending] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);
  const panelRef     = useRef<HTMLDivElement>(null);
  const restoreRef   = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descId  = useId();

  // Focus cancel on open for safety (a careless Enter shouldn't trigger
  // destruction), and hand focus back to whatever opened the dialog when it
  // closes. Without that second half a keyboard user who cancels is dropped at
  // the top of the document and has to tab all the way back to the row they
  // were working on.
  useEffect(() => {
    if (!open) return;
    setError(null);
    restoreRef.current = document.activeElement as HTMLElement | null;
    // Delay one frame so the dialog is in the DOM before focusing.
    const frame = requestAnimationFrame(() => cancelBtnRef.current?.focus());
    return () => {
      cancelAnimationFrame(frame);
      // The opener may have been unmounted by the action just confirmed (a
      // deleted row, a button that became a "✓ done" label). focus() on a
      // detached node is a no-op, which is the right outcome.
      restoreRef.current?.focus?.();
    };
  }, [open]);

  // Tab is kept inside the panel. An "are you sure?" that a screen-reader user
  // can tab straight out of, into the very page it is asking about, is not a
  // question.
  //
  // ESC CLOSES EVEN WHILE PENDING, and that is deliberate — an earlier version
  // gated it on !pending and turned this into a cage. Consider the combination:
  // during a confirm every control here is disabled, so the Tab branch below
  // finds nothing focusable and parks focus on the panel; the backdrop is
  // disabled too. With Esc also refused, a server action that never settles
  // (a hung request on a flaky connection — `finally` only covers one that
  // rejects) left the user no exit but a page reload.
  //
  // Closing mid-flight does not cancel the action; it was always going to
  // finish. What it costs is that the user stops watching it, which is a far
  // smaller harm than being unable to leave the dialog at all.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { setOpen(false); return; }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      // Nothing focusable inside — the state a confirm-in-flight produces,
      // since every control is disabled then. Park focus on the panel rather
      // than let Tab walk out into the page behind it. Safe to do only because
      // Esc above is unconditional: the user can always leave.
      //
      // `description` is typed ReactNode, so a caller could put a link in here
      // and this branch would not fire. That is fine — it means there IS
      // something to cycle through, which is the other correct outcome.
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
  }, [open, pending, setOpen]);

  async function handleConfirm() {
    setPending(true);
    setError(null);
    try {
      const result = await onConfirm();
      // Convention: returning a string means "show this error and stay open".
      if (typeof result === "string" && result) {
        setError(result);
        setPending(false);
        return;
      }
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  }

  const tones = TONE_STYLES[tone];

  return (
    <>
      {/* Uncontrolled trigger */}
      {!isControlled && props.trigger && (
        <span onClick={() => setOpen(true)} role="button" tabIndex={0}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setOpen(true)}>
          {props.trigger}
        </span>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={description ? descId : undefined}
        >
          {/* Backdrop */}
          <button
            type="button"
            aria-label="Dismiss"
            disabled={pending}
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-charcoal-950/50 backdrop-blur-sm transition-opacity disabled:cursor-not-allowed"
          />

          {/* Panel. tabIndex={-1} is the fallback focus holder for the moment
              when every control inside is disabled by a confirm in flight. */}
          <div
            ref={panelRef}
            tabIndex={-1}
            className={cn(
              "relative w-full max-w-md rounded-t-2xl bg-white p-6 shadow-elevated sm:rounded-2xl outline-none",
              "animate-slide-up sm:animate-fade-in",
            )}
          >
            <div className="flex items-start gap-4">
              <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full", tones.iconBg)}>
                <AlertTriangle className={cn("h-5 w-5", tones.icon)} />
              </span>
              <div className="min-w-0 flex-1">
                <h2 id={titleId} className="font-serif text-lg font-semibold text-charcoal-900">
                  {title}
                </h2>
                {description && (
                  <div id={descId} className="mt-1.5 text-sm leading-relaxed text-charcoal-600">
                    {description}
                  </div>
                )}
              </div>
              <button
                type="button"
                aria-label="Close"
                disabled={pending}
                onClick={() => setOpen(false)}
                className="-mr-2 -mt-2 rounded-full p-1.5 text-charcoal-400 transition-colors hover:bg-ivory-100 hover:text-charcoal-700 disabled:cursor-not-allowed"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {error && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
                {error}
              </div>
            )}

            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                ref={cancelBtnRef}
                type="button"
                disabled={pending}
                onClick={() => setOpen(false)}
                className="rounded-xl border border-border bg-white px-4 py-2.5 text-sm font-semibold text-charcoal-700 transition-colors hover:border-charcoal-300 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={handleConfirm}
                className={cn(
                  "rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                  tones.button,
                )}
              >
                {pending ? "Working…" : confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

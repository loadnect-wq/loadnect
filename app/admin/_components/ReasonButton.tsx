"use client";

import { useState, useTransition } from "react";

interface Props {
  /** Server action bound to its entity id; receives the moderation reason. */
  action:      (reason: string) => Promise<{ success: true } | { error: string }>;
  label:       string;
  /** Shown above the textarea, e.g. "Reject this hall". */
  title:       string;
  /** Placeholder guidance for the admin. */
  placeholder?: string;
  variant?:    "destructive" | "warning";
  className?:  string;
}

const MIN_REASON = 10;
const MAX_REASON = 1000;

/**
 * Destructive moderation control that REQUIRES a written reason.
 *
 * Rejecting or suspending a hall takes an owner's listing offline, so the
 * platform has to be able to answer "why". The reason is stored on the hall
 * (the owner sees it) and copied into the append-only admin audit log. The
 * server re-validates it — this component is convenience, not enforcement.
 */
export function ReasonButton({
  action, label, title, placeholder, variant = "destructive", className,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [open,   setOpen]   = useState(false);
  const [reason, setReason] = useState("");
  const [error,  setError]  = useState<string | null>(null);
  const [done,   setDone]   = useState(false);

  const trimmed = reason.trim();
  const tooShort = trimmed.length < MIN_REASON;

  function submit() {
    if (tooShort) {
      setError(`Please write at least ${MIN_REASON} characters.`);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await action(trimmed);
      if ("error" in result) {
        setError(result.error);
      } else {
        setDone(true);
        setOpen(false);
      }
    });
  }

  if (done) {
    return <span className="text-[11px] font-semibold text-charcoal-600">✓ {label}ed</span>;
  }

  const trigger =
    "inline-flex items-center justify-center rounded-lg px-3 text-[11px] font-semibold " +
    "min-h-[44px] lg:min-h-0 lg:py-1.5 transition-colors active:scale-[0.97] motion-reduce:active:scale-100 " +
    (variant === "destructive"
      ? "border border-red-300 bg-red-50 text-red-700 hover:bg-red-100"
      : "border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100");

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={[trigger, className].filter(Boolean).join(" ")}>
        {label}
      </button>
    );
  }

  return (
    // Mobile: full-screen sheet. lg: an inline popover anchored to the row.
    <div className="fixed inset-0 z-50 flex items-end bg-black/40 p-0 lg:absolute lg:inset-auto lg:right-0 lg:top-full lg:z-30 lg:mt-1 lg:block lg:bg-transparent lg:p-0">
      <div className="w-full rounded-t-2xl bg-white p-4 shadow-xl lg:w-80 lg:rounded-xl lg:border lg:border-charcoal-200">
        <p className="text-sm font-semibold text-charcoal-900">{title}</p>
        <p className="mt-0.5 text-[11px] text-charcoal-500">
          The hall owner will see this reason. Be specific so they can fix it.
        </p>

        <textarea
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value.slice(0, MAX_REASON))}
          rows={4}
          placeholder={placeholder ?? "e.g. Photos do not match the venue address provided."}
          className="mt-2 w-full resize-none rounded-lg border border-charcoal-300 p-2.5 text-sm text-charcoal-900 outline-none focus:border-maroon-500 focus:ring-1 focus:ring-maroon-500"
        />
        <div className="flex items-center justify-between text-[10px] text-charcoal-500">
          <span>{tooShort ? `${MIN_REASON - trimmed.length} more characters needed` : "Ready"}</span>
          <span>{trimmed.length}/{MAX_REASON}</span>
        </div>

        {error && <p className="mt-1.5 text-[11px] text-red-600">{error}</p>}

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => { setOpen(false); setError(null); }}
            disabled={pending}
            className="flex-1 rounded-lg border border-charcoal-300 bg-white px-3 py-2.5 text-xs font-semibold text-charcoal-700 hover:bg-charcoal-50 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={pending || tooShort}
            className="flex-1 rounded-lg bg-red-600 px-3 py-2.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
          >
            {pending ? "Working…" : `Confirm ${label}`}
          </button>
        </div>
      </div>
    </div>
  );
}

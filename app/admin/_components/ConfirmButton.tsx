"use client";

import { useState, useTransition } from "react";

interface Props {
  action:      () => Promise<{ success: true } | { error: string }>;
  label:       string;
  confirmText: string;
  className?:  string;
  variant?:    "default" | "destructive" | "success";
  /** Hide the button after a successful action */
  hideOnSuccess?: boolean;
  doneLabel?:  string;
}

export function ConfirmButton({
  action, label, confirmText, className, variant = "default",
  hideOnSuccess = false, doneLabel,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [armed,   setArmed]        = useState(false);
  const [error,   setError]        = useState<string | null>(null);
  const [done,    setDone]         = useState(false);

  function handleClick() {
    if (!armed) {
      setArmed(true);
      setTimeout(() => setArmed(false), 4000); // disarm after 4s
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await action();
      if ("error" in result) {
        setError(result.error);
        setArmed(false);
      } else {
        setDone(true);
      }
    });
  }

  if (done && hideOnSuccess) {
    return <span className="text-[11px] font-semibold text-green-700">{doneLabel ?? "✓ Done"}</span>;
  }

  const baseStyles = "rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-colors disabled:opacity-60";
  const styleByVariant = {
    default:     "border border-charcoal-300 bg-white text-charcoal-700 hover:bg-charcoal-50",
    destructive: armed ? "bg-red-600 text-white hover:bg-red-700"
                       : "border border-red-300 bg-red-50 text-red-700 hover:bg-red-100",
    success:     armed ? "bg-green-600 text-white hover:bg-green-700"
                       : "border border-green-300 bg-green-50 text-green-700 hover:bg-green-100",
  }[variant];

  return (
    <div className="inline-flex flex-col items-end gap-0.5">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className={[baseStyles, styleByVariant, className].filter(Boolean).join(" ")}
      >
        {pending ? "Working…" : armed ? `Confirm: ${confirmText}` : label}
      </button>
      {error && <span className="text-[10px] text-red-600">{error}</span>}
    </div>
  );
}

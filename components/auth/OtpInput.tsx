"use client";

// ─────────────────────────────────────────────────────────────────────────────
// components/auth/OtpInput.tsx — the six-box code entry, used by BOTH OTP flows.
//
// Extracted from app/verify-phone/_components/OtpForm.tsx rather than written
// again for the sign-in screen. The behaviours below are the ones people
// actually notice, and every one of them was already solved once:
//
//   • PASTE INTO ANY BOX fills the whole code. Phones offer the code from the
//     SMS as a paste suggestion and it lands wherever the caret happens to be,
//     so only handling it in box one means the common case silently drops five
//     digits.
//   • BACKSPACE ON AN EMPTY BOX steps back and clears the previous one, which
//     is what every native OTP field does. Without it the caret sticks and the
//     only way back is a mouse.
//   • AUTO-SUBMIT on the last digit, so nobody hunts for a button after the
//     code is already complete.
//   • inputMode="numeric" so the phone keyboard opens on digits, and
//     autoComplete="one-time-code" so iOS and Android offer the code they just
//     received.
//
// Purely presentational: it never sends, verifies or knows what the code is
// for. The caller owns the network call and the errors.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef } from "react";

interface Props {
  /** Current digits, one per box. Length defines the box count. */
  value: string[];
  onChange: (next: string[]) => void;
  /** Fired once the last box is filled, with the complete code. */
  onComplete: (code: string) => void;
  disabled?: boolean;
  /** Focus the first box on mount — correct when the user has just been sent a
   *  code and typing is the only thing they are here to do. */
  autoFocus?: boolean;
  /** Describes the group to a screen reader, e.g. "Verification code". */
  label: string;
  /** Marks every box invalid so the error is announced, not merely coloured. */
  invalid?: boolean;
}

export function OtpInput({
  value, onChange, onComplete, disabled, autoFocus, label, invalid,
}: Props) {
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  const length = value.length;

  useEffect(() => {
    if (autoFocus) {
      // A tick after mount: focusing during the same paint is ignored when the
      // element is still being attached after a step change.
      const t = setTimeout(() => boxes.current[0]?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [autoFocus]);

  function handle(i: number, raw: string) {
    const digits = raw.replace(/\D/g, "");

    // Paste (or an autofilled one-time-code) landing in any box.
    if (digits.length > 1) {
      const next = Array(length).fill("");
      for (let k = 0; k < Math.min(length, digits.length); k++) next[k] = digits[k];
      onChange(next);
      boxes.current[Math.min(length, digits.length) - 1]?.focus();
      if (digits.length >= length) onComplete(digits.slice(0, length));
      return;
    }

    const next = [...value];
    next[i] = digits.slice(0, 1);
    onChange(next);
    if (next[i] && i < length - 1) boxes.current[i + 1]?.focus();
    if (!next.includes("")) onComplete(next.join(""));
  }

  function handleKey(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !value[i] && i > 0) {
      boxes.current[i - 1]?.focus();
      const next = [...value];
      next[i - 1] = "";
      onChange(next);
      return;
    }
    // Arrow keys move between boxes like one field, which is how it looks.
    if (e.key === "ArrowLeft" && i > 0) boxes.current[i - 1]?.focus();
    if (e.key === "ArrowRight" && i < length - 1) boxes.current[i + 1]?.focus();
  }

  return (
    <div role="group" aria-label={label} className="flex justify-between gap-2">
      {value.map((d, i) => (
        <input
          key={i}
          ref={(el) => { boxes.current[i] = el; }}
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={length}
          value={d}
          disabled={disabled}
          aria-label={`Digit ${i + 1} of ${length}`}
          aria-invalid={invalid || undefined}
          onChange={(e) => handle(i, e.target.value)}
          onKeyDown={(e) => handleKey(i, e)}
          onFocus={(e) => e.target.select()}
          className={[
            "h-14 w-full min-w-0 rounded-xl border bg-white text-center",
            "font-serif text-xl font-semibold text-charcoal-900",
            "transition focus:outline-none focus:ring-2",
            invalid
              ? "border-red-300 focus:ring-red-400"
              : "border-border focus:border-maroon-400 focus:ring-maroon-400",
            "disabled:opacity-60",
          ].join(" ")}
        />
      ))}
    </div>
  );
}

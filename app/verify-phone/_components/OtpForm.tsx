"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { CheckCircle2, Loader2, Phone, ShieldCheck } from "lucide-react";
import { sendPhoneOtp, verifyPhoneOtp } from "../actions";

const OTP_LENGTH = 6;

interface Props {
  initialPhone: string | null;
  configured:   boolean;
}

export function OtpForm({ initialPhone, configured }: Props) {
  const [step, setStep]         = useState<"phone" | "code" | "done">("phone");
  const [phone, setPhone]       = useState(initialPhone ?? "");
  const [digits, setDigits]     = useState<string[]>(Array(OTP_LENGTH).fill(""));
  const [error, setError]       = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [pending, startTransition] = useTransition();
  const boxRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Resend countdown tick.
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  function requestOtp() {
    setError(null);
    startTransition(async () => {
      const r = await sendPhoneOtp(phone);
      if ("error" in r) { setError(r.error); return; }
      setCooldown(r.cooldownSeconds ?? 60);
      setDigits(Array(OTP_LENGTH).fill(""));
      setStep("code");
      setTimeout(() => boxRefs.current[0]?.focus(), 50);
    });
  }

  function submitCode(code: string) {
    setError(null);
    startTransition(async () => {
      const r = await verifyPhoneOtp(phone, code);
      if ("error" in r) { setError(r.error); return; }
      setStep("done");
    });
  }

  function handleDigit(i: number, value: string) {
    // Paste of the whole code into any box.
    const pasted = value.replace(/\D/g, "");
    if (pasted.length > 1) {
      const next = Array(OTP_LENGTH).fill("");
      for (let k = 0; k < Math.min(OTP_LENGTH, pasted.length); k++) next[k] = pasted[k];
      setDigits(next);
      const last = Math.min(OTP_LENGTH, pasted.length) - 1;
      boxRefs.current[last]?.focus();
      if (pasted.length >= OTP_LENGTH) submitCode(pasted.slice(0, OTP_LENGTH));
      return;
    }
    const d = pasted.slice(0, 1);
    const next = [...digits];
    next[i] = d;
    setDigits(next);
    if (d && i < OTP_LENGTH - 1) boxRefs.current[i + 1]?.focus();
    const code = next.join("");
    if (code.length === OTP_LENGTH && !next.includes("")) submitCode(code);
  }

  function handleKey(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !digits[i] && i > 0) {
      boxRefs.current[i - 1]?.focus();
      const next = [...digits];
      next[i - 1] = "";
      setDigits(next);
    }
  }

  if (!configured) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
        <p className="font-semibold">Phone verification isn&apos;t available yet</p>
        <p className="mt-1 text-xs">
          The verification service hasn&apos;t been configured. You can continue using
          Hallnect — verifying your phone will be available soon.
        </p>
      </div>
    );
  }

  if (step === "done") {
    return (
      <div className="rounded-2xl border border-green-200 bg-green-50 p-6 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10 text-green-600" aria-hidden />
        <p className="mt-3 font-serif text-lg font-bold text-charcoal-900">Phone verified</p>
        <p className="mt-1 text-sm text-charcoal-600">{phone} is now linked to your account.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-white p-5 shadow-card">
      {step === "phone" && (
        <>
          <label htmlFor="phone" className="text-xs font-semibold uppercase tracking-wide text-charcoal-500">
            Mobile number
          </label>
          <div className="mt-2 flex gap-2">
            <div className="relative flex-1">
              <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-charcoal-400" aria-hidden />
              <input
                id="phone"
                type="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91 98765 43210"
                className="min-h-[44px] w-full rounded-xl border border-border pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-maroon-400"
              />
            </div>
            <button
              type="button"
              onClick={requestOtp}
              disabled={pending || phone.trim().length < 8}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-maroon-700 px-4 text-sm font-semibold text-white transition active:scale-[0.97] disabled:opacity-60 motion-reduce:active:scale-100"
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ShieldCheck className="h-4 w-4" aria-hidden />}
              Send code
            </button>
          </div>
          <p className="mt-2 text-[11px] text-charcoal-500">
            We&apos;ll text a one-time code to confirm this number. Standard SMS rates may apply.
          </p>
        </>
      )}

      {step === "code" && (
        <>
          <p className="text-sm text-charcoal-700">
            Enter the code sent to <strong className="text-charcoal-900">{phone}</strong>
          </p>
          <div className="mt-3 flex justify-between gap-2" role="group" aria-label="One-time code">
            {digits.map((d, i) => (
              <input
                key={i}
                ref={(el) => { boxRefs.current[i] = el; }}
                inputMode="numeric"
                autoComplete={i === 0 ? "one-time-code" : "off"}
                aria-label={`Digit ${i + 1}`}
                value={d}
                onChange={(e) => handleDigit(i, e.target.value)}
                onKeyDown={(e) => handleKey(i, e)}
                disabled={pending}
                className="h-12 w-full max-w-[52px] rounded-xl border border-border text-center text-lg font-bold text-charcoal-900 focus:outline-none focus:ring-2 focus:ring-maroon-400 disabled:opacity-60"
              />
            ))}
          </div>

          <div className="mt-4 flex items-center justify-between text-xs">
            <button
              type="button"
              onClick={() => { setStep("phone"); setError(null); }}
              className="min-h-[44px] font-medium text-charcoal-600 hover:text-charcoal-900"
            >
              Change number
            </button>
            {cooldown > 0 ? (
              <span className="text-charcoal-500">
                Resend in 0:{String(cooldown).padStart(2, "0")}
              </span>
            ) : (
              <button
                type="button"
                onClick={requestOtp}
                disabled={pending}
                className="min-h-[44px] font-semibold text-maroon-700 hover:underline disabled:opacity-60"
              >
                Resend code
              </button>
            )}
          </div>
          {pending && (
            <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-charcoal-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Verifying…
            </p>
          )}
        </>
      )}

      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
    </div>
  );
}

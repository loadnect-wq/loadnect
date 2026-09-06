"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2 } from "lucide-react";
import { deleteMyAccount } from "@/app/customer/actions";

/**
 * The control /privacy §8 describes.
 *
 * It was previously a promise with nothing behind it: the policy offered a
 * right to erasure and the product had no way to exercise it, so the only
 * honest fix available at the time was to reword the policy. This is the
 * feature that lets it say the stronger thing again.
 *
 * TWO DELIBERATE PIECES OF FRICTION. It is collapsed behind a link rather than
 * sitting open next to "Sign out" — the two are one careless tap apart and only
 * one of them is reversible — and it asks the person to type DELETE, which is
 * also checked on the server because a server action is directly invocable.
 *
 * The copy states plainly what survives and why. "Your bookings and payment
 * records are kept" is the sort of thing people should learn before pressing
 * the button, not from a support reply afterwards.
 */
export function CloseAccount() {
  const [open, setOpen] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function submit() {
    setError(null);
    start(async () => {
      const r = await deleteMyAccount(phrase);
      if ("error" in r) { setError(r.error); return; }
      // The session is already gone server-side; send them somewhere public.
      router.replace("/");
      router.refresh();
    });
  }

  if (!open) {
    return (
      <div className="text-center">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-xs text-charcoal-400 underline underline-offset-2 hover:text-red-600"
        >
          Close my account
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
      <p className="flex items-center gap-1.5 text-sm font-bold text-red-900">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
        Close your account
      </p>

      <div className="mt-2 space-y-2 text-xs leading-relaxed text-red-900">
        <p>
          Your name, email, phone number and saved venues are permanently removed, and
          you will not be able to sign in again. This cannot be undone.
        </p>
        <p>
          <strong>Your booking and payment records are kept.</strong> Tax and consumer
          law require us to retain them for seven years, so they stay — but with nothing
          identifying you attached to them. Reviews you left remain visible without your
          name.
        </p>
        <p>
          If you have a booking in progress or a refund on the way, close the account
          once those are finished — we will tell you if so.
        </p>
      </div>

      <label htmlFor="close-confirm" className="mt-3 block text-xs font-semibold text-red-900">
        Type DELETE to confirm
      </label>
      <input
        id="close-confirm"
        value={phrase}
        onChange={(e) => setPhrase(e.target.value)}
        autoComplete="off"
        className="mt-1 w-full rounded-lg border border-red-300 bg-white px-3 py-2 text-sm outline-none focus:border-red-500"
        placeholder="DELETE"
      />

      {error && <p className="mt-2 text-xs font-semibold text-red-700">{error}</p>}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={pending || phrase.trim().toUpperCase() !== "DELETE"}
          className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
        >
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
          {pending ? "Closing…" : "Close my account"}
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setPhrase(""); setError(null); }}
          disabled={pending}
          className="rounded-lg border border-red-300 bg-white px-3 py-2 text-xs font-semibold text-red-800 disabled:opacity-50"
        >
          Keep my account
        </button>
      </div>
    </div>
  );
}

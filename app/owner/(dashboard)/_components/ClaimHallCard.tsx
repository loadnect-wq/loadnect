"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, Loader2, MapPin, Users } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { claimHallDraft } from "../actions";

type Props = {
  draftId:     string;
  name:        string;
  city:        string;
  address:     string | null;
  capacityMax: number;
};

/**
 * "Your hall is already on Hallnect" — shown only when an admin recorded this
 * venue against the mobile number this owner has VERIFIED.
 *
 * The card is rendered from a row RLS already restricted to this user, so
 * appearing at all is itself the match. Nothing here decides anything: the
 * claim is settled inside claim_admin_hall_draft(), which re-derives the caller
 * and re-checks the phone before it writes.
 *
 * REQUIRES AN EXPLICIT CONFIRMATION, per the brief. Claiming asserts authority
 * over a real business, so it should not be one stray tap on a dashboard
 * somebody opened for another reason.
 */
export function ClaimHallCard({ draftId, name, city, address, capacityMax }: Props) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleClaim() {
    setError(null);
    startTransition(async () => {
      const result = await claimHallDraft({ draftId });
      if ("error" in result) { setError(result.error); return; }
      toast({
        title: "Hall claimed",
        description: `${name} is now yours to complete and submit.`,
        variant: "success",
      });
      router.push(`/owner/halls/${result.hallId}/edit`);
      router.refresh();
    });
  }

  return (
    <section className="rounded-2xl border-2 border-gold-400 bg-gold-50 p-4 shadow-card">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gold-500">
          <Building2 className="h-5 w-5 text-white" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-serif text-base font-bold text-charcoal-900">
            Your hall is already on Hallnect
          </h2>
          <p className="mt-0.5 text-xs leading-relaxed text-charcoal-700">
            Our team added this venue for you. Claim it to take over the listing, complete
            the details and submit it for verification.
          </p>

          <div className="mt-3 rounded-xl border border-gold-200 bg-white p-3">
            <p className="font-serif text-sm font-semibold text-charcoal-900">{name}</p>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-charcoal-600">
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3 w-3 text-maroon-500" aria-hidden />
                {address ? `${address}, ${city}` : city}
              </span>
              <span className="inline-flex items-center gap-1">
                <Users className="h-3 w-3 text-maroon-500" aria-hidden />
                up to {capacityMax.toLocaleString("en-IN")} guests
              </span>
            </p>
          </div>

          {error && (
            <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </p>
          )}

          {!confirming ? (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="mt-3 inline-flex items-center rounded-xl bg-maroon-700 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-maroon-800"
            >
              Claim hall
            </button>
          ) : (
            <div className="mt-3 rounded-xl border border-maroon-200 bg-white p-3">
              <p className="text-xs font-semibold text-charcoal-900">
                Confirm you are authorised to manage {name}
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-charcoal-600">
                By claiming, you confirm you own or are authorised to manage this venue.
                It becomes your listing, and details you publish are your responsibility.
              </p>
              <div className="mt-3 flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleClaim}
                  disabled={pending}
                  className="inline-flex items-center rounded-lg bg-maroon-700 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-maroon-800 disabled:opacity-60"
                >
                  {pending && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" aria-hidden />}
                  Yes, this is my venue
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  disabled={pending}
                  className="text-xs text-charcoal-500 hover:text-charcoal-800"
                >
                  Not mine
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

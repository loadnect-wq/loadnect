"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Two ways to send a Hallnect link: WhatsApp (where the family decides) and a
// plain copy for anywhere else. WhatsApp is a wa.me link with no number, so it
// opens the sender's own WhatsApp and asks which chat — the message goes from
// them, not from Hallnect. Used by the shortlist and the comparison.
//
// The link is always built on the canonical host (absoluteUrl), so a share
// made on a preview deploy or a www. URL still points at the public site.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from "react";
import { Check, Link2, MessageCircle } from "lucide-react";
import { absoluteUrl } from "@/lib/seo/config";
import { whatsappShareUrl } from "@/lib/shortlist";

export function ShareButtons({
  path,
  text,
  label = "Share on WhatsApp",
}: {
  /** Root-relative path of the page being shared. */
  path: string;
  /** The message, in the sender's voice; the link is appended on its own line. */
  text: string;
  label?: string;
}) {
  const url = absoluteUrl(path);
  const [copy, setCopy] = useState<"idle" | "copied" | "manual">("idle");

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopy("copied");
      setTimeout(() => setCopy("idle"), 2500);
    } catch {
      // Clipboard blocked (an in-app browser, an old WebView): show the link
      // so it can be long-pressed and copied by hand.
      setCopy("manual");
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <a
          href={whatsappShareUrl(`${text}\n${url}`)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-[#1a7f45] px-4 text-sm font-semibold text-white hover:bg-[#166b3a]"
        >
          <MessageCircle className="h-4 w-4" aria-hidden /> {label}
        </a>
        <button
          type="button"
          onClick={copyLink}
          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-border bg-white px-4 text-sm font-semibold text-charcoal-800 hover:bg-ivory-100"
        >
          {copy === "copied" ? <Check className="h-4 w-4 text-green-700" aria-hidden /> : <Link2 className="h-4 w-4" aria-hidden />}
          {copy === "copied" ? "Link copied" : "Copy link"}
        </button>
      </div>
      {copy === "manual" && (
        <p className="mt-2 break-all rounded-lg bg-ivory-100 px-3 py-2 text-xs text-charcoal-700 select-all">{url}</p>
      )}
      <span className="sr-only" aria-live="polite">{copy === "copied" ? "Link copied" : ""}</span>
    </div>
  );
}

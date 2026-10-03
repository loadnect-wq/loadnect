"use client";

// A shortlist's share buttons: the generic ShareButtons with the shortlist's
// path and message. See lib/shortlist.ts.

import { ShareButtons } from "@/components/share/ShareButtons";
import { shortlistPath, shortlistShareText } from "@/lib/shortlist";

export function ShareShortlist({ code, count, label = "Share on WhatsApp" }: { code: string; count: number; label?: string }) {
  return <ShareButtons path={shortlistPath(code)} text={shortlistShareText(count)} label={label} />;
}

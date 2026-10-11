// /ta/guides — the Tamil guides index. noindex until at least one Tamil guide
// has been checked by a native speaker (lib/guides.ts taReviewed).
//
// The root layout's <html> is en-IN, so the wrapper carries lang="ta", with
// the self-hosted Noto Sans Tamil (never next/font/google — it broke a build).

import type { Metadata } from "next";
import { AppHeader } from "@/components/app/AppHeader";
import { GuidesIndex } from "@/components/guides/GuidesIndex";
import { notoSansTamil } from "@/app/fonts/noto-sans-tamil/font";
import { guidesIndexMetadata } from "@/lib/seo/guide-metadata";

const FONT_STACK = "var(--font-inter), var(--font-tamil), system-ui, sans-serif";

export const metadata: Metadata = guidesIndexMetadata("ta");

export default function TamilGuidesPage() {
  return (
    <div lang="ta" className={`${notoSansTamil.variable} min-h-screen bg-ivory-100`} style={{ fontFamily: FONT_STACK }}>
      <AppHeader title="வழிகாட்டிகள்" />
      <GuidesIndex lang="ta" />
    </div>
  );
}

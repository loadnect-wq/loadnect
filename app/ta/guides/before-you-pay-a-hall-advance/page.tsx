// /ta/guides/before-you-pay-a-hall-advance — the Tamil twin of the hall
// advance guide. noindex until a native speaker has checked it
// (lib/guides.ts taReviewed).

import type { Metadata } from "next";
import { AppHeader } from "@/components/app/AppHeader";
import { HallAdvanceGuide } from "@/components/guides/HallAdvanceGuide";
import { notoSansTamil } from "@/app/fonts/noto-sans-tamil/font";
import { guideMetadata } from "@/lib/seo/guide-metadata";

const FONT_STACK = "var(--font-inter), var(--font-tamil), system-ui, sans-serif";

export const metadata: Metadata = guideMetadata("before-you-pay-a-hall-advance", "ta");

export default function TamilHallAdvanceGuidePage() {
  return (
    <div lang="ta" className={`${notoSansTamil.variable} min-h-screen bg-ivory-100`} style={{ fontFamily: FONT_STACK }}>
      <AppHeader title="முன்பணத்துக்கு முன்" />
      <HallAdvanceGuide lang="ta" />
    </div>
  );
}

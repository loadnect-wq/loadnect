// /guides/before-you-pay-a-hall-advance — see components/guides/HallAdvanceGuide.tsx.

import type { Metadata } from "next";
import { AppHeader } from "@/components/app/AppHeader";
import { HallAdvanceGuide } from "@/components/guides/HallAdvanceGuide";
import { guideMetadata } from "@/lib/seo/guide-metadata";

export const metadata: Metadata = guideMetadata("before-you-pay-a-hall-advance", "en");

export default function HallAdvanceGuidePage() {
  return (
    <div className="min-h-screen bg-ivory-100">
      <AppHeader title="Before you pay" />
      <HallAdvanceGuide lang="en" />
    </div>
  );
}

// /guides/birthday-party-hall — see components/guides/PartyHallGuide.tsx.
// English only (lib/guides.ts: ta is null).

import type { Metadata } from "next";
import { AppHeader } from "@/components/app/AppHeader";
import { PartyHallGuide } from "@/components/guides/PartyHallGuide";
import { guideMetadata } from "@/lib/seo/guide-metadata";

export const metadata: Metadata = guideMetadata("birthday-party-hall", "en");

export default function PartyHallGuidePage() {
  return (
    <div className="min-h-screen bg-ivory-100">
      <AppHeader title="Party halls" />
      <PartyHallGuide />
    </div>
  );
}

// /guides/marriage-hall-booking-receipt — see components/guides/ReceiptGuide.tsx.
// English only (lib/guides.ts: ta is null).

import type { Metadata } from "next";
import { AppHeader } from "@/components/app/AppHeader";
import { ReceiptGuide } from "@/components/guides/ReceiptGuide";
import { guideMetadata } from "@/lib/seo/guide-metadata";

export const metadata: Metadata = guideMetadata("marriage-hall-booking-receipt", "en");

export default function ReceiptGuidePage() {
  return (
    <div className="min-h-screen bg-ivory-100">
      <AppHeader title="Booking receipt" />
      <ReceiptGuide />
    </div>
  );
}

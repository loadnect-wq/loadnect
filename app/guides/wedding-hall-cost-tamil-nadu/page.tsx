// /guides/wedding-hall-cost-tamil-nadu — see components/guides/HallCostGuide.tsx.
//
// ISR, hourly: the city table is live listing data. A failed read throws
// (lib/guides.server.ts), so the last good page keeps being served.

import type { Metadata } from "next";
import { AppHeader } from "@/components/app/AppHeader";
import { HallCostGuide, cityPriceRanges } from "@/components/guides/HallCostGuide";
import { guideMetadata } from "@/lib/seo/guide-metadata";
import { fetchListedPricesStrict } from "@/lib/guides.server";
import { todayInBusinessTz } from "@/lib/dates";

export const revalidate = 3600;

export const metadata: Metadata = guideMetadata("wedding-hall-cost-tamil-nadu", "en");

export default async function HallCostGuidePage() {
  const rows = cityPriceRanges(await fetchListedPricesStrict());
  return (
    <div className="min-h-screen bg-ivory-100">
      <AppHeader title="Hall costs" />
      <HallCostGuide lang="en" rows={rows} asOf={todayInBusinessTz()} />
    </div>
  );
}

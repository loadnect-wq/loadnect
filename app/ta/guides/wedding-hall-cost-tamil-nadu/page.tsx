// /ta/guides/wedding-hall-cost-tamil-nadu — the Tamil twin of the hall cost
// guide. noindex until a native speaker has checked it (lib/guides.ts
// taReviewed). ISR, hourly, like the English page.

import type { Metadata } from "next";
import { AppHeader } from "@/components/app/AppHeader";
import { HallCostGuide, cityPriceRanges } from "@/components/guides/HallCostGuide";
import { notoSansTamil } from "@/app/fonts/noto-sans-tamil/font";
import { guideMetadata } from "@/lib/seo/guide-metadata";
import { fetchListedPricesStrict } from "@/lib/guides.server";
import { todayInBusinessTz } from "@/lib/dates";

export const revalidate = 3600;

const FONT_STACK = "var(--font-inter), var(--font-tamil), system-ui, sans-serif";

export const metadata: Metadata = guideMetadata("wedding-hall-cost-tamil-nadu", "ta");

export default async function TamilHallCostGuidePage() {
  const rows = cityPriceRanges(await fetchListedPricesStrict());
  return (
    <div lang="ta" className={`${notoSansTamil.variable} min-h-screen bg-ivory-100`} style={{ fontFamily: FONT_STACK }}>
      <AppHeader title="மண்டப வாடகை" />
      <HallCostGuide lang="ta" rows={rows} asOf={todayInBusinessTz()} />
    </div>
  );
}

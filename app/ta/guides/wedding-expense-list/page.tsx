// /ta/guides/wedding-expense-list — the Tamil twin of the expense list guide.
// noindex until a native speaker has checked it (lib/guides.ts taReviewed).

import type { Metadata } from "next";
import { AppHeader } from "@/components/app/AppHeader";
import { ExpenseListGuide } from "@/components/guides/ExpenseListGuide";
import { notoSansTamil } from "@/app/fonts/noto-sans-tamil/font";
import { guideMetadata } from "@/lib/seo/guide-metadata";

const FONT_STACK = "var(--font-inter), var(--font-tamil), system-ui, sans-serif";

export const metadata: Metadata = guideMetadata("wedding-expense-list", "ta");

export default function TamilWeddingExpenseListPage() {
  return (
    <div lang="ta" className={`${notoSansTamil.variable} min-h-screen bg-ivory-100`} style={{ fontFamily: FONT_STACK }}>
      <AppHeader title="செலவு பட்டியல்" />
      <ExpenseListGuide lang="ta" />
    </div>
  );
}

// /guides/wedding-expense-list — see components/guides/ExpenseListGuide.tsx.

import type { Metadata } from "next";
import { AppHeader } from "@/components/app/AppHeader";
import { ExpenseListGuide } from "@/components/guides/ExpenseListGuide";
import { guideMetadata } from "@/lib/seo/guide-metadata";

export const metadata: Metadata = guideMetadata("wedding-expense-list", "en");

export default function WeddingExpenseListPage() {
  return (
    <div className="min-h-screen bg-ivory-100">
      <AppHeader title="Expense list" />
      <ExpenseListGuide lang="en" />
    </div>
  );
}

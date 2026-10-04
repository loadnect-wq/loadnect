// A plan the visitor is not in reads as absent (RLS), and that is what a
// family member hits when a summary is forwarded to someone who never joined.
// Say why, and what to ask for, instead of a bare 404.

import Link from "next/link";
import { Lock } from "lucide-react";
import { AppHeader } from "@/components/app/AppHeader";
import { EmptyState } from "@/components/ui/empty-state";

export default function PlanNotFound() {
  return (
    <div className="min-h-screen bg-ivory-100">
      <AppHeader title="Family plan" showBack />
      <div className="container-app max-w-xl py-6">
        <EmptyState
          icon={<Lock className="h-8 w-8" />}
          title="We can't show this plan"
          description="Plans are private: only the person who started one, and the people they invite, can open it. If someone sent you this link, ask them for an invite link from the Family part of their plan."
          action={
            <Link href="/plan" className="inline-flex min-h-[44px] items-center rounded-xl bg-maroon-700 px-5 text-sm font-semibold text-white hover:bg-maroon-800">
              My plans
            </Link>
          }
        />
      </div>
    </div>
  );
}

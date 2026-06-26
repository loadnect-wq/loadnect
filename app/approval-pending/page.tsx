import { Clock, Gem, Mail } from "lucide-react";
import Link from "next/link";
import { getProfile } from "@/lib/auth";
import { getDashboardPath } from "@/lib/constants";
import { redirect } from "next/navigation";

export default async function ApprovalPendingPage() {
  const profile = await getProfile();

  if (!profile) redirect("/login");
  if (profile.role !== "owner_pending") {
    redirect(getDashboardPath(profile.role));
  }

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center bg-ivory-100 px-4 py-12">
      <div className="w-full max-w-lg text-center space-y-6">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-gold-100">
          <Clock className="h-10 w-10 text-gold-600" />
        </div>

        <div className="space-y-2">
          <h1 className="font-serif text-3xl font-bold text-charcoal-900">
            Approval Pending
          </h1>
          <p className="text-muted-foreground">
            Hi{profile.full_name ? ` ${profile.full_name}` : ""}, your owner account is under review.
          </p>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-card text-left space-y-4">
          <h2 className="font-serif text-lg font-semibold text-charcoal-900">What happens next?</h2>
          <ul className="space-y-3 text-sm text-charcoal-700">
            <li className="flex items-start gap-3">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-maroon-100 text-xs font-bold text-maroon-700">1</span>
              <span>Our team reviews your registration (typically within 24–48 hours).</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-maroon-100 text-xs font-bold text-maroon-700">2</span>
              <span>Once approved, you&apos;ll receive an email notification.</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-maroon-100 text-xs font-bold text-maroon-700">3</span>
              <span>You can then add your business details and list your halls.</span>
            </li>
          </ul>
        </div>

        <div className="flex flex-col items-center gap-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Mail className="h-4 w-4" />
            <span>Questions? Contact <strong className="text-charcoal-700">support@hallnect.com</strong></span>
          </div>
          <Link href="/" className="inline-flex items-center gap-2 text-sm font-semibold text-maroon-600 hover:underline">
            <Gem className="h-4 w-4" />
            Back to Hallnect
          </Link>
        </div>
      </div>
    </div>
  );
}

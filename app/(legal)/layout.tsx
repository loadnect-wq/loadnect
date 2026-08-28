import Link from "next/link";
import { ChevronRight } from "lucide-react";

interface LegalLayoutProps {
  children: React.ReactNode;
}

export default function LegalLayout({ children }: LegalLayoutProps) {
  return (
    <div className="min-h-screen bg-ivory-100">
      {/* ── Breadcrumb ───────────────────────────────────────────── */}
      <div className="border-b border-border bg-white">
        <div className="container-page flex items-center gap-1.5 py-4 text-xs text-muted-foreground">
          <Link href="/" className="hover:text-maroon-600">Home</Link>
          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          <span className="text-charcoal-700">Legal</span>
        </div>
      </div>

      {/* The banner that used to sit here told every visitor these policies
          were "drafts prepared for the Hallnect MVP" that "should be reviewed
          by a qualified legal professional before public launch". It rendered
          on all five legal pages — each linked from the footer sitewide, each
          indexed, and Terms linked from the booking checkout's mandatory
          acceptance checkbox. A customer about to pay a real advance was being
          told in writing that the binding terms were unfinished. */}

      {/* ── Content ─────────────────────────────────────────────── */}
      <div className="container-page max-w-3xl py-14">
        {children}
      </div>
    </div>
  );
}

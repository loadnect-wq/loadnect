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

      {/* ── MVP draft notice ─────────────────────────────────────── */}
      <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-center">
        <p className="text-xs text-amber-800">
          <strong>Notice:</strong> These policies are drafts prepared for the Hallnect MVP.
          They should be reviewed by a qualified legal professional before public launch.
        </p>
      </div>

      {/* ── Content ─────────────────────────────────────────────── */}
      <div className="container-page max-w-3xl py-14">
        {children}
      </div>
    </div>
  );
}

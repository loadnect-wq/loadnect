import { MessageSquare } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import type { MyTicket } from "@/lib/tickets";

type BadgeVar = "success" | "warning" | "secondary" | "destructive" | "default";

const STATUS_CFG: Record<string, { label: string; variant: BadgeVar }> = {
  open:        { label: "Open",        variant: "warning"   },
  in_progress: { label: "In Progress", variant: "default"   },
  resolved:    { label: "Resolved",    variant: "success"   },
  closed:      { label: "Closed",      variant: "secondary" },
};

const PRIORITY_STYLE: Record<string, string> = {
  low:    "border-charcoal-300 text-charcoal-600",
  medium: "border-blue-300 text-blue-700",
  high:   "border-amber-300 text-amber-700",
  urgent: "border-red-400 text-red-700 font-bold",
};

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export function TicketList({ tickets }: { tickets: MyTicket[] }) {
  if (tickets.length === 0) {
    return (
      <div className="rounded-2xl bg-white p-8 text-center shadow-card">
        <MessageSquare className="mx-auto h-10 w-10 text-charcoal-300 mb-3" />
        <p className="text-sm text-charcoal-500">You haven&apos;t created any support tickets yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {tickets.map((t) => {
        const cfg = STATUS_CFG[t.status] ?? { label: t.status, variant: "secondary" as BadgeVar };
        const prioStyle = PRIORITY_STYLE[t.priority] ?? PRIORITY_STYLE.medium;
        return (
          <div key={t.id} className="rounded-2xl bg-white p-4 shadow-card">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-serif text-sm font-semibold text-charcoal-900">{t.subject}</p>
                <p className="text-[10px] text-charcoal-400 mt-0.5">{fmtDateTime(t.created_at)}</p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${prioStyle}`}>
                  {t.priority}
                </span>
                {t.category && (
                  <span className="rounded-full border border-charcoal-200 px-2 py-0.5 text-[10px] text-charcoal-600">
                    {t.category}
                  </span>
                )}
                <Badge variant={cfg.variant} size="sm">{cfg.label}</Badge>
              </div>
            </div>

            <p className="mt-3 rounded-xl bg-ivory-100 px-3 py-2.5 text-xs text-charcoal-700 whitespace-pre-wrap">
              {t.message}
            </p>

            {t.admin_response && (
              <div className="mt-3 rounded-xl border border-maroon-200 bg-maroon-50 px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-maroon-700">Hallnect support reply</p>
                <p className="mt-1 text-xs text-charcoal-800 whitespace-pre-wrap">{t.admin_response}</p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

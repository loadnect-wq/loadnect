import type { Metadata } from "next";
import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { fetchAllTickets } from "@/lib/admin";
import { Badge } from "@/components/ui/Badge";
import { AdminPageHeader } from "../_components/AdminPageHeader";
import { TicketReplyForm } from "./_components/TicketReplyForm";

export const metadata: Metadata = { title: "Support Tickets — Admin" };

type BadgeVar = "success" | "warning" | "secondary" | "destructive" | "default";

const FILTERS = [
  { key: "all",        label: "All",         value: undefined        },
  { key: "open",       label: "Open",        value: "open"          },
  { key: "in_progress", label: "In Progress", value: "in_progress"   },
  { key: "resolved",   label: "Resolved",    value: "resolved"      },
  { key: "closed",     label: "Closed",      value: "closed"        },
];

const STATUS_CFG: Record<string, { label: string; variant: BadgeVar }> = {
  open:        { label: "Open",        variant: "warning"   },
  in_progress: { label: "In Progress", variant: "default"   },
  resolved:    { label: "Resolved",    variant: "success"   },
  closed:      { label: "Closed",      variant: "secondary" },
};

const PRIORITY_CFG: Record<string, string> = {
  low:    "border-charcoal-300 text-charcoal-600",
  normal: "border-blue-300 text-blue-700",
  medium: "border-blue-300 text-blue-700",
  high:   "border-amber-300 text-amber-700",
  urgent: "border-red-400 text-red-700 font-bold",
};

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

type Props = { searchParams: Promise<{ status?: string }> };

export default async function AdminTicketsPage({ searchParams }: Props) {
  const { status } = await searchParams;
  const activeFilter = FILTERS.find((f) => f.key === status) ?? FILTERS[0];
  const tickets = await fetchAllTickets(activeFilter.value);

  return (
    <div>
      <AdminPageHeader title="Support Tickets" description="Help requests from users. Reply and update status to close out tickets." />

      <div className="px-4 py-4 sm:px-6 lg:px-8 space-y-4">

        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <Link
              key={f.key}
              href={f.key === "all" ? "?" : `?status=${f.key}`}
              className={[
                "rounded-full border px-3 py-1 text-xs font-semibold",
                activeFilter.key === f.key
                  ? "border-maroon-700 bg-maroon-700 text-white"
                  : "border-border bg-white text-charcoal-600 hover:border-maroon-300",
              ].join(" ")}
            >
              {f.label}
            </Link>
          ))}
        </div>

        {tickets.length === 0 ? (
          <div className="rounded-2xl bg-white p-8 text-center shadow-card">
            <MessageSquare className="mx-auto h-10 w-10 text-charcoal-300 mb-3" />
            <p className="text-sm text-charcoal-500">No tickets match this filter.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {tickets.map((t) => {
              const cfg = STATUS_CFG[t.status] ?? { label: t.status, variant: "secondary" as BadgeVar };
              const prioStyle = PRIORITY_CFG[t.priority] ?? PRIORITY_CFG.normal;
              return (
                <div key={t.id} className="rounded-2xl bg-white p-4 shadow-card">
                  {/* Header */}
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-serif text-sm font-semibold text-charcoal-900">{t.subject}</p>
                      <p className="text-[11px] text-charcoal-500 mt-0.5">
                        From <strong className="text-charcoal-700">{t.user_name ?? "—"}</strong>
                        <span className="text-charcoal-400"> ({t.user_email ?? "—"})</span>
                      </p>
                      <p className="text-[10px] text-charcoal-400">{fmtDateTime(t.created_at)}</p>
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

                  {/* Message */}
                  <p className="mt-3 rounded-xl bg-ivory-100 px-3 py-2.5 text-xs text-charcoal-700 whitespace-pre-wrap">
                    {t.message}
                  </p>

                  {/* Reply form */}
                  <TicketReplyForm
                    ticketId={t.id}
                    currentStatus={t.status}
                    initialResponse={t.admin_response}
                    initialNotes={t.internal_notes}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

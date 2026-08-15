"use client";

import { useState, useTransition } from "react";
import { Send } from "lucide-react";
import { respondToTicket } from "../../actions";

interface Props {
  ticketId:        string;
  currentStatus:   string;
  initialResponse: string | null;
  initialNotes?:   string | null;
}

const STATUS_OPTIONS = [
  { value: "open",        label: "Open"        },
  { value: "in_progress", label: "In Progress" },
  { value: "resolved",    label: "Resolved"    },
  { value: "closed",      label: "Closed"      },
];

export function TicketReplyForm({ ticketId, currentStatus, initialResponse, initialNotes }: Props) {
  const [response, setResponse]   = useState(initialResponse ?? "");
  const [notes,    setNotes]      = useState(initialNotes ?? "");
  const [status,   setStatus]     = useState(currentStatus);
  const [pending,  startTransition] = useTransition();
  const [error,    setError]      = useState<string | null>(null);
  const [saved,    setSaved]      = useState(false);

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await respondToTicket(ticketId, {
        status,
        adminResponse: response,
        internalNotes: notes,
      });
      if ("error" in result) setError(result.error);
      else setSaved(true);
    });
  }

  return (
    <form onSubmit={handleSave} className="space-y-2.5 border-t border-border pt-3">
      <div className="grid grid-cols-2 gap-2">
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); setSaved(false); }}
          className="rounded-lg border border-border bg-white px-2 py-1.5 text-xs font-semibold text-charcoal-700 focus:outline-none focus:ring-2 focus:ring-maroon-500"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>Status: {o.label}</option>
          ))}
        </select>
        <button
          type="submit"
          disabled={pending}
          className="flex items-center justify-center gap-1 rounded-lg bg-maroon-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-maroon-800 disabled:opacity-60"
        >
          <Send className="h-3 w-3" />
          {pending ? "Saving…" : "Save"}
        </button>
      </div>

      <div>
        <label className="text-[10px] font-semibold uppercase tracking-wide text-charcoal-500">
          Reply to user (visible)
        </label>
        <textarea
          value={response}
          onChange={(e) => { setResponse(e.target.value); setSaved(false); }}
          placeholder="Reply to the user…"
          rows={3}
          maxLength={4000}
          className="mt-1 block w-full rounded-lg border border-border bg-white px-2.5 py-2 text-xs text-charcoal-900 placeholder:text-charcoal-400 focus:outline-none focus:ring-2 focus:ring-maroon-500 resize-none"
        />
      </div>

      <div>
        <label className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">
          Internal notes (admin only — never shown to user)
        </label>
        <textarea
          value={notes}
          onChange={(e) => { setNotes(e.target.value); setSaved(false); }}
          placeholder="Private note for your team…"
          rows={2}
          maxLength={4000}
          className="mt-1 block w-full rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-charcoal-900 placeholder:text-charcoal-400 focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
        />
      </div>

      {error && <p className="text-[11px] text-red-600">{error}</p>}
      {saved && <p className="text-[11px] text-green-700">✓ Saved</p>}
    </form>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { createTicket } from "@/app/_actions/tickets";
import {
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  TICKET_LIMITS,
  type TicketPriority,
} from "@/lib/tickets";

export function CreateTicketForm() {
  const router = useRouter();
  const [subject,  setSubject]  = useState("");
  const [category, setCategory] = useState("");
  const [priority, setPriority] = useState<TicketPriority>("medium");
  const [message,  setMessage]  = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [open,     setOpen]     = useState(false);

  if (!open) {
    return (
      <Button variant="default" size="sm" onClick={() => setOpen(true)}>
        Create new ticket
      </Button>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const result = await createTicket({
      subject, message,
      category: category || undefined,
      priority,
    });
    setLoading(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setSubject(""); setMessage(""); setCategory(""); setPriority("medium");
    setOpen(false);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-2xl bg-white p-4 shadow-card">
      <p className="font-serif text-base font-semibold text-charcoal-900">New support ticket</p>

      <input
        type="text"
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        placeholder="Subject"
        maxLength={TICKET_LIMITS.subject}
        required
        className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm focus:border-maroon-400 focus:outline-none focus:ring-1 focus:ring-maroon-300"
      />

      <div className="grid grid-cols-2 gap-3">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm focus:border-maroon-400 focus:outline-none focus:ring-1 focus:ring-maroon-300"
        >
          <option value="">Category (optional)</option>
          {TICKET_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>

        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value as TicketPriority)}
          className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm focus:border-maroon-400 focus:outline-none focus:ring-1 focus:ring-maroon-300"
        >
          {TICKET_PRIORITIES.map((p) => (
            <option key={p.value} value={p.value}>Priority: {p.label}</option>
          ))}
        </select>
      </div>

      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Describe the issue in detail"
        maxLength={TICKET_LIMITS.message}
        rows={5}
        required
        className="w-full resize-none rounded-xl border border-border bg-white px-3 py-2 text-sm focus:border-maroon-400 focus:outline-none focus:ring-1 focus:ring-maroon-300"
      />

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{error}</p>
      )}

      <div className="flex gap-2">
        <Button type="submit" variant="default" size="sm" disabled={loading} isLoading={loading}>
          Submit ticket
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)} disabled={loading}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

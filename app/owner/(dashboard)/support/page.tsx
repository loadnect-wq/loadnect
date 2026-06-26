import type { Metadata } from "next";
import { CreateTicketForm } from "@/components/support/CreateTicketForm";
import { TicketList } from "@/components/support/TicketList";
import { fetchMyTickets } from "@/lib/tickets-server";

export const metadata: Metadata = { title: "Support — Owner" };

export default async function OwnerSupportPage() {
  const tickets = await fetchMyTickets();

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 space-y-4">
      <div>
        <h1 className="font-serif text-xl font-bold text-charcoal-900">Support</h1>
        <p className="text-sm text-charcoal-500">Get help from Hallnect — we usually reply within 1 business day.</p>
      </div>
      <CreateTicketForm />
      <TicketList tickets={tickets} />
    </div>
  );
}

import type { Metadata } from "next";
import { AppHeader } from "@/components/app/AppHeader";
import { CreateTicketForm } from "@/components/support/CreateTicketForm";
import { TicketList } from "@/components/support/TicketList";
import { fetchMyTickets } from "@/lib/tickets-server";

export const metadata: Metadata = { title: "Support — Hallnect" };

export default async function CustomerSupportPage() {
  const tickets = await fetchMyTickets();

  return (
    <div className="min-h-screen bg-ivory-100">
      <AppHeader title="Support" />

      <div className="px-4 py-5 sm:px-6 lg:px-8 space-y-4">
        <CreateTicketForm />
        <TicketList tickets={tickets} />
      </div>
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import {
  Wallet, Sparkles, Bell, MessageSquare, User, ChevronRight, Building2,
} from "lucide-react";
import { requireRole } from "@/lib/auth";
import { AppHeader } from "@/components/app/AppHeader";

export const metadata: Metadata = { title: "More" };

// Everything the phone tab bar cannot fit. Only five tabs stay tappable at
// 360px, so the rest live here rather than being unreachable — which is what
// they were before this page existed.
const ITEMS = [
  { href: "/owner/commissions",   label: "Commissions",   desc: "What Hallnect kept from each booking", Icon: Wallet },
  { href: "/owner/premium",       label: "Premium",       desc: "Your plan and monthly billing",        Icon: Sparkles },
  { href: "/owner/notifications", label: "Notifications", desc: "Booking and payment alerts",           Icon: Bell },
  { href: "/owner/support",       label: "Support",       desc: "Get help from Hallnect",               Icon: MessageSquare },
  { href: "/owner/profile",       label: "Profile",       desc: "Business details and payout account",  Icon: User },
  { href: "/owner/halls/new",     label: "Add a hall",    desc: "List another venue",                   Icon: Building2 },
];

export default async function OwnerMorePage() {
  await requireRole(["owner_approved"]);

  return (
    <div className="min-h-screen bg-ivory-100">
      <AppHeader title="More" notificationsHref="/owner/notifications" />
      <div className="px-4 py-5 sm:px-6 lg:px-8">
        <ul className="divide-y divide-border overflow-hidden rounded-2xl bg-white shadow-card">
          {ITEMS.map(({ href, label, desc, Icon }) => (
            <li key={href}>
              <Link
                href={href}
                className="flex min-h-[60px] items-center gap-3 px-4 py-3 active:bg-ivory-100"
              >
                <Icon className="h-5 w-5 shrink-0 text-charcoal-400" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-charcoal-900">{label}</p>
                  <p className="truncate text-xs text-charcoal-500">{desc}</p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-charcoal-300" />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

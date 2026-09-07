import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import Link from "next/link";
import { BadgeCheck } from "lucide-react";
import { fetchAllOwners } from "@/lib/admin";
import { Badge } from "@/components/ui/Badge";
import { AdminPageHeader } from "../_components/AdminPageHeader";
import { ConfirmButton } from "../_components/ConfirmButton";
import { verifyOwnerRow } from "../actions";

export const metadata: Metadata = { title: "Owners — Admin" };

const FILTERS = [
  { key: "all",         label: "All",         value: undefined as undefined | "verified" | "unverified" },
  { key: "unverified",  label: "Unverified",  value: "unverified" as const },
  { key: "verified",    label: "Verified",    value: "verified"   as const },
];

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

type Props = { searchParams: Promise<{ filter?: string }> };

export default async function AdminOwnersPage({ searchParams }: Props) {
  // ASSERTS ITS OWN ROLE. The layout also calls requireRole, but a layout and
  // its page render CONCURRENTLY in the App Router — the layout's redirect does
  // not stop this component's queries from being issued first. An anonymous
  // request therefore ran every read below as `anon`, was denied by the grants,
  // and only then got its 307. Nothing leaked, but the work was wasted and each
  // denial now logs at error level, which would bury real failures. Guarding
  // here also means this page is not relying on a file it does not control.
  await requireRole(["admin"]);
  const { filter } = await searchParams;
  const activeFilter = FILTERS.find((f) => f.key === filter) ?? FILTERS[0];

  const owners = await fetchAllOwners(activeFilter.value);

  return (
    <div>
      <AdminPageHeader
        title="Owners"
        description="Manage owner accounts and verify business details. Owners are active on registration — halls are approved separately."
      />

      <div className="px-4 py-4 sm:px-6 lg:px-8 space-y-5">

        {/* Filter */}
        <div>
          <h2 className="mb-3 font-serif text-sm font-semibold text-charcoal-900">All owner businesses</h2>
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <Link
                key={f.key}
                href={f.key === "all" ? "?" : `?filter=${f.key}`}
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
        </div>

        {/* Owners list */}
        {owners.length === 0 ? (
          <p className="rounded-2xl bg-white p-8 text-center text-sm text-charcoal-500 shadow-card">
            No owner businesses in this category.
          </p>
        ) : (
          <div className="space-y-2">
            {owners.map((o) => (
              <div key={o.id} className="rounded-2xl bg-white p-4 shadow-card">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-serif text-sm font-semibold text-charcoal-900 truncate">
                        {o.business_name}
                      </p>
                      {o.is_verified
                        ? <Badge variant="success" size="sm"><BadgeCheck className="h-3 w-3" /> Verified</Badge>
                        : <Badge variant="warning" size="sm">Unverified</Badge>
                      }
                    </div>
                    <p className="text-xs text-charcoal-500">
                      Owner: <strong className="text-charcoal-700">{o.full_name ?? "—"}</strong> · {o.email}
                    </p>
                    <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-charcoal-600 sm:grid-cols-4">
                      <Field label="GST" value={o.gst_number} />
                      <Field label="PAN" value={o.pan_number} />
                      <Field label="City" value={o.city} />
                      <Field label="UPI" value={o.payout_upi} />
                    </div>
                    <BankPayout accountNumber={o.payout_account_number} ifsc={o.payout_ifsc} />
                    <p className="mt-1 text-[10px] text-charcoal-400">Registered {fmtDate(o.created_at)}</p>
                  </div>

                  <div className="shrink-0 flex flex-col items-end gap-1">
                    {!o.is_verified && (
                      <ConfirmButton
                        action={verifyOwnerRow.bind(null, o.id)}
                        label="Verify business"
                        confirmText="Confirm verify"
                        variant="success"
                        hideOnSuccess
                        doneLabel="✓ Verified"
                      />
                    )}
                    <span className="text-[10px] font-semibold text-green-700">Active owner</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <span className="text-charcoal-400 mr-1">{label}:</span>
      <span className="font-medium">{value ?? "—"}</span>
    </div>
  );
}

/** Last four only, same rule the owner's own payout screen uses. */
function maskAccount(v: string | null): string {
  if (!v) return "—";
  return v.length <= 4 ? v : `${"•".repeat(Math.min(v.length - 4, 8))}${v.slice(-4)}`;
}

/**
 * Payout bank details — the account an admin actually types into their banking
 * app, because a manual transfer is the only payout route that works today.
 * Until this was here the number existed nowhere in the product and the admin
 * had to go to the database to pay anyone.
 *
 * Collapsed to the last four by default. This is a LIST: a whole screen of
 * legible account numbers is one screen-share, screenshot or over-the-shoulder
 * glance away from being somebody else's, and an admin needs exactly one of
 * them at a time. <details> keeps that per-owner and costs no client bundle.
 *
 * Being honest about what the mask is worth: the full value is in the HTML this
 * admin has already been served, so this defends against a visible screen, not
 * against the admin — who is authorised to see it. What keeps it off everyone
 * else's screen is the layout's requireRole(["admin"]) gate and the fact that
 * AdminOwnerRow is not rendered, logged or exported anywhere outside /admin.
 */
function BankPayout({ accountNumber, ifsc }: { accountNumber: string | null; ifsc: string | null }) {
  // BOTH are required to make a transfer, so a half-filled record is still
  // "cannot be paid". Testing for neither would show a reveal panel for an
  // account number with no IFSC and quietly imply it was payable.
  if (!accountNumber || !ifsc) {
    return (
      <p className="mt-2 text-[11px] text-charcoal-500">
        <span className="text-charcoal-400 mr-1">Bank:</span>
        <span className="font-medium">
          {!accountNumber && !ifsc
            ? "not provided"
            : !accountNumber
              ? "IFSC on file, account number missing"
              : "account number on file, IFSC missing"}
        </span>{" "}
        — this owner cannot be paid by transfer yet.
      </p>
    );
  }

  return (
    <details className="mt-2 rounded-lg border border-border bg-charcoal-50 px-2 py-1 text-[11px]">
      <summary className="flex cursor-pointer list-none items-center gap-1 text-charcoal-600 [&::-webkit-details-marker]:hidden">
        <span className="text-charcoal-400">Bank:</span>
        <span className="font-mono font-medium text-charcoal-800">{maskAccount(accountNumber)}</span>
        <span className="ml-1 font-semibold text-maroon-700 underline">reveal</span>
      </summary>
      <dl className="mt-1 space-y-0.5 border-t border-border pt-1">
        <div className="flex gap-2">
          <dt className="w-10 shrink-0 text-charcoal-400">A/C</dt>
          <dd className="font-mono font-medium text-charcoal-800 break-all">{accountNumber ?? "—"}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-10 shrink-0 text-charcoal-400">IFSC</dt>
          <dd className="font-mono font-medium text-charcoal-800">{ifsc ?? "—"}</dd>
        </div>
      </dl>
    </details>
  );
}

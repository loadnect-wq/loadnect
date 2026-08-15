import type { Metadata } from "next";
import Link from "next/link";
import { fetchAllUsers } from "@/lib/admin";
import { Badge } from "@/components/ui/Badge";
import { AdminPageHeader } from "../_components/AdminPageHeader";
import { ConfirmButton } from "../_components/ConfirmButton";
import { toggleUserActive } from "../actions";

export const metadata: Metadata = { title: "Users — Admin" };

const ROLE_FILTERS = [
  { key: "all",            label: "All",      value: undefined           },
  { key: "customer",       label: "Customers", value: "customer"          },
  { key: "owner_pending",  label: "Pending Owners", value: "owner_pending" },
  { key: "owner_approved", label: "Owners",   value: "owner_approved"    },
  { key: "admin",          label: "Admins",   value: "admin"             },
];

const ROLE_CFG: Record<string, { label: string; variant: "default" | "secondary" | "success" | "warning" | "destructive" | "gold" }> = {
  customer:       { label: "Customer",        variant: "secondary" },
  owner_pending:  { label: "Owner (pending)", variant: "warning"   },
  owner_approved: { label: "Owner",           variant: "success"   },
  admin:          { label: "Admin",           variant: "gold"      },
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

type Props = { searchParams: Promise<{ role?: string }> };

export default async function AdminUsersPage({ searchParams }: Props) {
  const { role } = await searchParams;
  const activeFilter = ROLE_FILTERS.find((f) => f.key === role) ?? ROLE_FILTERS[0];

  const users = await fetchAllUsers(activeFilter.value);

  return (
    <div>
      <AdminPageHeader
        title="Users"
        description={`${users.length} ${activeFilter.label.toLowerCase()} account${users.length !== 1 ? "s" : ""}`}
      />

      <div className="px-4 py-4 sm:px-6 lg:px-8 space-y-4">

        {/* Role filter chips */}
        <div className="flex flex-wrap gap-2">
          {ROLE_FILTERS.map((f) => (
            <Link
              key={f.key}
              href={f.key === "all" ? "?" : `?role=${f.key}`}
              className={[
                "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                activeFilter.key === f.key
                  ? "border-maroon-700 bg-maroon-700 text-white"
                  : "border-border bg-white text-charcoal-600 hover:border-maroon-300",
              ].join(" ")}
            >
              {f.label}
            </Link>
          ))}
        </div>

        {/* Users table — responsive cards on mobile, table on desktop */}
        {users.length === 0 ? (
          <p className="rounded-2xl bg-white p-8 text-center text-sm text-charcoal-500 shadow-card">
            No users in this category.
          </p>
        ) : (
          <>
            {/* Mobile card list */}
            <div className="space-y-2 lg:hidden">
              {users.map((u) => {
                const cfg = ROLE_CFG[u.role] ?? { label: u.role, variant: "secondary" as const };
                return (
                  <div key={u.id} className="rounded-2xl bg-white p-3 shadow-card">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-charcoal-900">
                          {u.full_name ?? "—"}
                        </p>
                        <p className="truncate text-[11px] text-charcoal-500">{u.email}</p>
                        <p className="mt-1 text-[10px] text-charcoal-400">Joined {fmtDate(u.created_at)}</p>
                      </div>
                      <div className="shrink-0 space-y-1 text-right">
                        <Badge variant={cfg.variant} size="sm">{cfg.label}</Badge>
                        {!u.is_active && <p className="text-[10px] font-semibold text-red-600">Deactivated</p>}
                      </div>
                    </div>
                    <div className="mt-2.5">
                      <ConfirmButton
                        action={toggleUserActive.bind(null, u.id, !u.is_active)}
                        label={u.is_active ? "Deactivate" : "Reactivate"}
                        confirmText="Click again"
                        variant={u.is_active ? "destructive" : "success"}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop table */}
            <div className="hidden overflow-hidden rounded-2xl bg-white shadow-card lg:block">
              <table className="min-w-full text-sm">
                <thead className="bg-ivory-50 border-b border-border">
                  <tr>
                    <Th>Name</Th>
                    <Th>Email</Th>
                    <Th>Phone</Th>
                    <Th>Role</Th>
                    <Th>Status</Th>
                    <Th>Joined</Th>
                    <Th align="right">Action</Th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => {
                    const cfg = ROLE_CFG[u.role] ?? { label: u.role, variant: "secondary" as const };
                    return (
                      <tr key={u.id} className="border-b border-border last:border-b-0 hover:bg-ivory-50/50">
                        <Td>{u.full_name ?? <span className="text-charcoal-400">—</span>}</Td>
                        <Td>{u.email ?? "—"}</Td>
                        <Td>{u.phone ?? "—"}</Td>
                        <Td><Badge variant={cfg.variant} size="sm">{cfg.label}</Badge></Td>
                        <Td>
                          {u.is_active
                            ? <span className="text-[11px] font-semibold text-green-700">Active</span>
                            : <span className="text-[11px] font-semibold text-red-600">Deactivated</span>
                          }
                        </Td>
                        <Td className="text-charcoal-500">{fmtDate(u.created_at)}</Td>
                        <Td align="right">
                          <ConfirmButton
                            action={toggleUserActive.bind(null, u.id, !u.is_active)}
                            label={u.is_active ? "Deactivate" : "Reactivate"}
                            confirmText="Click again"
                            variant={u.is_active ? "destructive" : "success"}
                          />
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th className={`px-4 py-2.5 text-[11px] font-bold uppercase tracking-wide text-charcoal-500 ${align === "right" ? "text-right" : "text-left"}`}>
      {children}
    </th>
  );
}

function Td({
  children, className = "", align = "left",
}: {
  children: React.ReactNode;
  className?: string;
  align?: "left" | "right";
}) {
  return (
    <td className={`px-4 py-3 ${align === "right" ? "text-right" : ""} ${className}`}>
      {children}
    </td>
  );
}

"use client";

import { useTransition } from "react";
import { markContactMessageRead } from "@/app/admin/actions";
import { toast } from "@/hooks/use-toast";

export function MarkContactReadButton({ messageId }: { messageId: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await markContactMessageRead(messageId);
          if ("error" in r) toast({ title: "Could not mark as read", description: r.error, variant: "destructive" });
        })
      }
      className="shrink-0 rounded-lg border border-maroon-300 px-2.5 py-1 text-[11px] font-semibold text-maroon-700 hover:bg-maroon-100 disabled:opacity-60"
    >
      {pending ? "…" : "Mark read"}
    </button>
  );
}

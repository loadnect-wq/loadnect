"use client";

// Who is in the plan, and the invite link. The owner turns the link on and
// off, lets a member edit or not, and removes people; a member can leave.
// Everyone joins able to view and vote, so a link forwarded further than
// meant gives away the plan's contents but never the right to change it.

import { useState, useTransition } from "react";
import { Link2Off, UserPlus } from "lucide-react";
import { ShareButtons } from "@/components/share/ShareButtons";
import {
  createInviteAction,
  leavePlanAction,
  removeMemberAction,
  setMemberRoleAction,
  turnOffInviteAction,
} from "@/app/plan/family-actions";
import { MAX_MEMBERS, ROLE_LABEL, invitePath, personName, type PlanRole } from "@/lib/plan";

export type FamilyPerson = { userId: string; name: string | null; role: PlanRole };

function initials(name: string | null): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  return (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : "")).toUpperCase();
}

export function PlanFamily({
  planId,
  planTitle,
  me,
  myRole,
  people,
  inviteToken,
}: {
  planId: string;
  planTitle: string;
  me: string;
  myRole: PlanRole;
  /** Null when the list could not be read. */
  people: FamilyPerson[] | null;
  /** The live invite token; the owner's only. */
  inviteToken: string | null;
}) {
  const [token, setToken] = useState(inviteToken);
  const [armed, setArmed] = useState<string | null>(null); // a userId, for remove or leave
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const isOwner = myRole === "owner";
  const members = people ? people.length - 1 : 0;

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError("");
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Something went wrong. Please try again.");
      setArmed(null);
    });
  };

  const person = (p: FamilyPerson) => {
    const you = p.userId === me;
    const canManage = isOwner && p.role !== "owner";
    const isArmed = armed === p.userId;
    return (
      <li key={p.userId} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5">
        <span
          aria-hidden
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-maroon-50 text-xs font-bold text-maroon-800"
        >
          {initials(p.name)}
        </span>
        {/* A minimum width, so on a phone the buttons wrap below the name
            instead of squeezing it to a few letters. */}
        <span className="min-w-[10rem] flex-1">
          <span className="flex min-w-0 text-sm font-semibold text-charcoal-900">
            <span className="truncate">{personName(p.name)}</span>
            {you && <span className="shrink-0">&nbsp;(you)</span>}
          </span>
          <span className="block text-xs text-charcoal-600">{ROLE_LABEL[p.role]}</span>
        </span>
        {canManage && !isArmed && (
          <span className="ml-auto flex gap-1.5">
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => setMemberRoleAction(planId, p.userId, p.role === "editor" ? "viewer" : "editor"))}
              className="min-h-[40px] rounded-lg border border-border px-2.5 text-xs font-semibold text-charcoal-800 hover:bg-ivory-100 disabled:opacity-50"
            >
              {p.role === "editor" ? "View only" : "Let them edit"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setArmed(p.userId)}
              aria-label={`Remove ${personName(p.name)} from the plan`}
              className="min-h-[40px] rounded-lg px-2.5 text-xs font-semibold text-charcoal-600 hover:bg-ivory-100 disabled:opacity-50"
            >
              Remove
            </button>
          </span>
        )}
        {you && p.role !== "owner" && !isArmed && (
          <button
            type="button"
            disabled={pending}
            onClick={() => setArmed(p.userId)}
            className="ml-auto min-h-[40px] rounded-lg border border-border px-2.5 text-xs font-semibold text-charcoal-800 hover:bg-ivory-100 disabled:opacity-50"
          >
            Leave the plan
          </button>
        )}
        {isArmed && (
          <span className="ml-auto flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => (you ? leavePlanAction(planId) : removeMemberAction(planId, p.userId)))}
              className="min-h-[40px] rounded-lg bg-red-700 px-3 text-xs font-semibold text-white hover:bg-red-800 disabled:opacity-50"
            >
              {you ? "Tap to leave" : "Tap to remove"}
            </button>
            <button type="button" onClick={() => setArmed(null)} className="min-h-[40px] px-2 text-xs text-charcoal-600 hover:underline">
              Cancel
            </button>
          </span>
        )}
      </li>
    );
  };

  return (
    <section id="family" aria-labelledby="family-heading" className="scroll-mt-24 rounded-2xl bg-white p-4 shadow-card ring-1 ring-border">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="family-heading" className="text-base font-bold text-charcoal-900">Family</h2>
        {people && (
          <span className="text-xs font-semibold text-charcoal-600">
            {people.length === 1 ? "Just you so far" : `${people.length} people`}
          </span>
        )}
      </div>

      {people === null ? (
        <p className="mt-2 text-sm text-charcoal-700">We couldn&apos;t load who is in this plan. Please try again in a minute.</p>
      ) : (
        <ul className="mt-1 divide-y divide-border">{people.map(person)}</ul>
      )}

      {!isOwner && (
        <p className="mt-2 text-xs text-charcoal-600">
          {myRole === "editor"
            ? "You can change this plan. Only the person who started it can invite people or delete it."
            : "You can see this plan and vote on the options. The person who started it can let you edit."}
        </p>
      )}

      {isOwner && (
        <div className="mt-3 border-t border-border pt-3">
          {token ? (
            <>
              <p className="text-sm font-semibold text-charcoal-900">Invite the family</p>
              <p className="mt-0.5 text-xs text-charcoal-600">
                Anyone with this link can join and see the whole plan, including the budget. They join able to view and
                vote; you choose who can edit.
              </p>
              <div className="mt-3">
                <ShareButtons
                  path={invitePath(token)}
                  text={`Join our plan for ${planTitle} on Hallnect, to see how it is going and vote on the options:`}
                  label="Send on WhatsApp"
                />
              </div>
              <button
                type="button"
                disabled={pending}
                onClick={() => run(async () => {
                  const res = await turnOffInviteAction(planId);
                  if (res.ok) setToken(null);
                  return res;
                })}
                className="mt-2 inline-flex min-h-[40px] items-center gap-1.5 text-sm font-semibold text-charcoal-700 hover:underline disabled:opacity-50"
              >
                <Link2Off className="h-4 w-4" aria-hidden /> Turn off the link
              </button>
              <p className="text-xs text-charcoal-600">People who already joined stay until you remove them.</p>
            </>
          ) : members >= MAX_MEMBERS ? (
            <p className="text-sm text-charcoal-700">This plan has as many people as it can hold.</p>
          ) : (
            <>
              <p className="text-sm text-charcoal-700">
                Plan it together: send the family a link to see the plan and vote on the options.
              </p>
              <button
                type="button"
                disabled={pending}
                onClick={() => run(async () => {
                  const res = await createInviteAction(planId);
                  if (res.ok) setToken(res.token);
                  return res;
                })}
                className="mt-2 inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-maroon-700 px-4 text-sm font-semibold text-white hover:bg-maroon-800 disabled:opacity-60"
              >
                <UserPlus className="h-4 w-4" aria-hidden /> Invite family
              </button>
            </>
          )}
        </div>
      )}

      {error && <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
    </section>
  );
}

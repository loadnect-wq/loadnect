"use client";

// The plan's checklist. Template tasks fall due a number of days before the
// function, so they move with the date; tasks the family adds keep their own
// date. Open tasks come first, soonest due; done ones fold away.

import { useMemo, useState, useTransition } from "react";
import { Check, Plus, X } from "lucide-react";
import { formatDiaryDay } from "@/lib/diary";
import { categoryLabel, daysUntil, offsetLabel, taskDueDate } from "@/lib/plan";
import type { PlanTask } from "@/lib/plan.server";
import { addTaskAction, deleteTaskAction, setTaskDoneAction } from "@/app/plan/actions";

const SHOWN = 6;

export function Checklist({
  planId,
  tasks,
  eventDate,
  today,
  readOnly = false,
}: {
  planId: string;
  tasks: PlanTask[];
  eventDate: string | null;
  today: string;
  /** A member who can only view: the list, without ticks, adding or removing. */
  readOnly?: boolean;
}) {
  // Local overrides for instant ticks; the server's answer replaces them on refresh.
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [showAll, setShowAll] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  const rows = useMemo(() => {
    const withDue = tasks.map((t) => ({ ...t, due: taskDueDate(t, eventDate), isDone: done[t.id] ?? Boolean(t.doneAt) }));
    const open = withDue
      .filter((t) => !t.isDone)
      .sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999") || (b.offsetDays ?? -1) - (a.offsetDays ?? -1) || a.sortOrder - b.sortOrder);
    const closed = withDue.filter((t) => t.isDone);
    return { open, closed };
  }, [tasks, eventDate, done]);

  const toggle = (id: string, next: boolean) => {
    setDone((d) => ({ ...d, [id]: next }));
    start(async () => {
      const res = await setTaskDoneAction(planId, id, next);
      if (!res.ok) {
        setDone((d) => ({ ...d, [id]: !next }));
        setError(res.error);
      }
    });
  };

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setError("");
    start(async () => {
      const res = await addTaskAction({ planId, title, dueDate: due });
      if (res.ok) {
        setTitle("");
        setDue("");
      } else setError(res.error);
    });
  };

  const remove = (id: string) =>
    start(async () => {
      const res = await deleteTaskAction(planId, id);
      if (!res.ok) setError(res.error);
    });

  const dueText = (t: (typeof rows.open)[number]) => {
    if (t.due) {
      const n = daysUntil(t.due, today);
      // The year only when it is not this year: a wedding's tasks often span two.
      const when = formatDiaryDay("en", t.due, { year: t.due.slice(0, 4) !== today.slice(0, 4) });
      if (t.isDone) return when;
      if (n < 0) return `${when} · overdue`;
      if (n === 0) return `${when} · today`;
      return when;
    }
    if (t.offsetDays != null) return offsetLabel(t.offsetDays);
    return null;
  };

  const openShown = showAll ? rows.open : rows.open.slice(0, SHOWN);
  const total = tasks.length;

  const row = (t: (typeof rows.open)[number]) => {
    const text = dueText(t);
    const overdue = !t.isDone && t.due != null && daysUntil(t.due, today) < 0;
    return (
      <li key={t.id} className="flex items-start gap-3 py-2.5">
        <button
          type="button"
          role="checkbox"
          aria-checked={t.isDone}
          aria-label={readOnly ? t.title : t.isDone ? `Mark "${t.title}" as not done` : `Mark "${t.title}" as done`}
          disabled={readOnly}
          onClick={() => toggle(t.id, !t.isDone)}
          className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${
            t.isDone ? "border-green-700 bg-green-700 text-white" : "border-charcoal-400 bg-white"
          }`}
        >
          {t.isDone && <Check className="h-4 w-4" aria-hidden />}
        </button>
        <div className="min-w-0 flex-1">
          <p className={`text-sm ${t.isDone ? "text-charcoal-500 line-through" : "text-charcoal-900"}`}>{t.title}</p>
          <p className={`text-xs ${overdue ? "font-semibold text-amber-800" : "text-charcoal-600"}`}>
            {[text, t.category ? categoryLabel(t.category) : null].filter(Boolean).join(" · ")}
          </p>
        </div>
        {!readOnly && (
          <button
            type="button"
            onClick={() => remove(t.id)}
            aria-label={`Remove "${t.title}"`}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-charcoal-400 hover:bg-ivory-100 hover:text-charcoal-700"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        )}
      </li>
    );
  };

  return (
    <section aria-labelledby="checklist-heading" className="rounded-2xl bg-white p-4 shadow-card ring-1 ring-border">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="checklist-heading" className="text-base font-bold text-charcoal-900">Checklist</h2>
        <span className="text-xs font-semibold text-charcoal-600">{rows.closed.length} of {total} done</span>
      </div>
      {!eventDate && (
        <p className="mt-1 text-xs text-charcoal-600">Add the date to the plan and every task gets its own due date.</p>
      )}

      {rows.open.length === 0 ? (
        <p className="mt-3 text-sm text-charcoal-700">Nothing left on the list.</p>
      ) : (
        <ul className="mt-1 divide-y divide-border">
          {openShown.map(row)}
        </ul>
      )}
      {rows.open.length > SHOWN && (
        <button type="button" onClick={() => setShowAll((s) => !s)} className="mt-1 min-h-[40px] text-sm font-semibold text-maroon-700 hover:underline">
          {showAll ? "Show fewer" : `Show all ${rows.open.length} open tasks`}
        </button>
      )}

      {!readOnly && <form onSubmit={add} className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
        <label htmlFor="new-task" className="sr-only">New task</label>
        <input
          id="new-task"
          value={title}
          maxLength={140}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add a task"
          className="min-h-[44px] min-w-0 flex-1 rounded-xl border border-border px-3 text-sm"
        />
        <label htmlFor="new-task-date" className="sr-only">Due date (optional)</label>
        <input id="new-task-date" type="date" value={due} onChange={(e) => setDue(e.target.value)} className="min-h-[44px] w-[9.5rem] rounded-xl border border-border px-2 text-sm" />
        <button
          type="submit"
          disabled={pending || !title.trim()}
          className="inline-flex min-h-[44px] items-center gap-1 rounded-xl bg-maroon-700 px-4 text-sm font-semibold text-white hover:bg-maroon-800 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" aria-hidden /> Add
        </button>
      </form>}
      {error && <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}

      {rows.closed.length > 0 && (
        <div className="mt-3 border-t border-border pt-2">
          <button type="button" onClick={() => setShowDone((s) => !s)} className="min-h-[40px] text-sm font-semibold text-charcoal-700 hover:underline">
            {showDone ? "Hide done tasks" : `Done (${rows.closed.length})`}
          </button>
          {showDone && <ul className="divide-y divide-border">{rows.closed.map(row)}</ul>}
        </div>
      )}
    </section>
  );
}

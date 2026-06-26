"use client";

import { useEffect, useState } from "react";

// ─── Types ──────────────────────────────────────────────────────────────────

export type ToastVariant = "default" | "success" | "destructive" | "gold";

export interface ToastData {
  id: string;
  title?: string;
  description?: string;
  variant?: ToastVariant;
  duration?: number;
  open: boolean;
}

export type ToastInput = Omit<ToastData, "id" | "open">;

// ─── Micro event-bus (no React Context needed) ───────────────────────────────

type Listener = (toasts: ToastData[]) => void;
const listeners: Listener[] = [];
let state: ToastData[] = [];

function setState(next: ToastData[]) {
  state = next;
  listeners.forEach((fn) => fn(state));
}

let idCounter = 0;
const REMOVE_DELAY = 5_200;
const MAX_TOASTS   = 3;

// ─── Public API ──────────────────────────────────────────────────────────────

export function toast(input: ToastInput) {
  const id = String(++idCounter);
  const entry: ToastData = { ...input, id, open: true };

  setState([entry, ...state].slice(0, MAX_TOASTS));

  const duration = input.duration ?? REMOVE_DELAY;
  setTimeout(() => dismiss(id), duration);

  return { id };
}

export function dismiss(id: string) {
  // First mark as closed (triggers animation), then remove
  setState(state.map((t) => (t.id === id ? { ...t, open: false } : t)));
  setTimeout(() => {
    setState(state.filter((t) => t.id !== id));
  }, 300);
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useToast() {
  const [toasts, setToasts] = useState<ToastData[]>(state);

  useEffect(() => {
    listeners.push(setToasts);
    return () => {
      const idx = listeners.indexOf(setToasts);
      if (idx !== -1) listeners.splice(idx, 1);
    };
  }, []);

  return { toasts, toast, dismiss };
}

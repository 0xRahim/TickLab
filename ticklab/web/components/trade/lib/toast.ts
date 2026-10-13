"use client";

import { create } from "zustand";

export interface Toast {
  id: string;
  kind: "ok" | "err" | "info";
  message: string;
}

interface ToastState {
  toasts: Toast[];
  push: (kind: Toast["kind"], message: string) => void;
  dismiss: (id: string) => void;
}

export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push: (kind, message) => {
    const id = crypto.randomUUID();
    set((s) => ({ toasts: [...s.toasts.slice(-4), { id, kind, message }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 4200);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export function toastOk(message: string): void {
  useToasts.getState().push("ok", message);
}

export function toastErr(message: string): void {
  useToasts.getState().push("err", message);
}

export function toastInfo(message: string): void {
  useToasts.getState().push("info", message);
}

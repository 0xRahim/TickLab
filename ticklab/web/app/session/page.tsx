"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import SessionTerminal from "@/components/trade/SessionTerminal";
import { getSession, type BacktestSession } from "@/components/trade/services/session-api";

function SessionView() {
  const params = useSearchParams();
  const id = params.get("id");
  const [session, setSession] = useState<BacktestSession | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let live = true;
    getSession(id)
      .then((s) => {
        if (!live) return;
        if (s.status !== "ready" && s.status !== "partial") {
          setError(`Session is ${s.status} — sealing must finish before replay.`);
          return;
        }
        setSession(s);
      })
      .catch((e) => {
        if (live) setError(e instanceof Error ? e.message : "Failed to load session.");
      });
    return () => {
      live = false;
    };
  }, [id]);

  if (!id) {
    return (
      <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col items-start justify-center gap-3 px-6">
        <p className="text-sm text-down">Missing session id.</p>
        <Link href="/" className="text-sm text-accent hover:underline">
          ← Back to sessions
        </Link>
      </div>
    );
  }
  if (error) {
    return (
      <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col items-start justify-center gap-3 px-6">
        <p className="text-sm text-down">{error}</p>
        <Link href="/" className="text-sm text-accent hover:underline">
          ← Back to sessions
        </Link>
      </div>
    );
  }
  if (!session) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted">Loading sealed session…</p>
      </div>
    );
  }
  return <SessionTerminal session={session} />;
}

export default function SessionPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <p className="text-sm text-muted">Loading…</p>
        </div>
      }
    >
      <SessionView />
    </Suspense>
  );
}

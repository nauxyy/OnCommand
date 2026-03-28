"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { hasSupabaseEnv } from "@/lib/env";
import type { DepartmentRole } from "@/lib/types";

const ROLES: DepartmentRole[] = ["lighting", "sound", "stage_left", "stage_right", "stage_manager"];

export function AnonymousAuthGate() {
  const router = useRouter();
  const [isAuthed, setIsAuthed] = useState(!hasSupabaseEnv());
  const [isCheckingSession, setIsCheckingSession] = useState(hasSupabaseEnv());
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string>("");
  const [role, setRole] = useState<DepartmentRole>("lighting");
  const [showId, setShowId] = useState(hasSupabaseEnv() ? "" : "demo-show");

  const disabled = useMemo(() => !showId.trim(), [showId]);

  useEffect(() => {
    if (!hasSupabaseEnv()) return;

    const supabase = createSupabaseBrowserClient();
    const timeout = window.setTimeout(() => {
      setIsCheckingSession(false);
    }, 4000);

    supabase.auth
      .getSession()
      .then(({ data }) => {
        setIsAuthed(Boolean(data.session));
      })
      .finally(() => {
        window.clearTimeout(timeout);
        setIsCheckingSession(false);
      });
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsAuthed(Boolean(session));
      if (session) {
        setSignInError(null);
        setStatusText("Signed in. Preparing live session…");
      }
      setIsCheckingSession(false);
    });

    return () => {
      window.clearTimeout(timeout);
      authListener.subscription.unsubscribe();
    };
  }, []);

  const signIn = async () => {
    setIsSigningIn(true);
    setSignInError(null);
    setStatusText("Contacting auth service…");
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInAnonymously();
    if (!error) {
      setIsAuthed(true);
      setStatusText("Signed in. Open your shows workspace to create or edit a production.");
      setIsSigningIn(false);
      return;
    }

    setSignInError(error.message || "Anonymous sign-in failed.");
    setStatusText("");
    setIsSigningIn(false);
  };

  const start = async () => {
    const entered = showId.trim();
    if (!entered) return;
    setJoinError(null);

    if (/^[a-z0-9]{5}$/i.test(entered)) {
      try {
        const normalized = entered.toUpperCase();
        const response = await fetch(`/api/live/resolve-code/${encodeURIComponent(normalized)}`, { cache: "no-store" });
        if (!response.ok) {
          setJoinError("Live code not found. Ask the director for the latest 5-character code.");
          return;
        }
        const payload = (await response.json()) as { showId?: string };
        if (!payload.showId) {
          setJoinError("Live code lookup failed. Please try again.");
          return;
        }
        router.push(`/shows/${encodeURIComponent(payload.showId)}/crew?role=${role}`);
        return;
      } catch (error) {
        console.error("[AnonymousAuthGate] code resolve failed:", error);
        setJoinError("Could not resolve live code right now.");
        return;
      }
    }

    router.push(`/shows/${encodeURIComponent(entered)}/crew?role=${role}`);
  };

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-6 rounded-2xl border border-zinc-800 bg-zinc-900 p-6 text-white shadow-lg">
      <div className="space-y-2">
        <h2 className="text-2xl font-semibold text-white">Workspace access</h2>
        <p className="text-sm text-zinc-300">
          Sign in, open the shows workspace, create a production, and then join director or crew live mode from a saved show.
        </p>
      </div>
      {!hasSupabaseEnv() ? (
        <p className="rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-900">
          Running in demo mode. Add Supabase keys in `.env.local` to enable anonymous auth + database.
        </p>
      ) : null}

      {!isAuthed ? (
        <div className="space-y-3">
          <button
            onClick={signIn}
            disabled={isSigningIn}
            className="rounded-md bg-sky-300 px-4 py-2 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:bg-sky-200"
          >
            {isCheckingSession ? "Checking session…" : isSigningIn ? "Signing in…" : "Sign in anonymously"}
          </button>
          {statusText ? <p className="text-xs text-zinc-300">{statusText}</p> : null}
          {signInError ? (
            <div className="rounded-md border border-rose-700 bg-rose-950/30 px-3 py-2">
              <p className="text-xs text-rose-200">{signInError}</p>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={signIn}
                  disabled={isSigningIn}
                  className="rounded-md border border-rose-500 bg-rose-900/40 px-3 py-1.5 text-xs font-semibold text-rose-100 disabled:opacity-60"
                >
                  Retry sign-in
                </button>
                <button
                  onClick={() => router.refresh()}
                  className="rounded-md border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-100"
                >
                  Refresh page
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <Link href="/shows" className="rounded-md bg-sky-300 px-4 py-2 text-sm font-semibold text-black">
              Open Shows Workspace
            </Link>
            {!hasSupabaseEnv() ? (
              <Link href="/shows/demo-show/edit" className="rounded-md border border-zinc-600 bg-zinc-800 px-4 py-2 text-sm font-semibold text-zinc-100">
                Open Demo Editor
              </Link>
            ) : null}
          </div>

          <label className="flex flex-col gap-2 text-sm">
            Quick join show ID
            <input
              value={showId}
              onChange={(e) => setShowId(e.target.value)}
              placeholder={hasSupabaseEnv() ? "Enter 5-character code or show ID" : "demo-show"}
              className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-white"
            />
          </label>

          <label className="flex flex-col gap-2 text-sm">
            Role
            <select value={role} onChange={(e) => setRole(e.target.value as DepartmentRole)} className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-white">
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>

          <button
            onClick={() => {
              void start();
            }}
            disabled={disabled}
            className="rounded-md bg-emerald-300 px-4 py-2 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:bg-emerald-200"
          >
            Join live session
          </button>
          {joinError ? <p className="text-xs text-rose-300">{joinError}</p> : null}
        </>
      )}
    </section>
  );
}

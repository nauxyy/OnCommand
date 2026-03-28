"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { hasSupabaseEnv } from "@/lib/env";
import type { DepartmentRole } from "@/lib/types";

const ROLES: DepartmentRole[] = ["director", "lighting", "sound", "stage_left", "stage_right", "stage_crew"];

export function AnonymousAuthGate() {
  const router = useRouter();
  const [isAuthed, setIsAuthed] = useState(!hasSupabaseEnv());
  const [isCheckingSession, setIsCheckingSession] = useState(hasSupabaseEnv());
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string>("");
  const [role, setRole] = useState<DepartmentRole>("director");
  const [showId, setShowId] = useState("demo-show");
  const [title, setTitle] = useState("Tonight Performance");

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
      setStatusText("Signed in. Preparing live session…");
      setIsSigningIn(false);
      return;
    }

    setSignInError(error.message || "Anonymous sign-in failed.");
    setStatusText("");
    setIsSigningIn(false);
  };

  const start = () => {
    if (role === "director") {
      router.push(`/shows/${encodeURIComponent(showId)}/live?role=director&title=${encodeURIComponent(title)}`);
      return;
    }
    router.push(`/shows/${encodeURIComponent(showId)}/crew?role=${role}`);
  };

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-6 rounded-2xl border border-zinc-800 bg-zinc-900 p-6 text-white shadow-lg">
      <h2 className="text-2xl font-semibold text-white">Start Session</h2>
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
          <label className="flex flex-col gap-2 text-sm">
            Show title
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-white"
            />
          </label>

          <label className="flex flex-col gap-2 text-sm">
            Show ID
            <input
              value={showId}
              onChange={(e) => setShowId(e.target.value)}
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
            onClick={start}
            disabled={disabled}
            className="rounded-md bg-emerald-300 px-4 py-2 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:bg-emerald-200"
          >
            Enter live mode
          </button>
        </>
      )}
    </section>
  );
}

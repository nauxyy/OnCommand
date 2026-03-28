import Link from "next/link";
import { AnonymousAuthGate } from "@/components/auth/anonymous-auth-gate";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-slate-950 px-4 py-10 text-white">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
        <header className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 shadow-lg">
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-300">OnCommand</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight text-white">Real-time show calling for live theatre</h1>
          <p className="mt-3 max-w-3xl text-zinc-200">
            Centralized script tracking, cue timing, and technician coordination in live execution mode. Director and crew stay synchronized from one shared timeline.
          </p>
          <div className="mt-4 flex flex-wrap gap-3 text-sm">
            <Link href="/shows/demo-show/edit" className="rounded-md bg-sky-300 px-3 py-2 font-semibold text-black">
              Open Cue Editor
            </Link>
            <Link href="/shows/demo-show/live?role=director" className="rounded-md bg-emerald-300 px-3 py-2 font-semibold text-black">
              Open Director Live View
            </Link>
            <Link href="/shows/demo-show/crew?role=lighting" className="rounded-md bg-amber-300 px-3 py-2 font-semibold text-black">
              Open Crew View
            </Link>
          </div>
        </header>

        <AnonymousAuthGate />
      </div>
    </main>
  );
}

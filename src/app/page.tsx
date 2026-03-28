import Link from "next/link";
import { AnonymousAuthGate } from "@/components/auth/anonymous-auth-gate";

export default function HomePage() {
  return (
    <main className="h-dvh overflow-y-auto bg-slate-950 px-4 py-10 text-white">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
        <Link href="/" className="mb-4 block text-2xl font-bold tracking-wide text-zinc-200 hover:text-white">
          OnCommand
        </Link>
        <header className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 shadow-lg">
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-300">OnCommand</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight text-white">Create, edit, and run live theatre cues from one shared workspace</h1>
          <p className="mt-3 max-w-3xl text-zinc-200">
            Build a show from pasted script text, refine acts/scenes/lines in the precise cue editor, and drive director and crew live views from the latest saved timeline.
          </p>
          <div className="mt-6 grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-4">
              <p className="text-xs uppercase tracking-wide text-zinc-400">1. Create</p>
              <p className="mt-2 text-lg font-semibold text-white">Start a show from pasted script text</p>
              <p className="mt-2 text-sm text-zinc-300">Use the shows workspace to create productions and preview the import structure before you save.</p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-4">
              <p className="text-xs uppercase tracking-wide text-zinc-400">2. Edit</p>
              <p className="mt-2 text-lg font-semibold text-white">Place department cues between exact words</p>
              <p className="mt-2 text-sm text-zinc-300">Reorder acts, scenes, and lines, then drag cue chips into precise word gaps and edit their timing metadata.</p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-4">
              <p className="text-xs uppercase tracking-wide text-zinc-400">3. Run</p>
              <p className="mt-2 text-lg font-semibold text-white">Launch live director and crew views</p>
              <p className="mt-2 text-sm text-zinc-300">Live mode reads the latest saved script and cue document instead of the old sample-only planning view.</p>
            </div>
          </div>
          <div className="mt-6 flex flex-wrap gap-3 text-sm">
            <Link href="/shows" className="rounded-md bg-sky-300 px-3 py-2 font-semibold text-black">
              Open Shows Workspace
            </Link>
            <Link href="/shows/demo-show/edit" className="rounded-md bg-zinc-100 px-3 py-2 font-semibold text-black">
              Open Demo Editor
            </Link>
            <Link href="/shows/demo-show/live?role=director" className="rounded-md bg-emerald-300 px-3 py-2 font-semibold text-black">
              Open Demo Live View
            </Link>
          </div>
        </header>

        <AnonymousAuthGate />
      </div>
    </main>
  );
}

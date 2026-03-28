import Link from "next/link";
import { getShowTitle } from "@/lib/data/shows";

export default async function ShowHubPage(props: { params: Promise<{ showId: string }> }) {
  const { showId } = await props.params;
  const showTitle = await getShowTitle(showId);

  return (
    <main className="min-h-screen bg-slate-950 p-6 text-white">
      <Link href="/" className="mb-4 block text-2xl font-bold tracking-wide text-zinc-200 hover:text-white">
        OnCommand
      </Link>
      <div className="mx-auto max-w-4xl space-y-4">
        <Link href="/shows" className="inline-block rounded border border-zinc-700 bg-zinc-900 px-3 py-1 text-sm text-zinc-100">
          ← Back to Shows
        </Link>

        <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 shadow-lg">
          <p className="text-xs uppercase tracking-wide text-zinc-400">Show</p>
          <h1 className="mt-1 text-2xl font-semibold text-white">{showTitle}</h1>
          <p className="mt-1 text-xs text-zinc-400">{showId}</p>

          <div className="mt-5 flex flex-wrap gap-2 text-sm">
            <Link href={`/shows/${showId}/edit`} className="rounded border border-zinc-600 bg-zinc-800 px-3 py-2 text-zinc-100">
              Edit Show
            </Link>
            <Link href={`/shows/${showId}/live?role=director`} className="rounded bg-sky-600 px-3 py-2 font-semibold text-white">
              Live Director
            </Link>
            <Link href={`/shows/${showId}/crew?role=lighting`} className="rounded border border-zinc-600 bg-zinc-800 px-3 py-2 text-zinc-100">
              Crew View
            </Link>
            <Link href={`/shows/${showId}/delete`} className="rounded border border-rose-700 bg-rose-950/50 px-3 py-2 text-rose-100">
              Delete Show
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}

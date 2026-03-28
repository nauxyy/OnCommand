import Link from "next/link";
import { ShowCreateForm } from "@/components/show/show-create-form";
import { listShowsForCurrentUser } from "@/lib/data/shows";

export default async function ShowsPage() {
  const shows = await listShowsForCurrentUser();

  return (
    <main className="min-h-dvh flex-1 bg-slate-950 p-6 pb-24 text-white">
      <div className="mx-auto max-w-6xl space-y-4 pb-16">
        <Link href="/" className="inline-block text-2xl font-bold tracking-wide text-zinc-200 hover:text-white">
          OnCommand
        </Link>
        <h1 className="text-2xl font-semibold text-white">Your Shows</h1>
        <ShowCreateForm />
        <div className="mb-8 space-y-3">
          {shows.map((show) => (
            <div key={show.id} className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900 p-4 shadow-lg">
              <div>
                <p className="font-medium text-white">{show.title}</p>
                <p className="text-xs text-zinc-400">Created: {new Date(show.createdAt).toLocaleString()}</p>
                {show.updatedAt ? <p className="text-xs text-zinc-500">Updated: {new Date(show.updatedAt).toLocaleString()}</p> : null}
              </div>
              <div className="flex gap-2 text-sm">
                <Link className="rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-zinc-100" href={`/shows/${show.id}/edit`}>
                  Edit
                </Link>
                <Link className="rounded bg-emerald-300 px-2 py-1 font-semibold text-black" href={`/shows/${show.id}/live?role=director`}>
                  Live
                </Link>
                <Link className="rounded border border-rose-700 bg-rose-950/50 px-2 py-1 text-rose-100" href={`/shows/${show.id}/delete`}>
                  Delete
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}

import Link from "next/link";
import { listShowsForCurrentUser } from "@/lib/data/shows";

export default async function ShowsPage() {
  const shows = await listShowsForCurrentUser();

  return (
    <main className="min-h-screen bg-slate-950 p-6 text-white">
      <div className="mx-auto max-w-4xl space-y-4">
        <h1 className="text-2xl font-semibold text-white">Your Shows</h1>
        <div className="space-y-3">
          {shows.map((show) => (
            <div key={show.id} className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900 p-4 shadow-lg">
              <div>
                <p className="font-medium text-white">{show.title}</p>
                <p className="text-xs text-zinc-400">{new Date(show.createdAt).toLocaleString()}</p>
              </div>
              <div className="flex gap-2 text-sm">
                <Link className="rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-zinc-100" href={`/shows/${show.id}/edit`}>
                  Edit
                </Link>
                <Link className="rounded bg-emerald-300 px-2 py-1 font-semibold text-black" href={`/shows/${show.id}/live?role=director`}>
                  Live
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}

import Link from "next/link";
import { DirectorLiveShell } from "@/components/live/live-shell";
import { getScriptAndCues, getShowTitle } from "@/lib/data/shows";
import { upsertLiveDocument } from "@/lib/live/server-bus";

export default async function LiveDirectorPage(props: { params: Promise<{ showId: string }> }) {
  const { showId } = await props.params;
  const { script, cues } = await getScriptAndCues(showId);
  const showTitle = await getShowTitle(showId);
  upsertLiveDocument(showId, { script, cues, showName: showTitle });

  if (!script.length) {
    return (
      <main className="min-h-screen bg-slate-950 p-6 text-white">
        <div className="mx-auto max-w-3xl rounded-xl border border-zinc-800 bg-zinc-900 p-6 shadow-lg">
          <p className="text-xs uppercase tracking-wide text-zinc-400">Live mode unavailable</p>
          <h1 className="mt-2 text-2xl font-semibold text-white">{showTitle}</h1>
          <p className="mt-2 text-sm text-zinc-300">
            This show does not have any saved script lines yet. Build the show in the editor, save it, then return to live mode.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href={`/shows/${showId}/edit`} className="rounded-lg bg-sky-600 px-3 py-2 font-semibold text-white">
              Open editor
            </Link>
            <Link href={`/shows/${showId}`} className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100">
              Back to show hub
            </Link>
            <Link href="/" className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100">
              Home
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return <DirectorLiveShell showId={showId} showName={showTitle} lines={script} cues={cues} />;
}

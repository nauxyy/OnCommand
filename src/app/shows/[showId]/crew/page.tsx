import Link from "next/link";
import { CrewLiveShell } from "@/components/live/live-shell";
import { getScriptAndCues, getShowTitle } from "@/lib/data/shows";
import { getLiveDocument, resolveShowIdFromLiveAccessCode } from "@/lib/live/server-bus";
import type { DepartmentRole } from "@/lib/types";

export default async function CrewPage(
  props: {
    params: Promise<{ showId: string }>;
    searchParams: Promise<{ role?: string }>;
  },
) {
  const { showId: rawShowId } = await props.params;
  const { role } = await props.searchParams;
  const showId = resolveShowIdFromLiveAccessCode(rawShowId) ?? rawShowId;
  const requestedRole = (role?.trim() || "lighting") as DepartmentRole;
  const selectedRole: DepartmentRole = requestedRole === "director" ? "lighting" : requestedRole;
  let { script, cues } = await getScriptAndCues(showId);
  let showTitle = await getShowTitle(showId);
  if (!script.length) {
    const liveDocument = getLiveDocument(showId);
    if (liveDocument) {
      script = liveDocument.script;
      cues = liveDocument.cues;
      showTitle = liveDocument.showName;
    }
  }

  if (!script.length) {
    return (
      <main className="min-h-screen bg-slate-950 p-6 text-white">
        <div className="mx-auto max-w-3xl rounded-xl border border-zinc-800 bg-zinc-900 p-6 shadow-lg">
          <p className="text-xs uppercase tracking-wide text-zinc-400">Crew view unavailable</p>
          <h1 className="mt-2 text-2xl font-semibold text-white">{showTitle}</h1>
          <p className="mt-2 text-sm text-zinc-300">
            There is no saved script for this show yet. Ask the director to save a script in the editor before opening the crew view.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/" prefetch={false} className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100">
              Home
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return <CrewLiveShell showId={showId} showName={showTitle} role={selectedRole} lines={script} cues={cues} />;
}

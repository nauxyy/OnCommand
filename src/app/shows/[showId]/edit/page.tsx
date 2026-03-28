import { DEPARTMENT_COLORS } from "@/lib/constants";
import { getScriptAndCues } from "@/lib/data/shows";
import { SceneTimingHistory } from "@/components/show/scene-timing-history";

export default async function ShowEditPage(props: { params: Promise<{ showId: string }> }) {
  const { showId } = await props.params;
  const { script, cues } = await getScriptAndCues(showId);

  return (
    <main className="min-h-screen bg-slate-950 p-4 text-white">
      <div className="mx-auto grid max-w-7xl grid-cols-[1fr_360px] gap-4">
        <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 shadow-lg">
          <h1 className="text-2xl font-semibold text-white">Cue Planning · {showId}</h1>
          <p className="mt-2 text-sm text-zinc-300">
            Script upload pipeline target: TXT direct parse, PDF -&gt; per-page OCR using Tesseract -&gt; line segmentation by character and dialogue.
          </p>

          <div className="mt-6 space-y-3">
            {script.map((line) => (
              <div key={line.id} className="rounded border border-zinc-700 bg-zinc-950 p-3">
                <p className="text-xs text-zinc-400">
                  Act {line.actNumber} · L{line.lineNumber} · {line.character}
                </p>
                <p className="mt-1 text-sm text-zinc-100">{line.text}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {cues
                    .filter((cue) => cue.lineId === line.id)
                    .map((cue) => (
                      <span
                        key={cue.id}
                        className="rounded-full px-2 py-1 text-xs text-black"
                        style={{ backgroundColor: `${DEPARTMENT_COLORS[cue.department]}66` }}
                      >
                        {cue.department}: {cue.text}
                      </span>
                    ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <aside className="space-y-4">
          <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 shadow-lg">
            <h2 className="text-lg font-semibold text-white">Department Colors</h2>
            <div className="mt-3 space-y-2 text-sm">
              {Object.entries(DEPARTMENT_COLORS).map(([role, color]) => (
                <div key={role} className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: color }} />
                  <span className="text-zinc-100">{role}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 shadow-lg">
            <h2 className="text-lg font-semibold text-white">Stage Diagram Tooling</h2>
            <p className="mt-2 text-sm text-zinc-300">
              Save base diagram image, draw overlays (freehand/shape/text), and attach diagram references to stage cues.
            </p>
          </section>

          <SceneTimingHistory showId={showId} />
        </aside>
      </div>
    </main>
  );
}

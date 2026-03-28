"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createShowAction } from "@/app/actions/shows";
import { parseProprietaryShowDraft, PROPRIETARY_SCRIPT_EXTENSION } from "@/lib/editor/proprietary-format";

export function ShowCreateForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [showImportPopup, setShowImportPopup] = useState(false);
  const [importMode, setImportMode] = useState<"file" | "text">("file");
  const [error, setError] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 shadow-lg">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-zinc-400">Create show</p>
          <h2 className="text-xl font-semibold text-white">New production</h2>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <label className="flex flex-col gap-2 text-sm text-zinc-100">
          Show title
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Tonight Performance"
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-white outline-none focus:border-sky-500"
          />
        </label>

        <input
          ref={fileInputRef}
          type="file"
          accept={`.txt,.text,${PROPRIETARY_SCRIPT_EXTENSION},application/json,text/plain`}
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            setError(null);
            setImportMessage(null);
            file
              .text()
              .then((content) => {
                const proprietary = parseProprietaryShowDraft(content);
                if (proprietary.ok) {
                  setTitle((previous) => proprietary.draft.title || previous);
                  setSourceText(proprietary.draft.sourceText);
                  setImportMessage(`Imported ${file.name} (${PROPRIETARY_SCRIPT_EXTENSION})`);
                  return;
                }
                setSourceText(content);
                setImportMessage(`Imported ${file.name} as plain script text`);
              })
              .catch((importError) => {
                console.error("[ShowCreateForm] import failed:", importError);
                setError("Failed to import script file.");
              })
              .finally(() => {
                if (fileInputRef.current) fileInputRef.current.value = "";
              });
          }}
        />

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setShowImportPopup(true)}
            className="rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-2 text-sm font-medium text-zinc-100"
          >
            Import
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const result = await createShowAction({
                  title,
                  sourceText,
                });

                if (!result.ok || !result.showId) {
                  setError(result.error ?? "Failed to create the show.");
                  return;
                }

                router.push(`/shows/${encodeURIComponent(result.showId)}/edit`);
                router.refresh();
              });
            }}
            className="rounded-lg bg-emerald-300 px-3 py-2 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:bg-emerald-200"
          >
            {isPending ? "Creating…" : "Create show"}
          </button>
        </div>

        {error ? <p className="text-sm text-rose-300">{error}</p> : null}
        {importMessage ? <p className="text-sm text-emerald-300">{importMessage}</p> : null}
        <p className="text-xs text-zinc-500">
          Add script content through Import options (file upload or paste), then create the show.
        </p>
      </div>

      {showImportPopup ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4">
          <div className="w-full max-w-2xl rounded-xl border border-zinc-700 bg-zinc-900 p-4 shadow-2xl">
            <div className="flex items-center justify-between gap-3">
              <p className="text-base font-semibold text-white">Import script</p>
              <button
                type="button"
                onClick={() => setShowImportPopup(false)}
                className="text-lg font-semibold text-zinc-300 hover:text-white"
                aria-label="Close import popup"
              >
                ×
              </button>
            </div>

            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => setImportMode("file")}
                className={[
                  "rounded-md px-3 py-1.5 text-sm font-medium",
                  importMode === "file" ? "bg-sky-600 text-white" : "border border-zinc-700 bg-zinc-800 text-zinc-100",
                ].join(" ")}
              >
                .onscript file
              </button>
              <button
                type="button"
                onClick={() => setImportMode("text")}
                className={[
                  "rounded-md px-3 py-1.5 text-sm font-medium",
                  importMode === "text" ? "bg-sky-600 text-white" : "border border-zinc-700 bg-zinc-800 text-zinc-100",
                ].join(" ")}
              >
                Text input
              </button>
            </div>

            {importMode === "file" ? (
              <div className="mt-4">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-2 text-sm font-medium text-zinc-100"
                >
                  Choose .onscript or text file
                </button>
              </div>
            ) : (
              <label className="mt-4 flex flex-col gap-2 text-sm text-zinc-100">
                Paste script text
                <textarea
                  value={sourceText}
                  onChange={(event) => setSourceText(event.target.value)}
                  placeholder={`ACT I\nSCENE 1: Prologue\nARI: Why do all the clocks here tick at different speeds?\n[Lights shift to blue]`}
                  rows={12}
                  className="min-h-56 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-white outline-none focus:border-sky-500"
                />
              </label>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}

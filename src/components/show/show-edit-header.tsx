"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { renameShowTitleAction } from "@/app/actions/shows";
import { PROPRIETARY_SCRIPT_EXTENSION } from "@/lib/editor/proprietary-format";

export function ShowEditHeader({ showId, initialTitle }: { showId: string; initialTitle: string }) {
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [hasPendingChanges, setHasPendingChanges] = useState(false);
  const [saveHover, setSaveHover] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const onDirty = (event: Event) => {
      const custom = event as CustomEvent<{ isDirty?: boolean }>;
      setHasPendingChanges(Boolean(custom.detail?.isDirty));
    };
    window.addEventListener("oncommand:editor-dirty", onDirty as EventListener);
    return () => window.removeEventListener("oncommand:editor-dirty", onDirty as EventListener);
  }, []);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-4 shadow-lg">
      <div className="min-w-0">
        <Link href={`/shows/${showId}`} className="text-sm text-zinc-300 hover:text-white">
          ← Back to show hub
        </Link>
        <div className="mt-2 flex items-center gap-2">
          {isEditingTitle ? (
            <>
              <span className="text-2xl font-semibold text-white">Cue Editor ·</span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="h-10 max-w-[22rem] rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-lg font-semibold text-white outline-none focus:border-sky-500"
              />
              <button
                type="button"
                disabled={isPending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await renameShowTitleAction({ showId, title });
                    if (!result.ok) {
                      setRenameError(result.error ?? "Failed to rename show.");
                      return;
                    }
                    setRenameError(null);
                    setIsEditingTitle(false);
                    router.refresh();
                  })
                }
                className="rounded-md border border-emerald-700 bg-emerald-900 px-2 py-1 text-sm font-semibold text-emerald-100"
                title="Save title"
              >
                ✓
              </button>
            </>
          ) : (
            <>
              <h1 className="truncate text-2xl font-semibold text-white">{`Cue Editor · ${title}`}</h1>
              <button
                type="button"
                onClick={() => {
                  setRenameError(null);
                  setIsEditingTitle(true);
                }}
                className="rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-100"
                title="Edit title"
              >
                ✎
              </button>
            </>
          )}
        </div>
        {renameError ? <p className="mt-1 text-xs text-rose-300">{renameError}</p> : null}
        {transferError ? <p className="mt-1 text-xs text-rose-300">{transferError}</p> : null}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <input
          ref={fileInputRef}
          type="file"
          accept={`${PROPRIETARY_SCRIPT_EXTENSION},text/plain,application/json`}
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            setTransferError(null);
            file
              .text()
              .then((content) => {
                window.dispatchEvent(new CustomEvent("oncommand:import-script", { detail: { fileName: file.name, content } }));
              })
              .catch((error) => {
                console.error("[ShowEditHeader] import read failed:", error);
                setTransferError("Failed to read the selected script file.");
              })
              .finally(() => {
                if (fileInputRef.current) fileInputRef.current.value = "";
              });
          }}
        />
        <Link href={`/shows/${showId}/live?role=director`} className="rounded-lg bg-emerald-600 px-3 py-2 font-semibold text-white">
          Director live view
        </Link>
        <Link href={`/shows/${showId}/crew?role=lighting`} className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100">
          Crew view
        </Link>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="cursor-pointer rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100"
        >
          Import
        </button>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event("oncommand:export-request"))}
          className="cursor-pointer rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-zinc-100"
        >
          Export
        </button>
        <button
          type="button"
          onMouseEnter={() => setSaveHover(true)}
          onMouseLeave={() => setSaveHover(false)}
          onClick={() => window.dispatchEvent(new Event("oncommand:save-request"))}
          className="rounded-lg bg-sky-600 px-3 py-2 font-semibold text-white"
          style={{
            cursor: saveHover
              ? hasPendingChanges
                ? "pointer"
                : `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16'><circle cx='8' cy='8' r='6' fill='%23ef4444'/><rect x='4' y='7' width='8' height='2' fill='white'/></svg>") 8 8, pointer`
              : "pointer",
          }}
        >
          Save
        </button>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event("oncommand:reset-request"))}
          className="cursor-pointer rounded-lg border border-zinc-600 bg-zinc-800 px-2.5 py-2 text-zinc-100"
          title="Revert"
          aria-label="Revert"
        >
          ↺
        </button>
      </div>
    </div>
  );
}

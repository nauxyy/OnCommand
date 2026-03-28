"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteShowAction } from "@/app/actions/shows";

export function DeleteShowConfirm({ showId }: { showId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="mt-4 space-y-3">
      <p className="text-sm text-zinc-300">
        This action is permanent and will remove script, cues, live data, and memberships for this show.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const result = await deleteShowAction({ showId });
              if (!result.ok) {
                setError(result.error ?? "Failed to delete show.");
                return;
              }
              router.push("/shows");
              router.refresh();
            });
          }}
          className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-rose-400"
        >
          {isPending ? "Deleting…" : "Yes, delete show"}
        </button>
        <Link href={`/shows/${showId}`} className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100">
          Cancel
        </Link>
      </div>
      {error ? <p className="text-sm text-rose-300">{error}</p> : null}
    </div>
  );
}


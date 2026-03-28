import Link from "next/link";
import { DeleteShowConfirm } from "@/components/show/delete-show-confirm";
import { getShowTitle } from "@/lib/data/shows";

export default async function DeleteShowPage(props: { params: Promise<{ showId: string }> }) {
  const { showId } = await props.params;
  const showTitle = await getShowTitle(showId);

  return (
    <main className="min-h-screen bg-slate-950 p-6 text-white">
      <div className="mx-auto max-w-3xl space-y-4">
        <Link href="/" className="inline-block text-2xl font-bold tracking-wide text-zinc-200 hover:text-white">
          OnCommand
        </Link>
        <section className="rounded-xl border border-rose-800/60 bg-zinc-900 p-6 shadow-lg">
          <p className="text-xs uppercase tracking-wide text-rose-300">Delete show</p>
          <h1 className="mt-2 text-2xl font-semibold text-white">{showTitle}</h1>
          <p className="mt-1 text-xs text-zinc-400">{showId}</p>
          <DeleteShowConfirm showId={showId} />
        </section>
      </div>
    </main>
  );
}


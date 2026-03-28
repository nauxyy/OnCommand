import Link from "next/link";
import { notFound } from "next/navigation";
import { ShowEditor } from "@/components/show/show-editor";
import { ShowEditHeader } from "@/components/show/show-edit-header";
import { getShowEditorData } from "@/lib/data/shows";

export default async function ShowEditPage(props: { params: Promise<{ showId: string }> }) {
  const { showId } = await props.params;
  const editorData = await getShowEditorData(showId);

  if (!editorData) {
    notFound();
  }

  return (
    <main className="flex-1 bg-slate-950 p-4 pb-10 text-white">
      <div className="mx-auto max-w-7xl space-y-4">
        <Link href="/" className="mb-2 block text-2xl font-bold tracking-wide text-zinc-200 hover:text-white">
          OnCommand
        </Link>
        <ShowEditHeader showId={showId} initialTitle={editorData.title} />

        <ShowEditor key={`${editorData.revision}-${editorData.title}`} initialData={editorData} />
      </div>
    </main>
  );
}

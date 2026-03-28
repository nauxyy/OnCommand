import { DirectorLiveShell } from "@/components/live/live-shell";
import { getScriptAndCues, getShowTitle } from "@/lib/data/shows";

export default async function LiveDirectorPage(props: { params: Promise<{ showId: string }> }) {
  const { showId } = await props.params;
  const { script, cues } = await getScriptAndCues(showId);
  const showTitle = await getShowTitle(showId);

  return <DirectorLiveShell showId={showId} showName={showTitle} lines={script} cues={cues} />;
}

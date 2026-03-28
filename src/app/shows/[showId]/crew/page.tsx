import { CrewLiveShell } from "@/components/live/live-shell";
import { getScriptAndCues, getShowTitle } from "@/lib/data/shows";
import type { DepartmentRole } from "@/lib/types";

export default async function CrewPage(
  props: {
    params: Promise<{ showId: string }>;
    searchParams: Promise<{ role?: string }>;
  },
) {
  const { showId } = await props.params;
  const { role } = await props.searchParams;
  const selectedRole = (role?.trim() || "lighting") as DepartmentRole;
  const { script, cues } = await getScriptAndCues(showId);
  const showTitle = await getShowTitle(showId);

  return <CrewLiveShell showId={showId} showName={showTitle} role={selectedRole} lines={script} cues={cues} />;
}

import { hasSupabaseEnv } from "@/lib/env";
import { SAMPLE_CUES, SAMPLE_SCRIPT_LINES } from "@/lib/constants";
import type { Cue, ScriptLine } from "@/lib/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface ShowSummary {
  id: string;
  title: string;
  createdAt: string;
}

interface MembershipSelectRow {
  shows:
    | {
        id: string;
        title: string;
        created_at: string;
      }
    | Array<{
        id: string;
        title: string;
        created_at: string;
      }>;
}

function normalizeShow(row: MembershipSelectRow): ShowSummary {
  const shows = Array.isArray(row.shows) ? row.shows[0] : row.shows;
  return {
    id: shows.id,
    title: shows.title,
    createdAt: shows.created_at,
  };
}

type UnknownMembershipRow = {
  shows?: {
    id: string;
    title: string;
    created_at: string;
  };
};

export async function listShowsForCurrentUser(): Promise<ShowSummary[]> {
  if (!hasSupabaseEnv()) {
    return [{ id: "demo-show", title: "Demo Show", createdAt: new Date().toISOString() }];
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return [];

  const { data, error } = await supabase
    .from("show_memberships")
    .select("show_id, shows!inner(id, title, created_at)")
    .eq("user_id", user.id)
    .order("created_at", { referencedTable: "shows", ascending: false });

  if (error || !data) return [];

  return (data as unknown as UnknownMembershipRow[]).reduce<ShowSummary[]>((acc, row) => {
    if (!row.shows) return acc;
    acc.push(normalizeShow(row as MembershipSelectRow));
    return acc;
  }, []);
}

export async function createShowForCurrentUser(title: string): Promise<ShowSummary | null> {
  if (!hasSupabaseEnv()) {
    return { id: crypto.randomUUID(), title, createdAt: new Date().toISOString() };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: show, error: showError } = await supabase
    .from("shows")
    .insert({ title, director_user_id: user.id })
    .select("id, title, created_at")
    .single();

  if (showError || !show) return null;

  await supabase.from("show_memberships").insert({
    show_id: show.id,
    user_id: user.id,
    role: "director",
  });

  return {
    id: show.id,
    title: show.title,
    createdAt: show.created_at,
  };
}

export async function getScriptAndCues(showId: string): Promise<{ script: ScriptLine[]; cues: Cue[] }> {
  void showId;
  return {
    script: SAMPLE_SCRIPT_LINES,
    cues: SAMPLE_CUES,
  };
}

export async function getShowTitle(showId: string): Promise<string> {
  if (showId === "demo-show") {
    return "Demo Show";
  }

  if (!hasSupabaseEnv()) {
    return showId;
  }

  try {
    const supabase = await createSupabaseServerClient();
    const query = supabase.from("shows").select("title").eq("id", showId).single();
    const timeout = new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), 3000);
    });
    const result = (await Promise.race([query, timeout])) as Awaited<typeof query> | null;
    if (!result || result.error || !result.data?.title) return showId;
    return result.data.title;
  } catch {
    return showId;
  }
}

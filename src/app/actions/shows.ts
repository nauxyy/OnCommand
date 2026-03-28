'use server';

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createShowForCurrentUser, renameShowTitleForCurrentUser, saveShowEditorDraftForCurrentUser } from "@/lib/data/shows";
import { normalizeEditorDraft } from "@/lib/editor/document";
import type { ShowEditorDraft } from "@/lib/types";

const createShowInputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  sourceText: z.string().max(200_000).optional(),
});

const cueSchema = z.object({
  id: z.string().min(1),
  department: z.string().trim().min(1),
  anchorGapIndex: z.number().int().min(0),
  text: z.string().max(500),
  standbyOffsetMs: z.number().int(),
  goOffsetMs: z.number().int(),
  diagramUrl: z.string().url().optional().or(z.literal("")).optional(),
});

const lineSchema = z.object({
  id: z.string().min(1),
  lineNumber: z.number().int().min(1),
  character: z.string().max(120),
  text: z.string().max(2_000),
  lineType: z.enum(["dialogue", "stage_direction"]),
  sortIndex: z.number().int().min(0),
  cues: z.array(cueSchema),
});

const sceneSchema = z.object({
  id: z.string().min(1),
  actNumber: z.number().int().min(1),
  title: z.string().trim().min(1).max(160),
  sortIndex: z.number().int().min(0),
  lines: z.array(lineSchema),
});

const showDraftSchema = z.object({
  showId: z.string().min(1),
  title: z.string().trim().min(1).max(120),
  revision: z.string().min(1),
  sourceText: z.string().max(200_000),
  acts: z.array(
    z.object({
      actNumber: z.number().int().min(1),
      scenes: z.array(sceneSchema),
    }),
  ),
});

const renameShowSchema = z.object({
  showId: z.string().trim().min(1),
  title: z.string().trim().min(1).max(120),
});

export async function createShowAction(input: { title: string; sourceText?: string }) {
  const parsed = createShowInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: "Enter a show title before creating the show." };
  }

  const result = await createShowForCurrentUser(parsed.data);
  if (!result.ok) {
    return result;
  }

  revalidatePath("/shows");
  return result;
}

export async function saveShowEditorDraftAction(input: ShowEditorDraft) {
  const parsed = showDraftSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: "The editor data is invalid. Refresh the page and try again." };
  }

  const normalized = normalizeEditorDraft(parsed.data as ShowEditorDraft);
  const result = await saveShowEditorDraftForCurrentUser(normalized);
  if (!result.ok) {
    return result;
  }

  revalidatePath("/shows");
  revalidatePath(`/shows/${normalized.showId}`);
  revalidatePath(`/shows/${normalized.showId}/edit`);
  revalidatePath(`/shows/${normalized.showId}/live`);
  revalidatePath(`/shows/${normalized.showId}/crew`);
  return result;
}

export async function renameShowTitleAction(input: { showId: string; title: string }) {
  const parsed = renameShowSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: "Enter a valid show title." };
  }

  const result = await renameShowTitleForCurrentUser(parsed.data);
  if (!result.ok) {
    return result;
  }

  revalidatePath("/shows");
  revalidatePath(`/shows/${parsed.data.showId}`);
  revalidatePath(`/shows/${parsed.data.showId}/edit`);
  revalidatePath(`/shows/${parsed.data.showId}/live`);
  revalidatePath(`/shows/${parsed.data.showId}/crew`);
  return result;
}

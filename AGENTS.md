<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

# AGENTS.md — OnCommand

> **This is a hackathon project.** Velocity matters. Ship working features fast. Security is worth considering but not at the expense of momentum — don't gold-plate, don't over-engineer, don't block progress on hardening that can wait until post-hackathon.

> **This file is living documentation.** When you hit a bug, discover a gotcha, or learn something about this codebase that would save future sessions from repeating the mistake, **update this file** (add to the Lessons Learned section at the bottom). Keep entries short and actionable.

## Mission

1. Make the project pass CI-level quality checks.
2. Implement features requested by the user (or needed for tests to pass).
3. Improve reliability by learning from prior failures.
4. Keep changes minimal, reviewable, and consistent with established patterns.

## Execution Order

For every task, follow this sequence:

1. **Understand** — Read the relevant files before touching them. Never edit blind.
2. **Plan** — State what you will change and why, in 1-3 sentences.
3. **Implement** — Make the smallest diff that solves the problem.
4. **Verify** — Run the quality suite (see below). Fix anything that fails before declaring done.

## Quality Suite

Run these checks after every meaningful change. All must pass.

```bash
npm run lint          # ESLint (next/core-web-vitals + next/typescript)
npm run typecheck     # tsc --noEmit (strict mode)
npm run build         # Next.js production build — catches runtime import issues
```

If a check fails, fix it before moving on. Do not skip or suppress warnings.

## Operating Rules

### Hard Constraints
- **No `any` types.** Use `unknown` + narrowing if the type is genuinely unknown.
- **No `// @ts-ignore` or `// @ts-expect-error`** unless a comment explains why and links to an upstream issue.
- **No `eslint-disable`** unless unavoidable; always scope to the narrowest line/rule.
- **No secrets in code.** All secrets go in `.env.local` (never committed). Public env vars use `NEXT_PUBLIC_` prefix.
- **No new dependencies** without user approval.
- **Don't rerun `supabase/schema.sql` blindly** — the remote DB may already have the tables. Use incremental migrations or manual SQL editor patches.
- **Always add `console.error` logging** when catching or handling errors — silent failures are the worst failures. Use `console.log` for key operations in server actions (e.g., "Creating show for user X", "Advancing line in show Y") so the terminal shows what happened.

### Conventions
- Use `@/*` path aliases (maps to `src/*`).
- Server Actions go in `src/app/actions/` with `'use server'` at the top.
- Data-fetching functions (read-only) go in `src/lib/data/`.
- Domain logic (pure functions, state machines) goes in `src/lib/domain/`.
- Supabase client helpers live in `src/lib/supabase/` — use `createServerSupabaseClient()` in server contexts.
- Shared types in `src/types/`. DB row types in `database.ts`, domain models in `domain.ts`.
- Route constants in `src/lib/config/routes.ts`.
- Environment access through `src/lib/config/env.ts` (Zod-validated).
- Tailwind for all styling. No CSS modules or inline `style={}`.
- `clsx` + `tailwind-merge` via the `cn()` utility in `src/lib/utils/cn.ts`.

## Debugging Protocol

When something fails:

1. **Check the logs first** — look at the terminal output (`npm run dev`) and browser console. The `[functionName]` prefixes make it easy to find the relevant log. This is your fastest signal.
2. **Read the error message fully** — don't guess.
3. **Trace to the source** — find the exact file and line.
4. **Check the obvious** — missing import? Wrong env var name? Typo in column name?
5. **Reproduce minimally** — if a Supabase query fails, check the SQL in isolation.
6. **Fix the root cause** — don't patch symptoms. If RLS blocks an insert, fix the policy, don't remove RLS.
7. **Verify the fix** — run the quality suite again.

If stuck after two attempts at the same error, stop and explain what you've tried.

## Code Quality Expectations

- **Server components by default.** Only add `'use client'` when the component needs interactivity (hooks, event handlers, browser APIs).
- **Server Actions for mutations.** Forms call actions in `src/app/actions/`.
- **Validate inputs** in server actions before hitting the DB (at minimum: empty checks, trim).
- **Handle Supabase errors** — check `{ error }` on every query. Always `console.error` the full error object, then throw or return a simpler message to the client.
- **Use `revalidatePath`** after mutations that change displayed data.
- **Use `redirect`** after successful writes that should navigate the user.
- **Keep components small.** If a component exceeds ~150 lines, consider splitting.

## Logging

- **Server actions**: Log the operation name and key identifiers at the start. Log errors with full context.
  ```ts
  console.log('[createShow]', { title, userId: user.id });
  // ... on error:
  console.error('[createShow] insert failed:', error);
  ```
- **Data fetching**: Log errors but not routine reads (too noisy).
  ```ts
  if (error) console.error('[getShowEditorData]', showId, error);
  ```
- **Format**: `[functionName]` prefix so logs are grep-able in the terminal.
- **No sensitive data in logs** — don't log tokens, passwords, or full request bodies.

## Deliverables for Every Task

Before marking a task complete, confirm:

- [ ] Code compiles (`npm run typecheck`)
- [ ] Linter passes (`npm run lint`)
- [ ] Build succeeds (`npm run build`)
- [ ] Only files relevant to the task were changed
- [ ] No leftover debug logs, commented-out code, or TODOs without context
- [ ] Error paths have `console.error` with `[functionName]` prefix

## Lessons Learned

<!-- Add entries here as issues are discovered. Format: **Short title** — what happened, what to do instead. -->
- **Supabase cookie writes in Server Components** — `createServerSupabaseClient()` must wrap `setAll` in a try-catch. Server Components can't modify cookies; only Server Actions, Route Handlers, and Middleware can. The middleware handles token refresh on the next request, so silently catching here is safe.
- **Supabase anonymous auth uses the authenticated DB role** — policies for anonymous sign-in sessions must target `authenticated` and use `auth.uid()`, not `anon`.
- **Cue drop dialog cancel behavior** — when a cue is created on drag-drop and the instruction dialog is dismissed empty, remove that cue immediately to avoid leaving blank ghost cues in the script.
- **HTML5 drag payload compatibility** — for reliable drop in inline script text, write cue payloads to multiple dataTransfer types (`application/x-*`, `application/json`, and `text/plain`) and parse all of them on drop.
- **Editor save performance** — avoid per-row Supabase inserts for scenes/lines/cues. Batch inserts in chunks and fetch inserted rows once to build ID maps; this reduces large-show save times dramatically.
- **No stage-direction line mode** — this project now treats all script lines as dialogue-style lines and uses cue chips for operational actions; keep stage-direction UI/actions disabled to avoid mixed workflows.


<!-- END:nextjs-agent-rules -->

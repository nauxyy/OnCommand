# OnCommand

Real-time execution system for live theatre production calling.

## Stack

- Next.js 16 (App Router)
- React 19
- Tailwind CSS 4
- Supabase Postgres + Auth (anonymous auth)
- Server-driven live sync via Next.js APIs (SSE + publish endpoint)

## Setup

1. Install dependencies:

```bash
npm install
```

2. Configure environment:

```bash
cp .env.example .env.local
```

Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

3. Apply DB schema to Supabase SQL editor:

- `supabase/schema.sql`

4. Start dev server:

```bash
npm run dev
```

## Routing

- `/` home + anonymous auth gate
- `/shows` show list
- `/shows/[showId]/edit` cue planning view
- `/shows/[showId]/live` director live mode
- `/shows/[showId]/crew?role=lighting` crew live mode

## Live sync strategy

This project intentionally does **not** use Supabase Realtime for cue sync.

- `GET /api/live/[showId]/events` opens server-sent events stream
- `POST /api/live/[showId]/publish` publishes events
- In-memory bus fans out events to subscribers

For production, replace the in-memory bus with Redis pub/sub or a dedicated WebSocket gateway to support horizontal scaling.

## OCR + script parsing target

Planned ingestion path:

- `.txt`: direct parse into lines + character labels
- `.pdf`: per-page OCR with Tesseract, then dialogue segmentation

The current scaffold includes schema and UI placeholders for this flow.

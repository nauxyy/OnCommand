-- OnCommand baseline schema (Supabase Postgres)
create extension if not exists pgcrypto;

create table if not exists shows (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  director_user_id uuid not null,
  created_at timestamptz not null default now()
);

create table if not exists show_memberships (
  show_id uuid not null references shows(id) on delete cascade,
  user_id uuid not null,
  role text not null check (role in ('director','lighting','sound','stage_left','stage_right','stage_crew')),
  joined_at timestamptz not null default now(),
  primary key (show_id, user_id)
);

create table if not exists scripts (
  id uuid primary key default gen_random_uuid(),
  show_id uuid not null references shows(id) on delete cascade,
  source_type text not null check (source_type in ('txt','pdf')),
  raw_text text not null,
  ocr_metadata jsonb,
  created_at timestamptz not null default now()
);

create table if not exists script_lines (
  id bigint generated always as identity primary key,
  show_id uuid not null references shows(id) on delete cascade,
  act_number int not null,
  line_number int not null,
  character_name text not null,
  line_text text not null,
  unique (show_id, act_number, line_number)
);

create table if not exists cues (
  id uuid primary key default gen_random_uuid(),
  show_id uuid not null references shows(id) on delete cascade,
  line_id bigint not null references script_lines(id) on delete cascade,
  anchor_word_start int not null,
  anchor_word_end int not null,
  department text not null check (department in ('director','lighting','sound','stage_left','stage_right','stage_crew')),
  cue_text text not null,
  standby_offset_ms int not null default 5000,
  go_offset_ms int not null default 0,
  diagram_image_url text,
  updated_at timestamptz not null default now()
);

create table if not exists stage_diagrams (
  id uuid primary key default gen_random_uuid(),
  show_id uuid not null references shows(id) on delete cascade,
  name text not null,
  base_image_url text not null,
  overlay_data jsonb,
  created_at timestamptz not null default now()
);

create table if not exists live_messages (
  id bigint generated always as identity primary key,
  show_id uuid not null references shows(id) on delete cascade,
  sender_user_id uuid not null,
  sender_role text not null,
  recipient_scope text not null,
  content text not null,
  is_preset boolean not null default false,
  created_at timestamptz not null default now()
);

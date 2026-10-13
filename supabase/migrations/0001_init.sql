begin;

create table public.notes (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  created_at timestamptz not null default now(),
  duration_ms bigint not null check (duration_ms >= 0),
  status text not null check (status in ('recording','transcribing','summarizing','done','error')),
  model_name text,
  gaps jsonb not null default '[]' check (jsonb_typeof(gaps) = 'array')
);
create index notes_user_created_idx on public.notes(user_id, created_at desc);

create table public.audio_chunks (
  note_id text not null references public.notes(id) on delete cascade,
  seq integer not null check (seq >= 0),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  start_ms bigint not null check (start_ms >= 0),
  duration_ms bigint not null check (duration_ms >= 0),
  local_path text,
  mime_type text not null,
  remote_path text,
  uploaded_at timestamptz,
  transcribed_at timestamptz,
  primary key (note_id, seq)
);
create table public.segments (
  id text primary key,
  note_id text not null references public.notes(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  start_ms bigint not null check (start_ms >= 0),
  end_ms bigint not null check (end_ms >= start_ms),
  text text not null,
  speaker_label text,
  edited boolean not null default false
);
create index segments_note_time_idx on public.segments(note_id, start_ms);
create table public.memos (
  id text primary key,
  note_id text not null references public.notes(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  at_ms bigint not null check (at_ms >= 0),
  text text not null,
  kind text not null check (kind in ('memo', 'bookmark'))
);
create index memos_note_time_idx on public.memos(note_id, at_ms);
create table public.summaries (
  note_id text primary key references public.notes(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  summary jsonb not null check (jsonb_typeof(summary) = 'array'),
  keywords text[] not null default '{}' check (cardinality(keywords) <= 10),
  todos jsonb not null check (jsonb_typeof(todos) = 'array'),
  created_at timestamptz not null default now()
);

alter table public.notes enable row level security;
create policy notes_owner on public.notes for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- FOR ALL covers SELECT/INSERT/UPDATE/DELETE; both old and new rows are checked.
do $$
declare t text;
begin
  foreach t in array array['audio_chunks', 'segments', 'memos', 'summaries'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy child_owner on public.%I for all to authenticated
       using (user_id = (select auth.uid()) and exists
         (select 1 from public.notes n where n.id = %I.note_id and n.user_id = (select auth.uid())))
       with check (user_id = (select auth.uid()) and exists
         (select 1 from public.notes n where n.id = %I.note_id and n.user_id = (select auth.uid())))', t, t, t);
  end loop;
end $$;
grant select, insert, update, delete on public.notes, public.audio_chunks, public.segments, public.memos, public.summaries to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('audio', 'audio', false, 104857600,
  array['audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/webm', 'audio/ogg'])
on conflict (id) do update set public = false,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
create policy audio_owner on storage.objects for all to authenticated
  using (bucket_id = 'audio' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'audio' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Invoker rights preserve RLS. The entire replacement rolls back on any failure.
create function public.sync_push_note(p_note jsonb, p_segments jsonb, p_memos jsonb, p_summary jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare target_id text := p_note->>'id';
begin
  if auth.uid() is null or p_note->>'user_id' is distinct from auth.uid()::text then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  if jsonb_typeof(p_segments) is distinct from 'array' or jsonb_typeof(p_memos) is distinct from 'array'
    or exists (select 1 from jsonb_array_elements(p_segments) s where s->>'note_id' is distinct from target_id)
    or exists (select 1 from jsonb_array_elements(p_memos) m where m->>'note_id' is distinct from target_id)
    or (p_summary is not null and p_summary->>'note_id' is distinct from target_id) then
    raise exception 'Invalid note detail';
  end if;
  insert into public.notes (id, user_id, title, created_at, duration_ms, status, model_name, gaps)
    select id, auth.uid(), title, created_at, duration_ms, status, model_name, gaps
    from jsonb_populate_record(null::public.notes, p_note)
  on conflict (id) do update set title = excluded.title, created_at = excluded.created_at,
    duration_ms = excluded.duration_ms, status = excluded.status, model_name = excluded.model_name, gaps = excluded.gaps;
  -- The upsert locks the note, serializing concurrent replacements for this note.
  delete from public.segments where note_id = target_id;
  insert into public.segments (id, note_id, user_id, start_ms, end_ms, text, speaker_label, edited)
    select id, target_id, auth.uid(), start_ms, end_ms, text, speaker_label, edited
    from jsonb_populate_recordset(null::public.segments, p_segments);
  delete from public.memos where note_id = target_id;
  insert into public.memos (id, note_id, user_id, at_ms, text, kind)
    select id, target_id, auth.uid(), at_ms, text, kind
    from jsonb_populate_recordset(null::public.memos, p_memos);
  if p_summary is null then
    delete from public.summaries where note_id = target_id;
  else
    insert into public.summaries (note_id, user_id, summary, keywords, todos, created_at)
      select target_id, auth.uid(), summary, keywords, todos, created_at
      from jsonb_populate_record(null::public.summaries, p_summary)
    on conflict (note_id) do update set summary = excluded.summary, keywords = excluded.keywords,
      todos = excluded.todos, created_at = excluded.created_at;
  end if;
end $$;

create function public.sync_pull_note_detail(p_note_id text)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'segments', (select coalesce(jsonb_agg(to_jsonb(s) order by s.start_ms, s.id), '[]'::jsonb) from public.segments s where s.note_id = n.id),
    'memos', (select coalesce(jsonb_agg(to_jsonb(m) order by m.at_ms, m.id), '[]'::jsonb) from public.memos m where m.note_id = n.id),
    'summary', (select to_jsonb(su) from public.summaries su where su.note_id = n.id)
  ) from public.notes n where n.id = p_note_id;
$$;
revoke all on function public.sync_push_note(jsonb, jsonb, jsonb, jsonb) from public, anon;
revoke all on function public.sync_pull_note_detail(text) from public, anon;
grant execute on function public.sync_push_note(jsonb, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.sync_pull_note_detail(text) to authenticated;
commit;

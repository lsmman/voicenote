begin;

-- A device that pulled a note without its detail must not wipe the transcript or
-- summary another device produced: an empty push keeps what the server has.
create or replace function public.sync_push_note(p_note jsonb, p_segments jsonb, p_memos jsonb, p_summary jsonb)
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
  if jsonb_array_length(p_segments) > 0 then
    delete from public.segments where note_id = target_id;
    insert into public.segments (id, note_id, user_id, start_ms, end_ms, text, speaker_label, edited)
      select id, target_id, auth.uid(), start_ms, end_ms, text, speaker_label, edited
      from jsonb_populate_recordset(null::public.segments, p_segments);
  end if;
  if jsonb_array_length(p_memos) > 0 then
    delete from public.memos where note_id = target_id;
    insert into public.memos (id, note_id, user_id, at_ms, text, kind)
      select id, target_id, auth.uid(), at_ms, text, kind
      from jsonb_populate_recordset(null::public.memos, p_memos);
  end if;
  if p_summary is not null and jsonb_array_length(coalesce(p_summary->'summary', '[]'::jsonb)) > 0 then
    insert into public.summaries (note_id, user_id, summary, keywords, todos, created_at)
      select target_id, auth.uid(), summary, keywords, todos, created_at
      from jsonb_populate_record(null::public.summaries, p_summary)
    on conflict (note_id) do update set summary = excluded.summary, keywords = excluded.keywords,
      todos = excluded.todos, created_at = excluded.created_at;
  end if;
end $$;

commit;

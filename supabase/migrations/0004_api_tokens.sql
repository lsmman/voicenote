begin;

create table public.api_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  token_hash text not null unique,
  prefix text not null,
  created_at timestamptz default now(),
  last_used_at timestamptz
);
alter table public.api_tokens enable row level security;
revoke all on public.api_tokens from public, anon, authenticated;
grant select, delete on public.api_tokens to authenticated;
create policy api_tokens_select on public.api_tokens for select to authenticated
  using (user_id = (select auth.uid()));
create policy api_tokens_delete on public.api_tokens for delete to authenticated
  using (user_id = (select auth.uid()));

create function public.create_api_token(p_name text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  token text;
begin
  if caller is null then raise exception 'Unauthorized' using errcode = '28000'; end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 60 then
    raise exception 'Token name must contain 1 to 60 characters';
  end if;
  -- Serialize creation for this user, including simultaneous requests at the cap.
  perform 1 from auth.users where id = caller for update;
  if (select count(*) from public.api_tokens where user_id = caller) >= 20 then
    raise exception 'Token limit reached (20)';
  end if;
  token := 'vn_' || encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.api_tokens(user_id, name, token_hash, prefix)
    values (caller, btrim(p_name), encode(extensions.digest(token, 'sha256'), 'hex'), left(token, 10));
  return token;
end $$;
revoke all on function public.create_api_token(text) from public, anon, authenticated;
grant execute on function public.create_api_token(text) to authenticated;

-- Internal helper: never exposed as an executable RPC to clients.
create function public.mcp_token_user(p_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare caller uuid;
begin
  if p_token is null or p_token !~ '^vn_[0-9a-f]{64}$' then
    raise exception 'Invalid API token' using errcode = '28000';
  end if;
  update public.api_tokens set last_used_at = now()
    where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    returning user_id into caller;
  if caller is null then raise exception 'Invalid API token' using errcode = '28000'; end if;
  return caller;
end $$;
revoke all on function public.mcp_token_user(text) from public, anon, authenticated;

create function public.mcp_list_notes(p_token text, p_query text default null, p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := public.mcp_token_user(p_token);
  pattern text := '%' || replace(replace(replace(coalesce(p_query, ''), E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%';
begin
  -- Zero is reserved for the HTTP handler's authentication-only probe.
  return (select coalesce(jsonb_agg(to_jsonb(r) order by r."createdAt" desc, r.id), '[]'::jsonb) from (
    select n.id, n.title, n.created_at as "createdAt", n.duration_ms as "durationMs", n.status,
      exists(select 1 from public.summaries s where s.note_id = n.id and s.user_id = caller) as "hasSummary"
    from public.notes n where n.user_id = caller and (n.title ilike pattern escape E'\\' or exists (
      select 1 from public.segments s where s.note_id = n.id and s.user_id = caller and s.text ilike pattern escape E'\\'))
    order by n.created_at desc, n.id limit greatest(0, least(coalesce(p_limit, 20), 100))
  ) r);
end $$;

create function public.mcp_get_note(p_token text, p_id text, p_include_transcript boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare caller uuid := public.mcp_token_user(p_token);
begin
  return (select jsonb_build_object(
    'id', n.id, 'title', n.title, 'createdAt', n.created_at, 'durationMs', n.duration_ms,
    'summary', (select jsonb_build_object('bullets', s.summary, 'keywords', s.keywords, 'todos', s.todos)
      from public.summaries s where s.note_id = n.id and s.user_id = caller),
    'memos', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'atMs', m.at_ms, 'text', m.text, 'kind', m.kind)
      order by m.at_ms, m.id), '[]'::jsonb) from public.memos m where m.note_id = n.id and m.user_id = caller)
  ) || case when coalesce(p_include_transcript, true) then jsonb_build_object('transcript', (
    select coalesce(jsonb_agg(jsonb_build_object('startMs', s.start_ms, 'text', s.text) order by s.start_ms, s.id), '[]'::jsonb)
    from public.segments s where s.note_id = n.id and s.user_id = caller
  )) else '{}'::jsonb end from public.notes n where n.id = p_id and n.user_id = caller);
end $$;

create function public.mcp_search_transcripts(p_token text, p_query text, p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := public.mcp_token_user(p_token);
  pattern text := '%' || replace(replace(replace(p_query, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%';
begin
  if p_query is null or btrim(p_query) = '' then raise exception 'Query is required'; end if;
  return (select coalesce(jsonb_agg(r.item order by r.created_at desc, r.note_id, r.start_ms, r.id), '[]'::jsonb) from (
    select jsonb_build_object('noteId', n.id, 'noteTitle', n.title, 'startMs', s.start_ms, 'text', s.text) as item,
      n.created_at, n.id as note_id, s.start_ms, s.id
    from public.segments s join public.notes n on n.id = s.note_id
    where s.user_id = caller and n.user_id = caller and s.text ilike pattern escape E'\\'
    order by n.created_at desc, n.id, s.start_ms, s.id limit greatest(1, least(coalesce(p_limit, 20), 100))
  ) r);
end $$;
revoke all on function public.mcp_list_notes(text, text, integer) from public, anon, authenticated;
revoke all on function public.mcp_get_note(text, text, boolean) from public, anon, authenticated;
revoke all on function public.mcp_search_transcripts(text, text, integer) from public, anon, authenticated;
grant execute on function public.mcp_list_notes(text, text, integer) to anon;
grant execute on function public.mcp_get_note(text, text, boolean) to anon;
grant execute on function public.mcp_search_transcripts(text, text, integer) to anon;

commit;

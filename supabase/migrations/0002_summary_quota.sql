begin;

create table public.summary_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  count int not null check (count >= 0),
  primary key (user_id, day)
);
alter table public.summary_usage enable row level security;
-- Clients can inspect their usage, but only the RPC may change it.
revoke all on public.summary_usage from public, anon, authenticated;
grant select on public.summary_usage to authenticated;
create policy summary_usage_owner on public.summary_usage for select to authenticated
  using (user_id = (select auth.uid()));

create function public.consume_summary_quota(p_limit int)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null or p_limit is null or p_limit <= 0 then
    return false;
  end if;
  -- UTC days; ON CONFLICT locks the row so concurrent requests share the limit.
  insert into public.summary_usage as usage (user_id, day, count)
    values (caller, (now() at time zone 'UTC')::date, 1)
  on conflict (user_id, day) do update set count = usage.count + 1
    where usage.count < p_limit;
  return found;
end $$;
revoke all on function public.consume_summary_quota(int) from public, anon;
grant execute on function public.consume_summary_quota(int) to authenticated;

commit;

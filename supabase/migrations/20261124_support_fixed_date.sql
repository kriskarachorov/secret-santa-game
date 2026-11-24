-- Keep the RPC's date validation in sync with the confirmed event date.
create or replace function public.cast_secret_santa_vote(p_participant_id uuid, p_date date)
returns date
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event public.santa_event%rowtype;
begin
  select e.* into v_event from public.santa_event as e where e.id = 1 for update;
  if not v_event.voting_open or v_event.draw_complete then raise exception 'voting-is-closed'; end if;
  if p_date is null or p_date not in ('2026-12-04', '2026-12-11', '2026-12-18') then raise exception 'invalid-date'; end if;
  insert into public.santa_votes (participant_id, date, updated_at)
  values (p_participant_id, p_date, now())
  on conflict (participant_id) do update set date = excluded.date, updated_at = now();
  return p_date;
end;
$$;
revoke all on function public.cast_secret_santa_vote(uuid, date) from public, anon, authenticated;
grant execute on function public.cast_secret_santa_vote(uuid, date) to service_role;

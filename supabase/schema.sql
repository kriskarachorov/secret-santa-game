-- Run once in a fresh Supabase project. Public clients have no direct table access;
-- the Edge Function is the only route to this data.
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.santa_event (
  id smallint primary key default 1 check (id = 1),
  signups_open boolean not null default false,
  voting_open boolean not null default false,
  selected_date date null check (selected_date is null or selected_date in ('2026-12-04', '2026-12-11')),
  draw_complete boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.santa_event (id) values (1) on conflict (id) do nothing;

create table if not exists public.santa_participants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 50),
  name_normalized text not null unique,
  wishlist text not null default '' check (char_length(wishlist) <= 300),
  access_hash text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.santa_votes (
  participant_id uuid primary key references public.santa_participants(id) on delete cascade,
  date date not null check (date in ('2026-12-04', '2026-12-11')),
  updated_at timestamptz not null default now()
);

create table if not exists public.santa_assignments (
  giver_id uuid primary key references public.santa_participants(id) on delete cascade,
  recipient_id uuid not null unique references public.santa_participants(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (giver_id <> recipient_id)
);

alter table public.santa_event enable row level security;
alter table public.santa_participants enable row level security;
alter table public.santa_votes enable row level security;
alter table public.santa_assignments enable row level security;
revoke all on public.santa_event, public.santa_participants, public.santa_votes, public.santa_assignments from anon, authenticated;
grant all on public.santa_event, public.santa_participants, public.santa_votes, public.santa_assignments to service_role;

-- Atomic finalization. The Edge Function computes a cryptographically shuffled
-- derangement; this transaction validates and commits the complete draw at once.
create or replace function public.complete_secret_santa_draw(p_pairs jsonb, p_selected_date date)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
  v_event public.santa_event%rowtype;
  v_pair_count integer;
  v_giver_count integer;
  v_recipient_count integer;
  v_self_count integer;
begin
  select * into v_event from public.santa_event where id = 1 for update;
  if v_event.draw_complete then raise exception 'draw-already-complete'; end if;
  if p_selected_date not in ('2026-12-04', '2026-12-11') then raise exception 'invalid-date'; end if;

  select count(*) into v_count from public.santa_participants;
  if v_count < 2 then raise exception 'at-least-two-participants-required'; end if;
  if jsonb_typeof(p_pairs) <> 'array' then raise exception 'invalid-draw-pairs'; end if;
  select count(*), count(distinct x.giver_id), count(distinct x.recipient_id), count(*) filter (where x.giver_id = x.recipient_id)
    into v_pair_count, v_giver_count, v_recipient_count, v_self_count
    from jsonb_to_recordset(p_pairs) as x(giver_id uuid, recipient_id uuid);
  if v_pair_count <> v_count or v_giver_count <> v_count or v_recipient_count <> v_count or v_self_count <> 0 then
    raise exception 'invalid-draw-pairs';
  end if;

  insert into public.santa_assignments (giver_id, recipient_id)
  select x.giver_id, x.recipient_id from jsonb_to_recordset(p_pairs) as x(giver_id uuid, recipient_id uuid);

  update public.santa_event set
    signups_open = false,
    voting_open = false,
    selected_date = p_selected_date,
    draw_complete = true,
    updated_at = now()
  where id = 1;
end;
$$;
revoke all on function public.complete_secret_santa_draw(jsonb, date) from public, anon, authenticated;
grant execute on function public.complete_secret_santa_draw(jsonb, date) to service_role;

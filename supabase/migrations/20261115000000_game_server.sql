-- Game server state for Barangay Durian.
-- Accessed ONLY by the Vercel API with the service-role key. RLS is on with no policies,
-- and anon/authenticated have no grants, so a leaked anon key can read or write nothing.

create table public.players (
  address    text primary key check (address ~ '^0x[0-9a-f]{40}$'),
  stamina    real not null,
  stamina_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- One row per voucher issued. Used for rate limits and to audit suspicious mining.
create table public.swings (
  id         bigint generated always as identity primary key,
  address    text not null references public.players (address),
  spot_id    int not null,
  voucher_id text not null unique,
  ip_hash    text not null,
  created_at timestamptz not null default now()
);
create index swings_ip_time on public.swings (ip_hash, created_at);
create index swings_address_time on public.swings (address, created_at);

create table public.faucet_drips (
  id         bigint generated always as identity primary key,
  address    text not null,
  ip_hash    text not null,
  tx_hash    text not null,
  amount_wei numeric not null,
  created_at timestamptz not null default now()
);
create index faucet_drips_ip_time on public.faucet_drips (ip_hash, created_at);
create index faucet_drips_address_time on public.faucet_drips (address, created_at);
create index faucet_drips_time on public.faucet_drips (created_at);

-- tx_hash is the primary key: the same burn transaction can only be eaten once.
create table public.meals (
  tx_hash    text primary key check (tx_hash ~ '^0x[0-9a-f]{64}$'),
  address    text not null references public.players (address),
  item_id    int not null,
  stamina    real not null,
  created_at timestamptz not null default now()
);

alter table public.players      enable row level security;
alter table public.swings       enable row level security;
alter table public.faucet_drips enable row level security;
alter table public.meals        enable row level security;
revoke all on public.players, public.swings, public.faucet_drips, public.meals from anon, authenticated;

-- ------------------------------------------------------------------ functions
-- Stamina regenerates linearly: current = min(max, stored + seconds_since * regen).
-- Each function locks the player's row (FOR UPDATE) so concurrent requests serialize.

create function public.game_ensure_player(p_address text, p_max real)
returns table (value real, at timestamptz)
language sql
set search_path = ''
as $$
  insert into public.players (address, stamina) values (p_address, p_max)
  on conflict (address) do nothing;
  select stamina, stamina_at from public.players where address = p_address;
$$;

create function public.game_spend_stamina(p_address text, p_cost real, p_max real, p_regen real)
returns table (ok boolean, value real, at timestamptz)
language plpgsql
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_current real;
begin
  insert into public.players (address, stamina) values (p_address, p_max)
  on conflict (address) do nothing;

  select least(p_max, p.stamina + extract(epoch from (v_now - p.stamina_at))::real * p_regen)
    into v_current
    from public.players p
   where p.address = p_address
     for update;

  if v_current < p_cost then
    return query select false, v_current, v_now;
    return;
  end if;

  update public.players set stamina = v_current - p_cost, stamina_at = v_now where address = p_address;
  return query select true, v_current - p_cost, v_now;
end;
$$;

create function public.game_eat(
  p_tx_hash text, p_address text, p_item_id int, p_amount real, p_max real, p_regen real
)
returns table (ok boolean, value real, at timestamptz)
language plpgsql
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_next real;
begin
  insert into public.players (address, stamina) values (p_address, p_max)
  on conflict (address) do nothing;

  insert into public.meals (tx_hash, address, item_id, stamina)
  values (p_tx_hash, p_address, p_item_id, p_amount)
  on conflict (tx_hash) do nothing;
  if not found then
    return query select false, 0::real, v_now;  -- already eaten
    return;
  end if;

  select least(p_max, least(p_max, p.stamina + extract(epoch from (v_now - p.stamina_at))::real * p_regen) + p_amount)
    into v_next
    from public.players p
   where p.address = p_address
     for update;

  update public.players set stamina = v_next, stamina_at = v_now where address = p_address;
  return query select true, v_next, v_now;
end;
$$;

revoke execute on function public.game_ensure_player(text, real) from public, anon, authenticated;
revoke execute on function public.game_spend_stamina(text, real, real, real) from public, anon, authenticated;
revoke execute on function public.game_eat(text, text, int, real, real, real) from public, anon, authenticated;
grant execute on function public.game_ensure_player(text, real) to service_role;
grant execute on function public.game_spend_stamina(text, real, real, real) to service_role;
grant execute on function public.game_eat(text, text, int, real, real, real) to service_role;

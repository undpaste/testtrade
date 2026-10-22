alter table public.accounts
  add column if not exists reserved_balance numeric not null default 0,
  add column if not exists max_leverage numeric not null default 20;

alter table public.orders
  add column if not exists market_type text not null default 'crypto_perp',
  add column if not exists leverage numeric not null default 1,
  add column if not exists pool_address text,
  add column if not exists network text,
  add column if not exists trigger_price numeric,
  add column if not exists trailing_percent numeric,
  add column if not exists trailing_anchor numeric,
  add column if not exists time_in_force text not null default 'GTC',
  add column if not exists oco_group_id uuid;

alter table public.orders drop constraint if exists orders_order_type_check;
alter table public.orders drop constraint if exists orders_asset_class_check;
alter table public.orders
  add constraint orders_order_type_check
    check (order_type in ('market', 'limit', 'stop_loss', 'take_profit', 'trailing_stop')),
  add constraint orders_asset_class_check
    check (asset_class in ('crypto', 'stock', 'etf', 'crypto_perp', 'dex'));

alter table public.positions
  add column if not exists market_type text not null default 'crypto_spot',
  add column if not exists leverage numeric not null default 1,
  add column if not exists margin_used numeric not null default 0,
  add column if not exists liquidation_price numeric,
  add column if not exists funding_paid numeric not null default 0;

alter table public.positions drop constraint if exists positions_user_id_symbol_closed_at_key;
create unique index if not exists positions_one_open_per_market
  on public.positions (user_id, symbol) where closed_at is null;

create table if not exists public.oco_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'open' check (status in ('open', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_oco_group_id_fkey'
  ) then
    alter table public.orders
      add constraint orders_oco_group_id_fkey
      foreign key (oco_group_id) references public.oco_groups(id) on delete set null;
  end if;
end $$;

create table if not exists public.executions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  symbol text not null,
  asset_class text not null,
  side text not null check (side in ('buy', 'sell')),
  quantity numeric not null check (quantity > 0),
  price numeric not null check (price > 0),
  fee_amount numeric not null default 0,
  fee_currency text not null default 'USD',
  fee_breakdown jsonb not null default '{}'::jsonb,
  slippage_pct numeric not null default 0,
  liquidity_role text not null default 'taker' check (liquidity_role in ('maker', 'taker', 'simulated')),
  market_snapshot jsonb not null default '{}'::jsonb,
  pool_address text,
  network text,
  latency_ms integer not null default 0,
  executed_at timestamptz not null default now()
);

create table if not exists public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  entry_type text not null check (entry_type in (
    'seed', 'trade_debit', 'trade_credit', 'fee', 'funding', 'gas', 'adjustment'
  )),
  amount numeric not null,
  balance_after numeric not null,
  currency text not null default 'USD',
  reference_id uuid,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists public.closed_trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  symbol text not null,
  asset_class text not null,
  side text not null check (side in ('long', 'short')),
  quantity numeric not null check (quantity > 0),
  average_entry numeric not null,
  average_exit numeric not null,
  gross_pnl numeric not null,
  fees numeric not null default 0,
  funding numeric not null default 0,
  net_pnl numeric not null,
  opened_at timestamptz not null,
  closed_at timestamptz not null default now(),
  holding_seconds integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.fee_schedules (
  id uuid primary key default gen_random_uuid(),
  venue text not null,
  market_type text not null,
  maker_rate numeric not null default 0,
  taker_rate numeric not null default 0,
  pool_fee_rate numeric not null default 0,
  sec_sell_rate numeric not null default 0,
  finra_per_share numeric not null default 0,
  exchange_per_share numeric not null default 0,
  gas_units bigint not null default 0,
  borrow_apr numeric not null default 0,
  effective_from timestamptz not null default now(),
  effective_until timestamptz,
  unique (venue, market_type, effective_from)
);

create index if not exists orders_user_created_idx
  on public.orders (user_id, created_at desc);
create index if not exists orders_open_triggers_idx
  on public.orders (user_id, symbol, status) where status = 'pending';
create index if not exists executions_user_date_idx
  on public.executions (user_id, executed_at desc);
create index if not exists closed_trades_user_date_idx
  on public.closed_trades (user_id, closed_at desc);
create index if not exists ledger_user_date_idx
  on public.ledger_entries (user_id, created_at desc);

alter table public.oco_groups enable row level security;
alter table public.executions enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.closed_trades enable row level security;
alter table public.fee_schedules enable row level security;

drop policy if exists "own oco groups" on public.oco_groups;
create policy "own oco groups" on public.oco_groups for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own executions" on public.executions;
create policy "own executions" on public.executions for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own ledger entries" on public.ledger_entries;
create policy "own ledger entries" on public.ledger_entries for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own closed trades" on public.closed_trades;
create policy "own closed trades" on public.closed_trades for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "read fee schedules" on public.fee_schedules;
create policy "read fee schedules" on public.fee_schedules for select using (true);

grant select, insert, update, delete on public.oco_groups to authenticated;
grant select, insert, update, delete on public.executions to authenticated;
grant select on public.ledger_entries to authenticated;
grant select on public.closed_trades to authenticated;
grant select on public.fee_schedules to authenticated;

create or replace function public.settle_paper_fill(
  p_user_id uuid,
  p_order_id uuid,
  p_symbol text,
  p_asset_class text,
  p_market_type text,
  p_side text,
  p_order_type text,
  p_requested_qty numeric,
  p_filled_qty numeric,
  p_reference_price numeric,
  p_fill_price numeric,
  p_fee numeric,
  p_fee_breakdown jsonb,
  p_slippage_pct numeric,
  p_leverage numeric,
  p_trigger_price numeric,
  p_trailing_percent numeric,
  p_reason_entry text,
  p_notes text,
  p_funding numeric,
  p_market_snapshot jsonb,
  p_pool_address text,
  p_network text,
  p_oco_group_id uuid,
  p_latency_ms integer
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_account public.accounts%rowtype;
  v_position public.positions%rowtype;
  v_has_position boolean := false;
  v_order public.orders%rowtype;
  v_signed_qty numeric;
  v_old_qty numeric := 0;
  v_old_margin numeric := 0;
  v_close_qty numeric := 0;
  v_open_qty numeric := 0;
  v_margin_released numeric := 0;
  v_margin_required numeric := 0;
  v_realized_gross numeric := 0;
  v_realized_net numeric := 0;
  v_fee_close numeric := 0;
  v_new_qty numeric := 0;
  v_new_margin numeric := 0;
  v_new_avg numeric := 0;
  v_new_balance numeric := 0;
  v_new_equity numeric := 0;
  v_total_margin numeric := 0;
  v_total_unrealized numeric := 0;
  v_position_id uuid;
  v_closed_at timestamptz := now();
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'Not authorized to trade for this account';
  end if;
  if p_side not in ('buy', 'sell') or p_requested_qty <= 0 or p_filled_qty < 0
     or p_filled_qty > p_requested_qty or p_fill_price <= 0 or p_fee < 0
     or p_leverage < 1 then
    raise exception 'Invalid execution values';
  end if;

  select * into v_account
  from public.accounts
  where user_id = p_user_id
  for update;
  if not found then raise exception 'Paper account not found'; end if;
  if v_account.is_dead and (v_account.dead_until is null or v_account.dead_until > now()) then
    raise exception 'Paper account is locked';
  end if;
  if p_leverage > v_account.max_leverage then
    raise exception 'Requested leverage exceeds the account limit';
  end if;

  if p_order_id is not null then
    select * into v_order from public.orders
    where id = p_order_id and user_id = p_user_id and status = 'pending'
    for update;
    if not found then raise exception 'Pending order not found'; end if;
  end if;

  if p_filled_qty = 0 then
    if p_order_id is null then
      insert into public.orders (
        user_id, symbol, asset_class, market_type, leverage, side, order_type, qty, requested_price,
        filled_qty, status, reason_entry, notes, trigger_price, trailing_percent,
        trailing_anchor, pool_address, network, oco_group_id
      ) values (
        p_user_id, p_symbol, p_asset_class, p_market_type, p_leverage, p_side,
        p_order_type, p_requested_qty, p_reference_price, 0, 'pending', p_reason_entry, p_notes, p_trigger_price,
        p_trailing_percent, p_reference_price, p_pool_address, p_network, p_oco_group_id
      ) returning * into v_order;
    end if;
    return jsonb_build_object('order', to_jsonb(v_order), 'pending', true, 'newBalance', v_account.balance);
  end if;

  if p_market_type in ('stock', 'etf', 'crypto_spot', 'dex_spot') and p_side = 'sell' then
    select * into v_position
    from public.positions
    where user_id = p_user_id and symbol = p_symbol and closed_at is null
    for update;
    v_has_position := found;
    if not v_has_position or v_position.qty < p_filled_qty then
      raise exception 'Not enough units of % in the paper portfolio to sell', p_symbol;
    end if;
  else
    select * into v_position
    from public.positions
    where user_id = p_user_id and symbol = p_symbol and closed_at is null
    for update;
    v_has_position := found;
  end if;

  v_old_qty := case when v_has_position then v_position.qty else 0 end;
  v_old_margin := case when v_has_position then v_position.margin_used else 0 end;
  v_signed_qty := case when p_side = 'buy' then p_filled_qty else -p_filled_qty end;
  v_new_qty := v_old_qty + v_signed_qty;
  if v_old_qty <> 0 and sign(v_old_qty) <> sign(v_signed_qty) then
    v_close_qty := least(abs(v_old_qty), p_filled_qty);
  end if;
  v_open_qty := p_filled_qty - v_close_qty;
  v_realized_gross := case when v_close_qty > 0
    then (p_fill_price - v_position.avg_entry) * v_close_qty * sign(v_old_qty)
    else 0 end;
  v_fee_close := case when p_filled_qty > 0 then p_fee * v_close_qty / p_filled_qty else 0 end;
  v_realized_net := v_realized_gross - v_fee_close - p_funding;

  if p_market_type in ('crypto_perp', 'stock', 'etf') then
    v_margin_released := case when abs(v_old_qty) > 0
      then v_old_margin * v_close_qty / abs(v_old_qty) else 0 end;
    v_margin_required := v_open_qty * p_fill_price / p_leverage;
  else
    v_margin_released := v_close_qty * v_position.avg_entry;
    v_margin_required := v_open_qty * p_fill_price;
  end if;

  v_new_balance := v_account.balance + v_margin_released + v_realized_gross
    - v_margin_required - p_fee - p_funding;
  if v_new_balance < -0.00000001 then
    raise exception 'Insufficient available paper balance for this order and its fees';
  end if;
  v_new_margin := greatest(0, v_old_margin - v_margin_released) + v_margin_required;

  if v_new_qty = 0 then
    v_new_avg := v_position.avg_entry;
  elsif v_old_qty = 0 or sign(v_old_qty) <> sign(v_new_qty) then
    v_new_avg := p_fill_price;
  elsif sign(v_old_qty) = sign(v_signed_qty) then
    v_new_avg := (abs(v_old_qty) * v_position.avg_entry + p_filled_qty * p_fill_price) / abs(v_new_qty);
  else
    v_new_avg := v_position.avg_entry;
  end if;

  if p_order_id is null then
    insert into public.orders (
      user_id, symbol, asset_class, market_type, leverage, side, order_type, qty, requested_price,
      fill_price, filled_qty, fee_paid, slippage_pct, status, reason_entry,
      notes, trigger_price, trailing_percent, pool_address, network, oco_group_id
    ) values (
      p_user_id, p_symbol, p_asset_class, p_market_type, p_leverage, p_side,
      p_order_type, p_requested_qty,
      p_reference_price, p_fill_price, p_filled_qty, p_fee, p_slippage_pct,
      case when p_filled_qty < p_requested_qty then 'partial' else 'filled' end,
      p_reason_entry, p_notes, p_trigger_price, p_trailing_percent, p_pool_address, p_network, p_oco_group_id
    ) returning * into v_order;
  else
    update public.orders set
      fill_price = p_fill_price,
      filled_qty = p_filled_qty,
      fee_paid = p_fee,
      slippage_pct = p_slippage_pct,
      status = case when p_filled_qty < p_requested_qty then 'partial' else 'filled' end
    where id = p_order_id returning * into v_order;
  end if;

  if v_has_position then
    update public.positions set
      qty = v_new_qty,
      avg_entry = v_new_avg,
      realized_pnl = realized_pnl + v_realized_net,
      margin_used = v_new_margin,
      leverage = p_leverage,
      funding_paid = funding_paid + p_funding,
      liquidation_price = case
        when p_market_type = 'crypto_perp' and v_new_qty > 0 then v_new_avg * (1 - (1 / p_leverage) + 0.005)
        when p_market_type = 'crypto_perp' and v_new_qty < 0 then v_new_avg * (1 + (1 / p_leverage) - 0.005)
        else null
      end,
      closed_at = case when v_new_qty = 0 then v_closed_at else null end,
      opened_at = case
        when v_old_qty <> 0 and sign(v_old_qty) <> sign(v_new_qty) then v_closed_at
        else opened_at
      end
    where id = v_position.id;
    v_position_id := v_position.id;
  elsif v_new_qty <> 0 then
    insert into public.positions (
      user_id, symbol, asset_class, market_type, qty, avg_entry, realized_pnl,
      margin_used, leverage, liquidation_price, funding_paid, opened_at
    ) values (
      p_user_id, p_symbol, p_asset_class, p_market_type, v_new_qty, v_new_avg, 0,
      v_new_margin, p_leverage,
      case
        when p_market_type = 'crypto_perp' and v_new_qty > 0 then v_new_avg * (1 - (1 / p_leverage) + 0.005)
        when p_market_type = 'crypto_perp' and v_new_qty < 0 then v_new_avg * (1 + (1 / p_leverage) - 0.005)
        else null
      end,
      0, v_closed_at
    ) returning id into v_position_id;
  end if;

  insert into public.executions (
    user_id, order_id, symbol, asset_class, side, quantity, price,
    fee_amount, fee_currency, fee_breakdown, slippage_pct, liquidity_role,
    market_snapshot, pool_address, network, latency_ms
  ) values (
    p_user_id, v_order.id, p_symbol, p_asset_class, p_side, p_filled_qty, p_fill_price,
    p_fee, case when p_market_type = 'crypto_spot' then 'USDT' else 'USD' end,
    coalesce(p_fee_breakdown, '{}'::jsonb), p_slippage_pct,
    case when p_order_type = 'limit' then 'maker' else 'taker' end,
    coalesce(p_market_snapshot, '{}'::jsonb), p_pool_address, p_network, greatest(0, p_latency_ms)
  );

  if v_close_qty > 0 then
    insert into public.closed_trades (
      user_id, symbol, asset_class, side, quantity, average_entry, average_exit,
      gross_pnl, fees, funding, net_pnl, opened_at, closed_at, holding_seconds
    ) values (
      p_user_id, p_symbol, p_asset_class,
      case when v_old_qty > 0 then 'long' else 'short' end,
      v_close_qty, v_position.avg_entry, p_fill_price, v_realized_gross,
      v_fee_close, p_funding, v_realized_net, v_position.opened_at, v_closed_at,
      greatest(0, extract(epoch from (v_closed_at - v_position.opened_at))::integer)
    );
  end if;

  insert into public.ledger_entries (
    user_id, account_id, entry_type, amount, balance_after, currency, reference_id, description
  ) values (
    p_user_id, v_account.id, 'trade_debit',
    v_new_balance - v_account.balance, v_new_balance,
    case when p_market_type = 'crypto_spot' then 'USDT' else 'USD' end,
    v_order.id, p_side || ' ' || p_filled_qty || ' ' || p_symbol
  );

  if p_fee > 0 then
    insert into public.ledger_entries (
      user_id, account_id, entry_type, amount, balance_after, currency, reference_id, description
    ) values (
      p_user_id, v_account.id, 'fee', -p_fee, v_new_balance,
      case when p_market_type = 'crypto_spot' then 'USDT' else 'USD' end,
      v_order.id, 'Simulated trading and venue fees'
    );
  end if;

  if p_oco_group_id is not null then
    update public.orders set status = 'cancelled'
    where oco_group_id = p_oco_group_id and id <> v_order.id and status = 'pending';
    update public.oco_groups set status = 'completed', closed_at = v_closed_at
    where id = p_oco_group_id and user_id = p_user_id;
  end if;

  select coalesce(sum(margin_used), 0),
         coalesce(sum((case when symbol = p_symbol then p_fill_price else avg_entry end - avg_entry) * qty), 0)
  into v_total_margin, v_total_unrealized
  from public.positions
  where user_id = p_user_id and closed_at is null;
  v_new_equity := v_new_balance + v_total_margin + v_total_unrealized;

  update public.accounts set
    balance = v_new_balance,
    equity = v_new_equity,
    total_fees_paid = total_fees_paid + p_fee,
    total_trades = total_trades + 1,
    is_dead = case when v_new_equity <= 0 then true else is_dead end,
    dead_until = case when v_new_equity <= 0 then now() + interval '7 days' else dead_until end,
    updated_at = v_closed_at
  where id = v_account.id;

  return jsonb_build_object(
    'order', to_jsonb(v_order),
    'newBalance', v_new_balance,
    'equity', v_new_equity,
    'realizedPnl', v_realized_net,
    'fee', p_fee,
    'pending', false
  );
end;
$$;

grant execute on function public.settle_paper_fill(
  uuid, uuid, text, text, text, text, text, numeric, numeric, numeric,
  numeric, numeric, jsonb, numeric, numeric, numeric, numeric, text, text,
  numeric, jsonb, text, text, uuid, integer
) to authenticated;

create or replace function public.create_paper_oco_order(
  p_user_id uuid,
  p_symbol text,
  p_asset_class text,
  p_market_type text,
  p_side text,
  p_qty numeric,
  p_reference_price numeric,
  p_take_profit_price numeric,
  p_stop_loss_price numeric,
  p_reason_entry text,
  p_notes text,
  p_leverage numeric,
  p_pool_address text,
  p_network text
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_group public.oco_groups%rowtype;
  v_orders jsonb;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'Not authorized to create orders for this account';
  end if;
  if p_qty <= 0 or p_reference_price <= 0 or p_take_profit_price <= 0
     or p_stop_loss_price <= 0 or p_leverage < 1 then
    raise exception 'Invalid OCO order values';
  end if;

  insert into public.oco_groups (user_id)
  values (p_user_id)
  returning * into v_group;

  with created_orders as (
    insert into public.orders (
      user_id, symbol, asset_class, market_type, side, order_type, qty, requested_price,
      filled_qty, status, reason_entry, notes, trigger_price, pool_address, network,
      leverage, oco_group_id
    ) values
      (
        p_user_id, p_symbol, p_asset_class, p_market_type, p_side, 'take_profit',
        p_qty, p_reference_price, 0, 'pending', p_reason_entry, p_notes,
        p_take_profit_price, p_pool_address, p_network, p_leverage, v_group.id
      ),
      (
        p_user_id, p_symbol, p_asset_class, p_market_type, p_side, 'stop_loss',
        p_qty, p_reference_price, 0, 'pending', p_reason_entry, p_notes,
        p_stop_loss_price, p_pool_address, p_network, p_leverage, v_group.id
      )
    returning id, symbol, side, order_type, qty, status, trigger_price, created_at
  )
  select jsonb_agg(to_jsonb(created_orders)) into v_orders
  from created_orders;

  return jsonb_build_object('ocoGroupId', v_group.id, 'orders', coalesce(v_orders, '[]'::jsonb));
end;
$$;

grant execute on function public.create_paper_oco_order(
  uuid, text, text, text, text, numeric, numeric, numeric, numeric, text,
  text, numeric, text, text
) to authenticated;

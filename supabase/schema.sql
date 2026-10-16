-- =====================================================
-- USERS & PROFILES
-- =====================================================
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  username text unique not null,
  rating numeric default 1500,
  rating_deviation numeric default 350,
  rating_volatility numeric default 0.06,
  tier text default 'Bronze',
  created_at timestamptz default now()
);

-- =====================================================
-- ACCOUNT STATE (with death lockout)
-- =====================================================
create table accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  balance numeric not null default 1000,
  equity numeric not null default 1000,
  is_dead boolean default false,
  dead_until timestamptz,
  total_fees_paid numeric default 0,
  total_trades int default 0,
  season_start timestamptz default now(),
  real_money_multiplier numeric default 1.0,  -- for Real Money Widget
  updated_at timestamptz default now()
);

-- =====================================================
-- ORDERS
-- =====================================================
create table orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  symbol text not null,
  asset_class text not null check (asset_class in ('crypto','stock','etf')),
  side text not null check (side in ('buy','sell')),
  order_type text not null check (order_type in ('market','limit')),
  qty numeric not null,
  requested_price numeric,
  fill_price numeric,
  filled_qty numeric default 0,
  fee_paid numeric default 0,
  slippage_pct numeric default 0,
  status text default 'pending' check (status in ('pending','partial','filled','cancelled','rejected')),
  reason_entry text,                 -- ⭐ wajib diisi dari dropdown
  notes text,
  created_at timestamptz default now()
);

-- =====================================================
-- POSITIONS
-- =====================================================
create table positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  symbol text not null,
  asset_class text not null,
  qty numeric not null,
  avg_entry numeric not null,
  realized_pnl numeric default 0,
  opened_at timestamptz default now(),
  closed_at timestamptz,
  unique(user_id, symbol, closed_at)
);

-- =====================================================
-- TRADE JOURNAL (auto-generated)
-- =====================================================
create table journal (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  order_id uuid references orders(id),
  symbol text not null,
  side text not null,
  qty numeric not null,
  entry_price numeric,
  exit_price numeric,
  pnl numeric,
  pnl_pct numeric,
  reason_entry text,
  emotional_state text,              -- calm / fomo / revenge / bored
  screenshot_url text,
  duration_minutes int,
  created_at timestamptz default now()
);

-- =====================================================
-- REVENGE TRADING EVENTS
-- =====================================================
create table revenge_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  triggered_at timestamptz default now(),
  trigger_order_id uuid references orders(id),
  loss_amount numeric,
  size_multiplier numeric,
  frozen_until timestamptz
);

-- =====================================================
-- RLS POLICIES
-- =====================================================
alter table profiles enable row level security;
alter table accounts enable row level security;
alter table orders enable row level security;
alter table positions enable row level security;
alter table journal enable row level security;
alter table revenge_events enable row level security;

create policy "own profile" on profiles for all using (auth.uid() = id);
create policy "own account" on accounts for all using (auth.uid() = user_id);
create policy "own orders" on orders for all using (auth.uid() = user_id);
create policy "own positions" on positions for all using (auth.uid() = user_id);
create policy "own journal" on journal for all using (auth.uid() = user_id);
create policy "own revenge" on revenge_events for all using (auth.uid() = user_id);
npx create-next-app@latest testtrade --typescript --tailwind --app --no-src-dir
cd testtrade
npm install @supabase/supabase-js @supabase/ssr lightweight-charts zustand date-fns yahoo-finance2
npm install -D @types/node
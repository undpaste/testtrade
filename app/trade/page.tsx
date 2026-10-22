'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

type Account = {
  balance: number;
  total_fees_paid: number;
  is_dead: boolean;
};

type Market = {
  symbol: string;
  markPrice: number;
  change24hPct: number;
  volume24h: number;
  fundingRate: number;
  openInterest: number;
};

type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type BookLevel = { px: string; sz: string; n: number };

type MarketFeed = {
  source: string;
  updatedAt: number;
  markets: Market[];
  selected: string;
  markPrice: number;
  fundingRate: number;
  book: { bids: BookLevel[]; asks: BookLevel[] };
  candles: Candle[];
};

type Order = {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  qty: number;
  filled_qty: number;
  fill_price: number | null;
  fee_paid: number;
  status: string;
  created_at: string;
};

type Position = {
  id: string;
  symbol: string;
  asset_class: string;
  qty: number;
  avg_entry: number;
  realized_pnl: number;
  opened_at: string;
};

type OrderResult = {
  order: Order;
  fill: { fillPrice: number; filledQty: number; partial: boolean };
  newBalance: number;
};

const panel = 'rounded-xl border border-[#232936] bg-[#11151d]';
const inputClass = 'w-full rounded-lg border border-[#2c3442] bg-[#0b0e13] px-3 py-2.5 text-sm text-[#e7eaf0] outline-none transition focus:border-[#33c994]';
const numberFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

function formatPrice(price: number) {
  return price >= 1000
    ? price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

function formatCompact(value: number) {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(value);
}

function CandlestickChart({ candles }: { candles: Candle[] }) {
  if (!candles.length) {
    return <div className="flex h-[330px] items-center justify-center text-sm text-[#8993a4]">Waiting for candle data...</div>;
  }

  const width = 900;
  const height = 330;
  const padding = { top: 14, right: 70, bottom: 22, left: 12 };
  const values = candles.flatMap((candle) => [candle.high, candle.low]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, max * 0.0001, 0.000001);
  const chartHeight = height - padding.top - padding.bottom;
  const plotWidth = width - padding.left - padding.right;
  const y = (price: number) => padding.top + ((max - price) / range) * chartHeight;
  const gap = plotWidth / candles.length;
  const candleWidth = Math.max(2, Math.min(8, gap * 0.62));
  const lastPrice = candles[candles.length - 1].close;
  const gridPrices = [0, 1, 2, 3].map((index) => max - (range * index) / 3);

  return (
    <svg aria-label="One-minute candlestick chart" className="h-[330px] w-full" preserveAspectRatio="none" role="img" viewBox={`0 0 ${width} ${height}`}>
      {gridPrices.map((price) => (
        <g key={price}>
          <line x1={padding.left} x2={width - padding.right + 8} y1={y(price)} y2={y(price)} stroke="#222a36" strokeDasharray="3 5" />
          <text x={width - padding.right + 12} y={y(price) + 4} fill="#768194" fontSize="10">{formatPrice(price)}</text>
        </g>
      ))}
      {candles.map((candle, index) => {
        const x = padding.left + index * gap + gap / 2;
        const bullish = candle.close >= candle.open;
        const color = bullish ? '#31c98b' : '#f05d6b';
        const top = Math.min(y(candle.open), y(candle.close));
        const bodyHeight = Math.max(1.5, Math.abs(y(candle.open) - y(candle.close)));
        return (
          <g key={`${candle.time}-${index}`}>
            <line x1={x} x2={x} y1={y(candle.high)} y2={y(candle.low)} stroke={color} strokeWidth="1" />
            <rect x={x - candleWidth / 2} y={top} width={candleWidth} height={bodyHeight} fill={color} />
          </g>
        );
      })}
      <line x1={padding.left} x2={width - padding.right + 8} y1={y(lastPrice)} y2={y(lastPrice)} stroke="#38c995" strokeDasharray="4 4" />
      <rect x={width - padding.right + 7} y={y(lastPrice) - 9} width="68" height="18" rx="3" fill="#168b65" />
      <text x={width - padding.right + 41} y={y(lastPrice) + 4} fill="#fff" fontSize="10" textAnchor="middle">{formatPrice(lastPrice)}</text>
    </svg>
  );
}

function BookRows({ title, levels, side }: { title: string; levels: BookLevel[]; side: 'bid' | 'ask' }) {
  const maxSize = Math.max(...levels.map((level) => Number(level.sz)), 0);
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-[0.14em] text-[#778295]">
        <span>{title}</span><span>Price / Size</span>
      </div>
      <div className="space-y-1">
        {levels.map((level, index) => {
          const size = Number(level.sz);
          return (
            <div className="relative flex justify-between overflow-hidden rounded px-1.5 py-1 text-[11px] tabular-nums" key={`${level.px}-${index}`}>
              <div
                className={`absolute inset-y-0 ${side === 'bid' ? 'right-0 bg-[#1e8d65]/15' : 'right-0 bg-[#bd4f5b]/15'}`}
                style={{ width: `${maxSize ? (size / maxSize) * 78 : 0}%` }}
              />
              <span className={`relative ${side === 'bid' ? 'text-[#41ce98]' : 'text-[#f1747c]'}`}>{formatPrice(Number(level.px))}</span>
              <span className="relative text-[#adb6c5]">{numberFormat.format(size)}</span>
            </div>
          );
        })}
        {!levels.length && <p className="py-2 text-xs text-[#778295]">No order-book levels</p>}
      </div>
    </div>
  );
}

export default function TradePage() {
  const router = useRouter();
  const [account, setAccount] = useState<Account | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [feed, setFeed] = useState<MarketFeed | null>(null);
  const [selectedSymbol, setSelectedSymbol] = useState('BTC');
  const [search, setSearch] = useState('');
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [quantity, setQuantity] = useState('0.001');
  const [reasonEntry, setReasonEntry] = useState('');
  const [notes, setNotes] = useState('');
  const [highVolatilityMode, setHighVolatilityMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [marketLoading, setMarketLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [marketError, setMarketError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const refreshTradingData = useCallback(async (userId: string) => {
    const [{ data: accountData, error: accountError }, { data: orderData, error: ordersError }, { data: positionData, error: positionsError }] = await Promise.all([
      supabase.from('accounts').select('balance, total_fees_paid, is_dead').eq('user_id', userId).single(),
      supabase.from('orders').select('id, symbol, side, qty, filled_qty, fill_price, fee_paid, status, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(10),
      supabase.from('positions').select('id, symbol, asset_class, qty, avg_entry, realized_pnl, opened_at').eq('user_id', userId).is('closed_at', null).order('opened_at', { ascending: false }),
    ]);
    if (accountError) throw accountError;
    if (ordersError) throw ordersError;
    if (positionsError) throw positionsError;

    setAccount({
      balance: Number(accountData.balance),
      total_fees_paid: Number(accountData.total_fees_paid ?? 0),
      is_dead: Boolean(accountData.is_dead),
    });
    setOrders((orderData ?? []) as Order[]);
    setPositions((positionData ?? []) as Position[]);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      try {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        if (!session) {
          router.replace('/login');
          return;
        }

        const userId = session.user.id;
        const { error: profileError } = await supabase.from('profiles').upsert(
          { id: userId, username: `trader-${userId.slice(0, 8)}` },
          { onConflict: 'id', ignoreDuplicates: true }
        );
        if (profileError) throw profileError;

        const { data: existingAccount, error: accountError } = await supabase
          .from('accounts').select('id').eq('user_id', userId).maybeSingle();
        if (accountError) throw accountError;
        if (!existingAccount) {
          const { error: createError } = await supabase.from('accounts')
            .insert({ user_id: userId, balance: 1000, equity: 1000 });
          if (createError) throw createError;
        }

        await refreshTradingData(userId);
      } catch (error) {
        if (!cancelled) setErrorMessage(error instanceof Error ? error.message : String(error));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    init();
    return () => { cancelled = true; };
  }, [refreshTradingData, router]);

  useEffect(() => {
    let cancelled = false;
    const loadMarket = async () => {
      try {
        const response = await fetch(`/api/market?symbol=${encodeURIComponent(selectedSymbol)}`, { cache: 'no-store' });
        const data = await response.json() as MarketFeed | { error?: string };
        if (!response.ok || !('markets' in data)) {
          throw new Error('error' in data && data.error ? data.error : 'Could not load market data');
        }
        if (!cancelled) setFeed(data);
        if (!cancelled) setMarketError('');
      } catch (error) {
        if (!cancelled) setMarketError(error instanceof Error ? error.message : String(error));
      } finally {
        if (!cancelled) setMarketLoading(false);
      }
    };

    setMarketLoading(true);
    loadMarket();
    const timer = window.setInterval(loadMarket, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [selectedSymbol]);

  const selectedMarket = feed?.markets.find((market) => market.symbol === selectedSymbol);
  const bestBid = feed?.book.bids[0] ? Number(feed.book.bids[0].px) : 0;
  const bestAsk = feed?.book.asks[0] ? Number(feed.book.asks[0].px) : 0;
  const spread = bestBid && bestAsk ? bestAsk - bestBid : 0;
  const spreadPct = spread && feed?.markPrice ? (spread / feed.markPrice) * 100 : 0;
  const estimatedNotional = (Number(quantity) || 0) * (feed?.markPrice ?? 0);
  const estimatedTakerFee = estimatedNotional * 0.00045;
  const visibleMarkets = useMemo(() => {
    const markets = feed?.markets ?? [];
    const query = search.trim().toUpperCase();
    return markets.filter((market) => !query || market.symbol.includes(query)).slice(0, 40);
  }, [feed?.markets, search]);
  const totalUnrealized = positions.reduce((total, position) => {
    const mark = feed?.markets.find((market) => market.symbol === position.symbol)?.markPrice;
    return total + (mark ? (mark - Number(position.avg_entry)) * Number(position.qty) : 0);
  }, 0);
  const lockedMargin = positions.reduce((total, position) => total + Math.abs(Number(position.qty) * Number(position.avg_entry)), 0);
  const equity = (account?.balance ?? 0) + lockedMargin + totalUnrealized;
  const timestamp = feed?.updatedAt ? new Date(feed.updatedAt).toLocaleTimeString() : '--:--:--';

  const handlePlaceOrder = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setErrorMessage('');
    setSuccessMessage('');

    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!session) {
        router.replace('/login');
        return;
      }

      const response = await fetch('/api/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          symbol: selectedSymbol,
          side,
          qty: Number(quantity),
          reasonEntry,
          notes: notes.trim() || undefined,
          highVolatilityMode,
        }),
      });
      const result: OrderResult | { error?: string } = await response.json();
      if (!response.ok) throw new Error('error' in result && result.error ? result.error : 'Could not place order');
      if (!('order' in result)) throw new Error('Invalid order response');

      setSuccessMessage(`${result.fill.partial ? 'Partial fill' : 'Filled'} ${result.fill.filledQty.toFixed(6)} ${selectedSymbol} at $${formatPrice(result.fill.fillPrice)}.`);
      setNotes('');
      await refreshTradingData(session.user.id);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    const { error } = await supabase.auth.signOut();
    if (error) {
      setErrorMessage(error.message);
      setSigningOut(false);
      return;
    }
    router.replace('/login');
  };

  if (loading) {
    return <main className="flex min-h-screen items-center justify-center bg-[#0b0e13] text-sm text-[#a3adbc]">Loading your trading terminal...</main>;
  }

  return (
    <main className="min-h-screen bg-[#0b0e13] text-[#e7eaf0]">
      <header className="sticky top-0 z-20 border-b border-[#222936] bg-[#0e1219]/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1600px] items-center justify-between gap-4 px-4 lg:px-7">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#1b3b34] text-lg font-black text-[#40d09a]">T</div>
            <div>
              <p className="text-sm font-bold tracking-wide">TRADELAB <span className="font-normal text-[#7f8a9b]">/ TERMINAL</span></p>
              <p className="text-[10px] tracking-wide text-[#647184]">SIMULATED EXECUTION · LIVE MARKET DATA</p>
            </div>
          </div>
          <div className="hidden items-center gap-2 rounded-full border border-[#245442] bg-[#10251e] px-3 py-1.5 text-xs text-[#54d5a2] sm:flex">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#40d09a]" />
            Hyperliquid public feed
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden text-right sm:block">
              <p className="text-[10px] uppercase tracking-wider text-[#7a8595]">Paper equity</p>
              <p className="text-sm font-semibold tabular-nums">${numberFormat.format(equity)}</p>
            </div>
            <button className="rounded-lg border border-[#303847] px-3 py-2 text-xs text-[#aeb7c5] transition hover:border-[#586477] hover:text-white disabled:opacity-50" disabled={signingOut} onClick={handleSignOut}>
              {signingOut ? 'Signing out...' : 'Sign out'}
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1600px] p-3 lg:p-5">
        <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">
          <div className={`${panel} px-4 py-3`}>
            <p className="text-[10px] uppercase tracking-[0.14em] text-[#748094]">Available balance</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">${numberFormat.format(account?.balance ?? 0)}</p>
          </div>
          <div className={`${panel} px-4 py-3`}>
            <p className="text-[10px] uppercase tracking-[0.14em] text-[#748094]">Unrealized PnL</p>
            <p className={`mt-1 text-lg font-semibold tabular-nums ${totalUnrealized >= 0 ? 'text-[#43cc98]' : 'text-[#f1717c]'}`}>
              {totalUnrealized >= 0 ? '+' : ''}${numberFormat.format(totalUnrealized)}
            </p>
          </div>
          <div className={`${panel} px-4 py-3`}>
            <p className="text-[10px] uppercase tracking-[0.14em] text-[#748094]">Trading fees paid</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">${numberFormat.format(account?.total_fees_paid ?? 0)}</p>
          </div>
          <div className={`${panel} px-4 py-3`}>
            <p className="text-[10px] uppercase tracking-[0.14em] text-[#748094]">Account status</p>
            <p className={`mt-1 text-lg font-semibold ${account?.is_dead ? 'text-[#f1717c]' : 'text-[#43cc98]'}`}>{account?.is_dead ? 'LOCKED' : 'PAPER · ACTIVE'}</p>
          </div>
        </div>

        {errorMessage && <div role="alert" className="mb-4 rounded-lg border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">{errorMessage}</div>}
        {marketError && <div role="alert" className="mb-4 rounded-lg border border-amber-800 bg-amber-950/30 p-3 text-sm text-amber-200">Market feed: {marketError}. Showing the last available quote.</div>}

        <div className="grid items-start gap-3 xl:grid-cols-[220px_minmax(0,1fr)_300px]">
          <aside className={`${panel} overflow-hidden`}>
            <div className="border-b border-[#232936] p-3">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-[0.14em]">Markets</h2>
                <span className="text-[10px] text-[#748094]">{visibleMarkets.length} shown</span>
              </div>
              <input aria-label="Search markets" className={inputClass} onChange={(event) => setSearch(event.target.value)} placeholder="Search market" value={search} />
            </div>
            <div className="max-h-[600px] overflow-y-auto p-1.5">
              {visibleMarkets.map((market) => (
                <button
                  className={`mb-1 flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left transition ${selectedSymbol === market.symbol ? 'bg-[#1b302c] ring-1 ring-inset ring-[#285641]' : 'hover:bg-[#1a202a]'}`}
                  key={market.symbol}
                  onClick={() => setSelectedSymbol(market.symbol)}
                >
                  <span>
                    <span className="block text-xs font-semibold">{market.symbol}<span className="ml-1 font-normal text-[#6f7b8d]">-PERP</span></span>
                    <span className="mt-1 block text-[10px] text-[#788497]">Vol ${formatCompact(market.volume24h)}</span>
                  </span>
                  <span className="text-right">
                    <span className="block text-xs tabular-nums">${formatPrice(market.markPrice)}</span>
                    <span className={`mt-1 block text-[10px] tabular-nums ${market.change24hPct >= 0 ? 'text-[#43cc98]' : 'text-[#f1717c]'}`}>
                      {market.change24hPct >= 0 ? '+' : ''}{market.change24hPct.toFixed(2)}%
                    </span>
                  </span>
                </button>
              ))}
              {!visibleMarkets.length && <p className="p-4 text-xs text-[#778295]">No matching market.</p>}
            </div>
          </aside>

          <section className="min-w-0 space-y-3">
            <div className={`${panel} p-4`}>
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h1 className="text-xl font-bold">{selectedSymbol}<span className="ml-1 text-sm font-normal text-[#8290a3]">PERP</span></h1>
                    <span className="rounded bg-[#1a222d] px-2 py-1 text-[10px] text-[#9ba6b6]">USDC</span>
                  </div>
                  <p className="mt-1 text-[10px] text-[#788497]">Perpetual market · paper fills only</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-[#788497]">Mark price</p>
                  <p className="mt-0.5 text-2xl font-semibold tabular-nums">
                    {feed ? `$${formatPrice(feed.markPrice)}` : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-[#788497]">24h change</p>
                  <p className={`mt-0.5 text-sm font-semibold tabular-nums ${(selectedMarket?.change24hPct ?? 0) >= 0 ? 'text-[#43cc98]' : 'text-[#f1717c]'}`}>
                    {selectedMarket ? `${selectedMarket.change24hPct >= 0 ? '+' : ''}${selectedMarket.change24hPct.toFixed(2)}%` : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-[#788497]">24h volume</p>
                  <p className="mt-0.5 text-sm font-medium tabular-nums">${formatCompact(selectedMarket?.volume24h ?? 0)}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-[#788497]">Funding / 8h</p>
                  <p className="mt-0.5 text-sm font-medium tabular-nums">{feed ? `${(feed.fundingRate * 100).toFixed(4)}%` : '—'}</p>
                </div>
              </div>
            </div>

            <div className={`${panel} p-3 sm:p-4`}>
              <div className="mb-2 flex items-center justify-between">
                <div>
                  <h2 className="text-xs font-semibold">Price chart <span className="ml-1 font-normal text-[#7d899a]">1m</span></h2>
                  <p className="mt-1 text-[10px] text-[#6f7b8d]">Live public-market candles · {marketLoading ? 'updating' : `updated ${timestamp}`}</p>
                </div>
                <span className="rounded border border-[#293240] px-2 py-1 text-[10px] text-[#99a4b4]">100 bars</span>
              </div>
              <CandlestickChart candles={feed?.candles ?? []} />
            </div>

            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(210px,0.7fr)]">
              <div className={`${panel} p-4`}>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-xs font-semibold uppercase tracking-[0.12em]">Positions</h2>
                  <span className="text-[10px] text-[#788497]">{positions.length} open</span>
                </div>
                {positions.length ? (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[450px] text-left text-xs">
                      <thead className="text-[10px] uppercase tracking-wider text-[#768295]">
                        <tr><th className="pb-2">Market</th><th className="pb-2">Size</th><th className="pb-2">Entry</th><th className="pb-2">Mark</th><th className="pb-2 text-right">Unrealized</th></tr>
                      </thead>
                      <tbody>
                        {positions.map((position) => {
                          const mark = feed?.markets.find((market) => market.symbol === position.symbol)?.markPrice;
                          const pnl = mark ? (mark - Number(position.avg_entry)) * Number(position.qty) : 0;
                          return (
                            <tr className="border-t border-[#242b36]" key={position.id}>
                              <td className="py-2.5 font-semibold">{position.symbol}<span className={`ml-1 text-[9px] font-normal ${Number(position.qty) >= 0 ? 'text-[#43cc98]' : 'text-[#f1717c]'}`}>{Number(position.qty) >= 0 ? 'LONG' : 'SHORT'}</span></td>
                              <td className="py-2.5 tabular-nums">{numberFormat.format(Math.abs(Number(position.qty)))}</td>
                              <td className="py-2.5 tabular-nums">${formatPrice(Number(position.avg_entry))}</td>
                              <td className="py-2.5 tabular-nums">{mark ? `$${formatPrice(mark)}` : '—'}</td>
                              <td className={`py-2.5 text-right tabular-nums ${pnl >= 0 ? 'text-[#43cc98]' : 'text-[#f1717c]'}`}>{pnl >= 0 ? '+' : ''}${numberFormat.format(pnl)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : <p className="py-4 text-xs text-[#788497]">No open positions. Filled buy orders appear here.</p>}
              </div>

              <div className={`${panel} p-4`}>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-xs font-semibold uppercase tracking-[0.12em]">Order book</h2>
                  <span className="text-[10px] text-[#788497]">Top levels</span>
                </div>
                <BookRows title="Asks" levels={[...(feed?.book.asks ?? [])].slice(0, 6).reverse()} side="ask" />
                <div className="my-2 flex items-center justify-between border-y border-[#252d39] py-2 text-xs">
                  <span className="font-semibold tabular-nums">${feed ? formatPrice(feed.markPrice) : '—'}</span>
                  <span className="text-[10px] text-[#768295]">Spread {spread ? `${formatPrice(spread)} (${spreadPct.toFixed(3)}%)` : '—'}</span>
                </div>
                <BookRows title="Bids" levels={(feed?.book.bids ?? []).slice(0, 6)} side="bid" />
              </div>
            </div>

            <div className={`${panel} p-4`}>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-[0.12em]">Recent orders</h2>
                <span className="text-[10px] text-[#788497]">Latest 10</span>
              </div>
              {orders.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] text-left text-xs">
                    <thead className="text-[10px] uppercase tracking-wider text-[#768295]">
                      <tr><th className="pb-2">Market</th><th className="pb-2">Side</th><th className="pb-2">Filled</th><th className="pb-2">Fill price</th><th className="pb-2">Fee</th><th className="pb-2">Status</th><th className="pb-2 text-right">Time</th></tr>
                    </thead>
                    <tbody>
                      {orders.map((order) => (
                        <tr className="border-t border-[#242b36]" key={order.id}>
                          <td className="py-2.5 font-semibold">{order.symbol}</td>
                          <td className={`py-2.5 uppercase ${order.side === 'buy' ? 'text-[#43cc98]' : 'text-[#f1717c]'}`}>{order.side}</td>
                          <td className="py-2.5 tabular-nums">{numberFormat.format(Number(order.filled_qty || 0))}</td>
                          <td className="py-2.5 tabular-nums">{order.fill_price === null ? '—' : `$${formatPrice(Number(order.fill_price))}`}</td>
                          <td className="py-2.5 tabular-nums">${numberFormat.format(Number(order.fee_paid || 0))}</td>
                          <td className="py-2.5 capitalize">{order.status}</td>
                          <td className="py-2.5 text-right text-[10px] text-[#8792a2]">{new Date(order.created_at).toLocaleTimeString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="py-3 text-xs text-[#788497]">No order history yet.</p>}
            </div>
          </section>

          <aside className={`${panel} p-4 xl:sticky xl:top-[84px]`}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Place paper order</h2>
              <span className="rounded bg-[#19362d] px-2 py-1 text-[9px] font-semibold tracking-wider text-[#55d7a4]">SIMULATED</span>
            </div>

            {account?.is_dead ? (
              <div className="rounded-lg border border-red-900 bg-red-950/30 p-3 text-sm text-red-300">Your paper account is locked.</div>
            ) : (
              <form className="space-y-4" onSubmit={handlePlaceOrder}>
                <div className="grid grid-cols-2 rounded-lg bg-[#0b0e13] p-1">
                  <button className={`rounded-md py-2 text-xs font-semibold transition ${side === 'buy' ? 'bg-[#1a8c63] text-white' : 'text-[#8d98a9] hover:text-white'}`} onClick={() => setSide('buy')} type="button">Buy / Long</button>
                  <button className={`rounded-md py-2 text-xs font-semibold transition ${side === 'sell' ? 'bg-[#bd4f5b] text-white' : 'text-[#8d98a9] hover:text-white'}`} onClick={() => setSide('sell')} type="button">Sell / Short</button>
                </div>

                <div className="rounded-lg border border-[#272f3b] bg-[#0d1118] p-3">
                  <div className="flex items-center justify-between text-[10px] text-[#788497]"><span>Market</span><span>Market order</span></div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="font-semibold">{selectedSymbol}-PERP</span>
                    <span className="tabular-nums">${feed ? formatPrice(feed.markPrice) : 'Loading...'}</span>
                  </div>
                  <p className="mt-2 text-[10px] leading-relaxed text-[#778395]">The server uses a fresh market quote when your simulated order is submitted.</p>
                </div>

                <label className="block space-y-1.5 text-xs">
                  <span className="flex justify-between text-[#aeb7c5]"><span>Quantity ({selectedSymbol})</span><span>Available ${numberFormat.format(account?.balance ?? 0)}</span></span>
                  <input className={inputClass} min="0.000001" onChange={(event) => setQuantity(event.target.value)} required step="any" type="number" value={quantity} />
                  <span className="flex flex-wrap gap-1.5 pt-1">
                    {[0.25, 0.5, 0.75, 1].map((fraction) => (
                      <button className="rounded border border-[#303847] px-2 py-1 text-[10px] text-[#8c98a9] hover:border-[#596678] hover:text-white" key={fraction} onClick={() => {
                        const notional = (account?.balance ?? 0) * fraction;
                        setQuantity(feed?.markPrice ? (notional / feed.markPrice).toFixed(6) : '0');
                      }} type="button">{fraction === 1 ? 'Max' : `${fraction * 100}%`}</button>
                    ))}
                  </span>
                </label>

                <label className="block space-y-1.5 text-xs">
                  <span className="text-[#aeb7c5]">Trade reason</span>
                  <select className={inputClass} onChange={(event) => setReasonEntry(event.target.value)} required value={reasonEntry}>
                    <option value="" disabled>Select a reason</option>
                    <option value="breakout">Breakout</option>
                    <option value="support_bounce">Support bounce</option>
                    <option value="trend_follow">Trend follow</option>
                    <option value="news">News catalyst</option>
                    <option value="fomo">FOMO</option>
                    <option value="revenge">Revenge</option>
                    <option value="boredom">Boredom</option>
                    <option value="signal">Signal</option>
                  </select>
                </label>

                <label className="block space-y-1.5 text-xs">
                  <span className="text-[#aeb7c5]">Notes <span className="text-[#657184]">(optional)</span></span>
                  <textarea className={inputClass} onChange={(event) => setNotes(event.target.value)} placeholder="Your trade thesis..." rows={2} value={notes} />
                </label>

                <label className="flex cursor-pointer items-center justify-between rounded-lg border border-[#2b3340] px-3 py-2.5 text-xs">
                  <span>
                    <span className="block text-[#c5ccd6]">High volatility simulation</span>
                    <span className="mt-0.5 block text-[10px] text-[#718094]">Wider modeled slippage</span>
                  </span>
                  <input checked={highVolatilityMode} className="accent-[#34c993]" onChange={(event) => setHighVolatilityMode(event.target.checked)} type="checkbox" />
                </label>

                <div className="space-y-1 rounded-lg bg-[#0d1118] p-3 text-[11px]">
                  <div className="flex justify-between text-[#8a96a7]"><span>Estimated notional</span><span className="tabular-nums">${numberFormat.format(estimatedNotional)}</span></div>
                  <div className="flex justify-between text-[#8a96a7]"><span>Estimated taker fee (0.045%)</span><span className="tabular-nums">${numberFormat.format(estimatedTakerFee)}</span></div>
                  <div className="flex justify-between text-[#8a96a7]"><span>Spread</span><span className="tabular-nums">{spread ? `${spreadPct.toFixed(3)}%` : '—'}</span></div>
                  <div className="flex justify-between text-[#8a96a7]"><span>Funding rate</span><span className="tabular-nums">{feed ? `${(feed.fundingRate * 100).toFixed(4)}% / 8h` : '—'}</span></div>
                  <p className="pt-1 text-[10px] leading-relaxed text-[#687588]">Fees use Hyperliquid&apos;s base perp taker rate. Slippage uses live volume and volatility; funding is estimated at close from the current rate. No wallet or real orders.</p>
                </div>

                {successMessage && <p className="rounded-lg border border-[#245442] bg-[#10251e] p-2.5 text-xs text-[#55d7a4]" role="status">{successMessage}</p>}
                {errorMessage && account && <p className="rounded-lg border border-red-900 bg-red-950/30 p-2.5 text-xs text-red-300" role="alert">{errorMessage}</p>}

                <button className={`w-full rounded-lg py-3 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-45 ${side === 'buy' ? 'bg-[#22966c] hover:bg-[#28aa7b]' : 'bg-[#be505d] hover:bg-[#d15a68]'}`} disabled={submitting || !feed || !reasonEntry || !Number(quantity)} type="submit">
                  {submitting ? 'Simulating fill...' : `${side === 'buy' ? 'Buy' : 'Sell'} ${selectedSymbol}`}
                </button>
                <p className="text-[10px] text-[#778395]">Paper perpetuals use 1× simulated collateral. Short positions are supported.</p>
              </form>
            )}
          </aside>
        </div>

        <footer className="mt-4 flex flex-wrap items-center justify-between gap-2 px-1 text-[10px] text-[#687588]">
          <span>Public quotes from Hyperliquid · This app is a paper-trading simulator, not the Hyperliquid testnet.</span>
          <span>{feed ? `Market data updated ${timestamp}` : 'Connecting to public market data...'}</span>
        </footer>
      </div>
    </main>
  );
}

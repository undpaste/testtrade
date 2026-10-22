'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { MarketAssetClass, MarketSummary, MarketType } from '@/lib/marketData';
import { calculateFee, OrderContext } from '@/lib/realism';

type Account = {
  balance: number;
  equity: number;
  total_fees_paid: number;
  is_dead: boolean;
};

type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };
type BookLevel = { px: string; sz: string; n: number };
type MarketFeed = {
  source: string;
  updatedAt: number;
  market: MarketSummary;
  bookSource: 'exchange' | 'simulated';
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
  fee_breakdown?: Record<string, number>;
  order_type?: string;
  market_type?: string;
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
  margin_used: number;
  leverage: number;
  liquidation_price: number | null;
  opened_at: string;
};

type OrderResult = {
  order?: Order;
  orders?: Order[];
  pending?: boolean;
  fill?: { fillPrice: number; filledQty: number; partial: boolean };
  newBalance?: number;
  error?: string;
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

function PerformanceChart({ points }: { points: Array<{ date: string; equity: number }> }) {
  if (!points.length) {
    return <div className="flex h-24 items-center justify-center text-xs text-[#758195]">Close a trade to start your equity curve.</div>;
  }
  const values = [1000, ...points.map((point) => point.equity)];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 1);
  const polyline = values.map((value, index) =>
    `${(index / Math.max(values.length - 1, 1)) * 600},${76 - ((value - min) / range) * 64}`
  ).join(' ');

  return (
    <div>
      <svg aria-label="Paper account realized equity curve" className="h-24 w-full" preserveAspectRatio="none" role="img" viewBox="0 0 600 84">
        <line x1="0" x2="600" y1="76" y2="76" stroke="#2a3340" strokeDasharray="4 5" />
        <polyline fill="none" points={polyline} stroke="#42d09a" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" />
      </svg>
      <div className="flex justify-between text-[10px] text-[#788497]">
        <span>{points[0].date}</span><span>{points[points.length - 1].date}</span>
      </div>
    </div>
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
  const [closedTrades, setClosedTrades] = useState<Array<{ net_pnl: number; closed_at: string }>>([]);
  const [feed, setFeed] = useState<MarketFeed | null>(null);
  const [selectedSymbol, setSelectedSymbol] = useState('BTC');
  const [assetClass, setAssetClass] = useState<MarketAssetClass>('crypto');
  const [marketType, setMarketType] = useState<MarketType>('crypto_perp');
  const [catalog, setCatalog] = useState<MarketSummary[]>([]);
  const [search, setSearch] = useState('');
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [orderType, setOrderType] = useState<'market' | 'limit' | 'stop_loss' | 'take_profit' | 'trailing_stop' | 'oco'>('market');
  const [quantity, setQuantity] = useState('0.001');
  const [limitPrice, setLimitPrice] = useState('');
  const [triggerPrice, setTriggerPrice] = useState('');
  const [takeProfitPrice, setTakeProfitPrice] = useState('');
  const [stopLossPrice, setStopLossPrice] = useState('');
  const [trailingPercent, setTrailingPercent] = useState('1');
  const [leverage, setLeverage] = useState('1');
  const [reasonEntry, setReasonEntry] = useState('');
  const [notes, setNotes] = useState('');
  const [highVolatilityMode, setHighVolatilityMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [marketLoading, setMarketLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [cancellingOrderId, setCancellingOrderId] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [marketError, setMarketError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const refreshTradingData = useCallback(async (userId: string) => {
    const [{ data: accountData, error: accountError }, { data: orderData, error: ordersError }, { data: positionData, error: positionsError }, { data: closedData, error: closedError }] = await Promise.all([
      supabase.from('accounts').select('balance, equity, total_fees_paid, is_dead').eq('user_id', userId).single(),
      supabase.from('orders').select('id, symbol, side, qty, filled_qty, fill_price, fee_paid, status, created_at, order_type, market_type').eq('user_id', userId).order('created_at', { ascending: false }).limit(5000),
      supabase.from('positions').select('id, symbol, asset_class, qty, avg_entry, realized_pnl, margin_used, leverage, liquidation_price, opened_at').eq('user_id', userId).is('closed_at', null).order('opened_at', { ascending: false }),
      supabase.from('closed_trades').select('net_pnl, closed_at').eq('user_id', userId).order('closed_at', { ascending: true }).limit(5000),
    ]);
    if (accountError) throw accountError;
    if (ordersError) throw ordersError;
    if (positionsError) throw positionsError;
    if (closedError) throw closedError;

    setAccount({
      balance: Number(accountData.balance),
      equity: Number(accountData.equity ?? accountData.balance),
      total_fees_paid: Number(accountData.total_fees_paid ?? 0),
      is_dead: Boolean(accountData.is_dead),
    });
    setOrders((orderData ?? []) as Order[]);
    setPositions((positionData ?? []) as Position[]);
    setClosedTrades((closedData ?? []).map((trade) => ({ net_pnl: Number(trade.net_pnl), closed_at: trade.closed_at })));
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
    const timeout = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ assetClass, q: search.trim() });
        const response = await fetch(`/api/markets?${params.toString()}`, { cache: 'no-store' });
        const data = await response.json() as { markets?: MarketSummary[]; error?: string };
        if (!response.ok || !data.markets) throw new Error(data.error ?? 'Could not load markets');
        if (!cancelled) setCatalog(data.markets);
      } catch (error) {
        if (!cancelled) setMarketError(error instanceof Error ? error.message : String(error));
      }
    }, search ? 350 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [assetClass, search]);

  useEffect(() => {
    if (assetClass === 'dex' && !selectedSymbol && catalog.length > 0) {
      setSelectedSymbol(catalog[0].symbol);
      setMarketType('dex_spot');
    }
  }, [assetClass, catalog, selectedSymbol]);

  useEffect(() => {
    let cancelled = false;
    const loadMarket = async () => {
      try {
        const selectedPool = catalog.find((market) => market.symbol === selectedSymbol);
        const params = new URLSearchParams({
          symbol: selectedSymbol,
          assetClass,
          marketType,
        });
        if (selectedPool?.poolAddress) params.set('poolAddress', selectedPool.poolAddress);
        if (selectedPool?.network) params.set('network', selectedPool.network);
        const response = await fetch(`/api/market?${params.toString()}`, { cache: 'no-store' });
        const data = await response.json() as MarketFeed | { error?: string };
        if (!response.ok || !('market' in data)) {
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
    const timer = window.setInterval(loadMarket, assetClass === 'crypto' ? 5_000 : 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [assetClass, marketType, selectedSymbol]);

  useEffect(() => {
    let cancelled = false;
    const evaluatePendingOrders = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session || cancelled) return;
      try {
        const response = await fetch('/api/orders/evaluate', {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const result = await response.json() as { results?: Array<{ result?: { pending?: boolean } }> };
        if (response.ok && result.results?.some((entry) => entry.result?.pending === false) && !cancelled) {
          await refreshTradingData(session.user.id);
        } else if (!response.ok && !cancelled) {
          const errorResult = result as { error?: string };
          setMarketError(errorResult.error ?? 'Unable to check pending orders');
        }
      } catch (error) {
        if (!cancelled) setMarketError(error instanceof Error ? error.message : 'Unable to check pending orders');
      }
    };
    const timer = window.setInterval(evaluatePendingOrders, 8_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [refreshTradingData]);

  const selectedMarket = feed?.market;
  const bestBid = feed?.book.bids[0] ? Number(feed.book.bids[0].px) : 0;
  const bestAsk = feed?.book.asks[0] ? Number(feed.book.asks[0].px) : 0;
  const spread = bestBid && bestAsk ? bestAsk - bestBid : 0;
  const currentPrice = feed?.market.markPrice ?? 0;
  const spreadPct = spread && currentPrice ? (spread / currentPrice) * 100 : 0;
  const estimatedNotional = (Number(quantity) || 0) * currentPrice;
  const estimatedFeeContext: OrderContext = {
    symbol: selectedSymbol,
    assetClass: marketType === 'crypto_spot' || marketType === 'crypto_perp' ? 'crypto' : assetClass,
    marketType,
    side,
    orderType: orderType === 'limit' ? 'limit' : 'market',
    qty: Number(quantity) || 0,
    requestedPrice: currentPrice,
    avgDailyVolume: selectedMarket?.volume24h ?? 1,
    highVolatilityMode,
    recentVolatility: selectedMarket ? Math.abs(selectedMarket.change24hPct / 100) : 0,
  };
  const estimatedFee = calculateFee(
    estimatedFeeContext,
    currentPrice,
    Number(quantity) || 0,
    orderType === 'limit'
  );
  const visibleMarkets = useMemo(() => {
    const markets = catalog.filter((market) => assetClass !== 'crypto' || market.marketType === marketType);
    return markets.slice(0, 100);
  }, [assetClass, catalog, marketType]);
  const totalUnrealized = positions.reduce((total, position) => {
    const mark = position.symbol === selectedSymbol
      ? currentPrice
      : catalog.find((market) => market.symbol === position.symbol)?.markPrice;
    return total + (mark ? (mark - Number(position.avg_entry)) * Number(position.qty) : 0);
  }, 0);
  const totalMarginUsed = positions.reduce((total, position) => total + Number(position.margin_used ?? 0), 0);
  const equity = Number(account?.balance ?? 0) + totalMarginUsed + totalUnrealized;
  const timestamp = feed?.updatedAt ? new Date(feed.updatedAt).toLocaleTimeString() : '--:--:--';
  const winningTrades = closedTrades.filter((trade) => trade.net_pnl > 0).length;
  const losingTrades = closedTrades.filter((trade) => trade.net_pnl < 0).length;
  const winRate = closedTrades.length ? (winningTrades / closedTrades.length) * 100 : 0;
  const grossWins = closedTrades.reduce((total, trade) => total + Math.max(0, trade.net_pnl), 0);
  const grossLosses = closedTrades.reduce((total, trade) => total + Math.abs(Math.min(0, trade.net_pnl)), 0);
  const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Number.POSITIVE_INFINITY : 0;
  const realizedPnl = closedTrades.reduce((total, trade) => total + trade.net_pnl, 0);
  const dailyEquityCurve = useMemo(() => {
    const dailyPnl = new Map<string, number>();
    for (const trade of closedTrades) {
      const day = trade.closed_at.slice(0, 10);
      dailyPnl.set(day, (dailyPnl.get(day) ?? 0) + trade.net_pnl);
    }
    let equityValue = 1000;
    return Array.from(dailyPnl, ([date, pnl]) => {
      equityValue += pnl;
      return { date, pnl, equity: equityValue };
    });
  }, [closedTrades]);
  const maxDrawdownPct = (() => {
    let peak = 1000;
    let maxDrawdown = 0;
    for (const point of dailyEquityCurve) {
      peak = Math.max(peak, point.equity);
      if (peak > 0) maxDrawdown = Math.max(maxDrawdown, (peak - point.equity) / peak);
    }
    return maxDrawdown * 100;
  })();
  const dailyReturns = dailyEquityCurve.map((point, index) =>
    (point.equity - (index ? dailyEquityCurve[index - 1].equity : 1000)) /
      Math.max(index ? dailyEquityCurve[index - 1].equity : 1000, 1)
  );
  const meanDailyReturn = dailyReturns.length
    ? dailyReturns.reduce((sum, value) => sum + value, 0) / dailyReturns.length
    : 0;
  const dailyVariance = dailyReturns.length > 1
    ? dailyReturns.reduce((sum, value) => sum + (value - meanDailyReturn) ** 2, 0) / (dailyReturns.length - 1)
    : 0;
  const sharpeRatio = dailyVariance > 0
    ? (meanDailyReturn / Math.sqrt(dailyVariance)) * Math.sqrt(252)
    : null;

  const exportTrades = () => {
    const headers = ['Time', 'Symbol', 'Market type', 'Side', 'Order type', 'Quantity', 'Filled quantity', 'Fill price', 'Fees', 'Status'];
    const rows = orders.map((order) => [
      order.created_at, order.symbol, order.market_type ?? '', order.side, order.order_type ?? '',
      order.qty, order.filled_qty, order.fill_price ?? '', order.fee_paid, order.status,
    ]);
    const csv = [headers, ...rows].map((row) =>
      row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(',')
    ).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'tradelab-paper-orders.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

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
          assetClass,
          marketType,
          poolAddress: selectedMarket?.poolAddress,
          network: selectedMarket?.network,
          side,
          orderType,
          qty: Number(quantity),
          limitPrice: limitPrice ? Number(limitPrice) : undefined,
          triggerPrice: triggerPrice ? Number(triggerPrice) : undefined,
          trailingPercent: trailingPercent ? Number(trailingPercent) : undefined,
          takeProfitPrice: takeProfitPrice ? Number(takeProfitPrice) : undefined,
          stopLossPrice: stopLossPrice ? Number(stopLossPrice) : undefined,
          leverage: Number(leverage),
          reasonEntry,
          notes: notes.trim() || undefined,
          highVolatilityMode,
        }),
      });
      const result = await response.json() as OrderResult;
      if (!response.ok) throw new Error(result.error ?? 'Could not place order');
      if (!result.order && !result.orders && !result.pending) throw new Error('Invalid order response');

      if (result.fill) {
        setSuccessMessage(`${result.fill.partial ? 'Partial fill' : 'Filled'} ${result.fill.filledQty.toFixed(6)} ${selectedSymbol} at $${formatPrice(result.fill.fillPrice)}.`);
      } else if (result.orders?.length) {
        setSuccessMessage('OCO order placed. The take-profit or stop-loss leg will cancel its sibling when triggered.');
      } else {
        setSuccessMessage('Conditional order placed. It will be checked against market prices and simulated book depth.');
      }
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

  const handleCancelOrder = async (orderId: string) => {
    setCancellingOrderId(orderId);
    setErrorMessage('');
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!session) {
        router.replace('/login');
        return;
      }
      const response = await fetch('/api/orders/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ orderId }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Unable to cancel order');
      await refreshTradingData(session.user.id);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setCancellingOrderId('');
    }
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
            {feed?.market.venue ?? 'Connecting market feed'}
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
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          <div className={`${panel} px-4 py-3`}>
            <p className="text-[10px] uppercase tracking-[0.14em] text-[#748094]">Available balance</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">${numberFormat.format(account?.balance ?? 0)}</p>
          </div>
          <div className={`${panel} px-4 py-3`}>
            <p className="text-[10px] uppercase tracking-[0.14em] text-[#748094]">Paper equity</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">${numberFormat.format(equity)}</p>
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
            <p className="text-[10px] uppercase tracking-[0.14em] text-[#748094]">Win rate</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">{winRate.toFixed(1)}%</p>
            <p className="text-[10px] text-[#748094]">{winningTrades}W / {losingTrades}L · closed trades</p>
          </div>
          <div className={`${panel} px-4 py-3`}>
            <p className="text-[10px] uppercase tracking-[0.14em] text-[#748094]">Realized PnL</p>
            <p className={`mt-1 text-lg font-semibold tabular-nums ${realizedPnl >= 0 ? 'text-[#43cc98]' : 'text-[#f1717c]'}`}>
              {realizedPnl >= 0 ? '+' : ''}${numberFormat.format(realizedPnl)}
            </p>
            <p className="text-[10px] text-[#748094]">Profit factor {Number.isFinite(profitFactor) ? profitFactor.toFixed(2) : '∞'}</p>
          </div>
          <div className={`${panel} px-4 py-3`}>
            <p className="text-[10px] uppercase tracking-[0.14em] text-[#748094]">Account status</p>
            <p className={`mt-1 text-lg font-semibold ${account?.is_dead ? 'text-[#f1717c]' : 'text-[#43cc98]'}`}>{account?.is_dead ? 'LOCKED' : 'PAPER · ACTIVE'}</p>
          </div>
        </div>

        <section aria-label="Trading performance" className={`${panel} mb-4 grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_220px]`}>
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-[0.12em]">Realized equity curve</h2>
              <span className="text-[10px] text-[#788497]">{closedTrades.length} closed trades</span>
            </div>
            <PerformanceChart points={dailyEquityCurve} />
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
            <div className="rounded-lg bg-[#0d1118] p-3">
              <p className="text-[10px] uppercase tracking-wider text-[#788497]">Max drawdown</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-[#f1717c]">{maxDrawdownPct.toFixed(2)}%</p>
            </div>
            <div className="rounded-lg bg-[#0d1118] p-3">
              <p className="text-[10px] uppercase tracking-wider text-[#788497]">Sharpe ratio</p>
              <p className="mt-1 text-lg font-semibold tabular-nums">{sharpeRatio === null ? '—' : sharpeRatio.toFixed(2)}</p>
              <p className="mt-1 text-[9px] text-[#718094]">Annualized estimate from closed-trade days</p>
            </div>
          </div>
        </section>

        {errorMessage && <div role="alert" className="mb-4 rounded-lg border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">{errorMessage}</div>}
        {marketError && <div role="alert" className="mb-4 rounded-lg border border-amber-800 bg-amber-950/30 p-3 text-sm text-amber-200">Market feed: {marketError}. Showing the last available quote.</div>}

        <div className="grid items-start gap-3 xl:grid-cols-[220px_minmax(0,1fr)_300px]">
          <aside className={`${panel} overflow-hidden`}>
            <div className="border-b border-[#232936] p-3">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-[0.14em]">Markets</h2>
                <span className="text-[10px] text-[#748094]">{visibleMarkets.length} shown</span>
              </div>
              <div className="mb-3 grid grid-cols-4 gap-1 rounded-lg bg-[#0b0e13] p-1">
                {(['crypto', 'stock', 'etf', 'dex'] as const).map((marketClass) => (
                  <button
                    className={`rounded-md py-1.5 text-[10px] font-semibold uppercase ${assetClass === marketClass ? 'bg-[#26313e] text-white' : 'text-[#798598] hover:text-white'}`}
                    key={marketClass}
                    onClick={() => {
                      setAssetClass(marketClass);
                      if (marketClass === 'crypto') {
                        setMarketType('crypto_perp');
                        setSelectedSymbol('BTC');
                      } else if (marketClass === 'stock' || marketClass === 'etf') {
                        setMarketType(marketClass);
                        setSelectedSymbol(marketClass === 'stock' ? 'AAPL' : 'SPY');
                      } else {
                        setMarketType('dex_spot');
                        setSelectedSymbol('');
                      }
                    }}
                  >{marketClass === 'crypto' ? 'Crypto' : marketClass === 'stock' ? 'Stocks' : marketClass === 'etf' ? 'ETFs' : 'DEX'}</button>
                ))}
              </div>
              {assetClass === 'crypto' && (
                <div className="mb-3 grid grid-cols-2 gap-1 rounded-lg bg-[#0b0e13] p-1">
                  {(['crypto_perp', 'crypto_spot'] as const).map((type) => (
                    <button
                      className={`rounded-md py-1.5 text-[10px] ${marketType === type ? 'bg-[#26313e] text-white' : 'text-[#798598] hover:text-white'}`}
                      key={type}
                      onClick={() => {
                        setMarketType(type);
                        setSelectedSymbol(type === 'crypto_perp' ? 'BTC' : 'BTCUSDT');
                      }}
                    >{type === 'crypto_perp' ? 'Perpetuals' : 'CEX Spot'}</button>
                  ))}
                </div>
              )}
              <input aria-label="Search markets" className={inputClass} onChange={(event) => setSearch(event.target.value)} placeholder="Search market" value={search} />
            </div>
            <div className="max-h-[600px] overflow-y-auto p-1.5">
              {visibleMarkets.map((market) => (
                <button
                  className={`mb-1 flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left transition ${selectedSymbol === market.symbol ? 'bg-[#1b302c] ring-1 ring-inset ring-[#285641]' : 'hover:bg-[#1a202a]'}`}
                  key={`${market.marketType}:${market.symbol}`}
                  onClick={() => {
                    setSelectedSymbol(market.symbol);
                    setAssetClass(market.assetClass);
                    setMarketType(market.marketType);
                  }}
                >
                  <span>
                    <span className="block text-xs font-semibold">{market.symbol}</span>
                    <span className="mt-1 block text-[9px] text-[#788497]">{market.name} · {market.venue}</span>
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
                    <h1 className="text-xl font-bold">{selectedMarket?.name ?? selectedSymbol}<span className="ml-1 text-sm font-normal text-[#8290a3]">{marketType === 'crypto_perp' ? 'PERP' : marketType === 'crypto_spot' ? 'SPOT' : marketType === 'dex_spot' ? 'DEX' : assetClass.toUpperCase()}</span></h1>
                    <span className="rounded bg-[#1a222d] px-2 py-1 text-[10px] text-[#9ba6b6]">{selectedMarket?.currency ?? 'USD'}</span>
                  </div>
                  <p className="mt-1 text-[10px] text-[#788497]">{selectedMarket?.venue ?? 'Market'} · paper fills only</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-[#788497]">Mark price</p>
                  <p className="mt-0.5 text-2xl font-semibold tabular-nums">
                    {feed ? `$${formatPrice(feed.market.markPrice)}` : '—'}
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
                  <p className="text-[10px] uppercase tracking-wider text-[#788497]">{marketType === 'dex_spot' ? 'Pool liquidity' : 'Funding / 8h'}</p>
                  <p className="mt-0.5 text-sm font-medium tabular-nums">
                    {marketType === 'crypto_perp'
                      ? `${((selectedMarket?.fundingRate ?? 0) * 100).toFixed(4)}%`
                      : marketType === 'dex_spot' && selectedMarket?.liquidityUsd
                        ? `$${formatCompact(selectedMarket.liquidityUsd)}`
                        : '—'}
                  </p>
                </div>
              </div>
            </div>

            <div className={`${panel} p-3 sm:p-4`}>
              <div className="mb-2 flex items-center justify-between">
                <div>
                  <h2 className="text-xs font-semibold">Price chart <span className="ml-1 font-normal text-[#7d899a]">1m</span></h2>
                  <p className="mt-1 text-[10px] text-[#6f7b8d]">{feed?.source ?? 'Market candles'} · {marketLoading ? 'updating' : `updated ${timestamp}`}</p>
                </div>
                <span className="rounded border border-[#293240] px-2 py-1 text-[10px] text-[#99a4b4]">1m · 100 bars</span>
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
                    <table className="w-full min-w-[610px] text-left text-xs">
                      <thead className="text-[10px] uppercase tracking-wider text-[#768295]">
                        <tr><th className="pb-2">Market</th><th className="pb-2">Size</th><th className="pb-2">Entry</th><th className="pb-2">Mark</th><th className="pb-2">Liquidation</th><th className="pb-2 text-right">Unrealized</th></tr>
                      </thead>
                      <tbody>
                        {positions.map((position) => {
                          const mark = position.symbol === selectedSymbol
                            ? currentPrice
                            : catalog.find((market) => market.symbol === position.symbol)?.markPrice;
                          const pnl = mark ? (mark - Number(position.avg_entry)) * Number(position.qty) : 0;
                          return (
                            <tr className="border-t border-[#242b36]" key={position.id}>
                              <td className="py-2.5 font-semibold">{position.symbol}<span className={`ml-1 text-[9px] font-normal ${Number(position.qty) >= 0 ? 'text-[#43cc98]' : 'text-[#f1717c]'}`}>{Number(position.qty) >= 0 ? 'LONG' : 'SHORT'}</span></td>
                              <td className="py-2.5 tabular-nums">{numberFormat.format(Math.abs(Number(position.qty)))}</td>
                              <td className="py-2.5 tabular-nums">${formatPrice(Number(position.avg_entry))}</td>
                              <td className="py-2.5 tabular-nums">{mark ? `$${formatPrice(mark)}` : '—'}</td>
                              <td className="py-2.5 tabular-nums">{position.liquidation_price ? `$${formatPrice(Number(position.liquidation_price))}` : '—'}</td>
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
                  <span className="text-[10px] text-[#788497]">{feed?.bookSource === 'simulated' ? 'Simulated depth' : 'Live depth'}</span>
                </div>
                <BookRows title="Asks" levels={[...(feed?.book.asks ?? [])].slice(0, 6).reverse()} side="ask" />
                <div className="my-2 flex items-center justify-between border-y border-[#252d39] py-2 text-xs">
                  <span className="font-semibold tabular-nums">${feed ? formatPrice(feed.market.markPrice) : '—'}</span>
                  <span className="text-[10px] text-[#768295]">Spread {spread ? `${formatPrice(spread)} (${spreadPct.toFixed(3)}%)` : '—'}</span>
                </div>
                <BookRows title="Bids" levels={(feed?.book.bids ?? []).slice(0, 6)} side="bid" />
              </div>
            </div>

            <div className={`${panel} p-4`}>
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-xs font-semibold uppercase tracking-[0.12em]">Orders & executions</h2>
                  <span className="text-[10px] text-[#788497]">{orders.length} loaded · pending orders are checked every 8 seconds</span>
                </div>
                <button className="rounded border border-[#303847] px-2.5 py-1.5 text-[10px] text-[#aeb7c5] hover:border-[#586477] hover:text-white" onClick={exportTrades} type="button">Export CSV</button>
              </div>
              {orders.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] text-left text-xs">
                    <thead className="text-[10px] uppercase tracking-wider text-[#768295]">
                      <tr><th className="pb-2">Market</th><th className="pb-2">Side</th><th className="pb-2">Filled</th><th className="pb-2">Fill price</th><th className="pb-2">Fee</th><th className="pb-2">Status</th><th className="pb-2 text-right">Time</th></tr>
                    </thead>
                    <tbody>
                      {orders.slice(0, 30).map((order) => (
                        <tr className="border-t border-[#242b36]" key={order.id}>
                          <td className="py-2.5 font-semibold">{order.symbol}</td>
                          <td className="py-2.5 text-[10px] text-[#8792a2]">{order.market_type?.replace('_', ' ') ?? '—'} · {order.order_type ?? '—'}</td>
                          <td className={`py-2.5 uppercase ${order.side === 'buy' ? 'text-[#43cc98]' : 'text-[#f1717c]'}`}>{order.side}</td>
                          <td className="py-2.5 tabular-nums">{numberFormat.format(Number(order.filled_qty || 0))}</td>
                          <td className="py-2.5 tabular-nums">{order.fill_price === null ? '—' : `$${formatPrice(Number(order.fill_price))}`}</td>
                          <td className="py-2.5 tabular-nums">${numberFormat.format(Number(order.fee_paid || 0))}</td>
                          <td className="py-2.5 capitalize">{order.status}</td>
                          <td className="py-2.5 text-right text-[10px] text-[#8792a2]">
                            {new Date(order.created_at).toLocaleTimeString()}
                            {order.status === 'pending' && (
                              <button className="ml-2 text-red-300 hover:text-red-200 disabled:opacity-50" disabled={cancellingOrderId === order.id} onClick={() => handleCancelOrder(order.id)} type="button">
                                {cancellingOrderId === order.id ? 'Canceling' : 'Cancel'}
                              </button>
                            )}
                          </td>
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
                  <div className="flex items-center justify-between text-[10px] text-[#788497]"><span>{selectedMarket?.venue ?? 'Market'}</span><span>{marketType.replace('_', ' ')}</span></div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="font-semibold">{selectedSymbol}</span>
                    <span className="tabular-nums">${feed ? formatPrice(feed.market.markPrice) : 'Loading...'}</span>
                  </div>
                  <p className="mt-2 text-[10px] leading-relaxed text-[#778395]">The server uses a fresh market quote when your simulated order is submitted.</p>
                </div>

                <label className="block space-y-1.5 text-xs">
                  <span className="text-[#aeb7c5]">Order type</span>
                  <select className={inputClass} onChange={(event) => setOrderType(event.target.value as typeof orderType)} value={orderType}>
                    <option value="market">Market</option>
                    <option value="limit">Limit</option>
                    <option value="stop_loss">Stop loss</option>
                    <option value="take_profit">Take profit</option>
                    <option value="trailing_stop">Trailing stop</option>
                    <option value="oco">OCO (take profit + stop loss)</option>
                  </select>
                </label>

                <label className="block space-y-1.5 text-xs">
                  <span className="flex justify-between text-[#aeb7c5]"><span>Quantity ({selectedSymbol})</span><span>Available ${numberFormat.format(account?.balance ?? 0)}</span></span>
                  <input className={inputClass} min="0.000001" onChange={(event) => setQuantity(event.target.value)} required step="any" type="number" value={quantity} />
                  <span className="flex flex-wrap gap-1.5 pt-1">
                    {[0.25, 0.5, 0.75, 1].map((fraction) => (
                      <button className="rounded border border-[#303847] px-2 py-1 text-[10px] text-[#8c98a9] hover:border-[#596678] hover:text-white" key={fraction} onClick={() => {
                        const notional = (account?.balance ?? 0) * fraction * Number(leverage);
                        setQuantity(currentPrice ? (notional / currentPrice).toFixed(6) : '0');
                      }} type="button">{fraction === 1 ? 'Max' : `${fraction * 100}%`}</button>
                    ))}
                  </span>
                </label>

                {orderType === 'limit' && (
                  <label className="block space-y-1.5 text-xs">
                    <span className="text-[#aeb7c5]">Limit price</span>
                    <input className={inputClass} min="0.00000001" onChange={(event) => setLimitPrice(event.target.value)} required step="any" type="number" value={limitPrice} />
                  </label>
                )}

                {(orderType === 'stop_loss' || orderType === 'take_profit') && (
                  <label className="block space-y-1.5 text-xs">
                    <span className="text-[#aeb7c5]">Trigger price</span>
                    <input className={inputClass} min="0.00000001" onChange={(event) => setTriggerPrice(event.target.value)} required step="any" type="number" value={triggerPrice} />
                  </label>
                )}

                {orderType === 'trailing_stop' && (
                  <label className="block space-y-1.5 text-xs">
                    <span className="text-[#aeb7c5]">Trailing distance (%)</span>
                    <input className={inputClass} max="50" min="0.01" onChange={(event) => setTrailingPercent(event.target.value)} required step="0.01" type="number" value={trailingPercent} />
                  </label>
                )}

                {orderType === 'oco' && (
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block space-y-1.5 text-xs">
                      <span className="text-[#aeb7c5]">Take-profit trigger</span>
                      <input className={inputClass} min="0.00000001" onChange={(event) => setTakeProfitPrice(event.target.value)} required step="any" type="number" value={takeProfitPrice} />
                    </label>
                    <label className="block space-y-1.5 text-xs">
                      <span className="text-[#aeb7c5]">Stop-loss trigger</span>
                      <input className={inputClass} min="0.00000001" onChange={(event) => setStopLossPrice(event.target.value)} required step="any" type="number" value={stopLossPrice} />
                    </label>
                  </div>
                )}

                {(marketType === 'crypto_perp' || assetClass === 'stock' || assetClass === 'etf') && (
                  <label className="block space-y-1.5 text-xs">
                    <span className="flex justify-between text-[#aeb7c5]"><span>Leverage</span><span>{marketType === 'crypto_perp' ? 'Up to 20×' : 'Equities up to 2×'}</span></span>
                    <select className={inputClass} onChange={(event) => setLeverage(event.target.value)} value={leverage}>
                      {(marketType === 'crypto_perp' ? [1, 2, 3, 5, 10, 20] : [1, 2]).map((value) => <option key={value} value={value}>{value}×</option>)}
                    </select>
                  </label>
                )}

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
                  <div className="flex justify-between text-[#8a96a7]"><span>Estimated taker / venue fees</span><span className="tabular-nums">${numberFormat.format(estimatedFee.total)}</span></div>
                  {estimatedFee.poolFee > 0 && <div className="flex justify-between text-[#8a96a7]"><span>Pool fee</span><span className="tabular-nums">${numberFormat.format(estimatedFee.poolFee)}</span></div>}
                  {estimatedFee.gasFee > 0 && <div className="flex justify-between text-[#8a96a7]"><span>Estimated network gas</span><span className="tabular-nums">${numberFormat.format(estimatedFee.gasFee)}</span></div>}
                  {estimatedFee.regulatoryFee + estimatedFee.exchangeFee > 0 && <div className="flex justify-between text-[#8a96a7]"><span>Regulatory / exchange estimates</span><span className="tabular-nums">${numberFormat.format(estimatedFee.regulatoryFee + estimatedFee.exchangeFee)}</span></div>}
                  <div className="flex justify-between text-[#8a96a7]"><span>Spread</span><span className="tabular-nums">{spread ? `${spreadPct.toFixed(3)}%` : '—'}</span></div>
                  {marketType === 'crypto_perp' && <div className="flex justify-between text-[#8a96a7]"><span>Funding rate / 8h</span><span className="tabular-nums">{feed ? `${(selectedMarket?.fundingRate ?? 0) * 100}%` : '—'}</span></div>}
                  <p className="pt-1 text-[10px] leading-relaxed text-[#687588]">Fee schedules and regulatory costs are modeled defaults, not guaranteed venue charges. Simulated fills use current visible depth when supplied. No real orders are sent.</p>
                </div>

                {successMessage && <p className="rounded-lg border border-[#245442] bg-[#10251e] p-2.5 text-xs text-[#55d7a4]" role="status">{successMessage}</p>}
                {errorMessage && account && <p className="rounded-lg border border-red-900 bg-red-950/30 p-2.5 text-xs text-red-300" role="alert">{errorMessage}</p>}

                <button className={`w-full rounded-lg py-3 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-45 ${side === 'buy' ? 'bg-[#22966c] hover:bg-[#28aa7b]' : 'bg-[#be505d] hover:bg-[#d15a68]'}`} disabled={submitting || !feed || !reasonEntry || !Number(quantity)} type="submit">
                  {submitting ? 'Simulating order...' : orderType === 'oco' ? `Place OCO · ${selectedSymbol}` : `${side === 'buy' ? 'Buy' : marketType === 'crypto_perp' ? 'Sell / Short' : 'Sell'} ${selectedSymbol}`}
                </button>
                <p className="text-[10px] text-[#778395]">Paper only. DEX depth is modeled from pool liquidity; actual routing and on-chain gas can differ substantially.</p>
              </form>
            )}
          </aside>
        </div>

        <footer className="mt-4 flex flex-wrap items-center justify-between gap-2 px-1 text-[10px] text-[#687588]">
          <span>Public market data with simulated execution · No real orders or wallet connections.</span>
          <span>{feed ? `Market data updated ${timestamp}` : 'Connecting to public market data...'}</span>
        </footer>
      </div>
    </main>
  );
}

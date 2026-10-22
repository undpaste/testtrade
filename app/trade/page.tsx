'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

type Account = {
  balance: number;
  total_fees_paid: number;
  is_dead: boolean;
};

type Order = {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  order_type: 'market' | 'limit';
  qty: number;
  filled_qty: number;
  fill_price: number | null;
  fee_paid: number;
  status: string;
  created_at: string;
};

type OrderResult = {
  order: Order;
  fill: {
    fillPrice: number;
    filledQty: number;
    requestedQty: number;
    fee: number;
    partial: boolean;
  };
  newBalance: number;
};

const fieldClass = 'w-full rounded border border-gray-700 bg-black px-3 py-2 text-white';

export default function TradePage() {
  const [account, setAccount] = useState<Account | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [symbol, setSymbol] = useState('');
  const [assetClass, setAssetClass] = useState<'crypto' | 'stock' | 'etf'>('stock');
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [qty, setQty] = useState('1');
  const [price, setPrice] = useState('');
  const [reasonEntry, setReasonEntry] = useState('');
  const [notes, setNotes] = useState('');
  const [highVolatilityMode, setHighVolatilityMode] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const router = useRouter();

  const refreshTradingData = useCallback(async (userId: string) => {
    const [{ data: accountData, error: accountError }, { data: orderData, error: ordersError }] = await Promise.all([
      supabase
        .from('accounts')
        .select('balance, total_fees_paid, is_dead')
        .eq('user_id', userId)
        .single(),
      supabase
        .from('orders')
        .select('id, symbol, side, order_type, qty, filled_qty, fill_price, fee_paid, status, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(10),
    ]);

    if (accountError) throw accountError;
    if (ordersError) throw ordersError;

    setAccount({
      balance: Number(accountData.balance),
      total_fees_paid: Number(accountData.total_fees_paid ?? 0),
      is_dead: Boolean(accountData.is_dead),
    });
    setOrders((orderData ?? []) as Order[]);
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
          .from('accounts')
          .select('id')
          .eq('user_id', userId)
          .maybeSingle();
        if (accountError) throw accountError;

        if (!existingAccount) {
          const { error: createError } = await supabase
            .from('accounts')
            .insert({ user_id: userId, balance: 1000, equity: 1000 });
          if (createError) throw createError;
        }

        await refreshTradingData(userId);
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    init();
    return () => {
      cancelled = true;
    };
  }, [refreshTradingData, router]);

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
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          symbol: symbol.trim().toUpperCase(),
          assetClass,
          side,
          orderType: 'market',
          qty: Number(qty),
          requestedPrice: Number(price),
          reasonEntry,
          notes: notes.trim() || undefined,
          avgDailyVolume: 100_000_000,
          recentVolatility: highVolatilityMode ? 0.05 : 0.01,
          highVolatilityMode,
        }),
      });

      const result: OrderResult | { error?: string } = await response.json();
      if (!response.ok) {
        throw new Error('error' in result && result.error ? result.error : 'Could not place order');
      }
      if (!('order' in result)) throw new Error('The server returned an invalid order response');

      setSuccessMessage(
        result.fill.filledQty === 0
          ? 'Order submitted but not filled at that price.'
          : `${result.fill.partial ? 'Partial fill' : 'Order filled'}: ${result.fill.filledQty.toFixed(6)} ${symbol.toUpperCase()} at $${result.fill.fillPrice.toFixed(2)}.`
      );
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
    setErrorMessage('');
    const { error } = await supabase.auth.signOut();
    if (error) {
      setErrorMessage(error.message);
      setSigningOut(false);
      return;
    }
    router.replace('/login');
  };

  if (loading) return <div className="min-h-screen bg-black p-10 text-white">Loading your paper account...</div>;
  if (errorMessage && !account) return <div role="alert" className="min-h-screen bg-black p-10 text-red-400">Error: {errorMessage}</div>;
  if (!account) return <div className="min-h-screen bg-black p-10 text-white">Could not load your paper account.</div>;

  return (
    <main className="min-h-screen bg-[#0B0E11] p-4 font-mono text-white sm:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-green-400">Paper Trading</h1>
            <p className="mt-1 text-sm text-gray-400">Practice trades with simulated fills. No real money is used.</p>
          </div>
          <button
            onClick={handleSignOut}
            disabled={signingOut}
            className="rounded bg-red-700 px-4 py-2 font-bold hover:bg-red-600 disabled:opacity-50"
          >
            {signingOut ? 'Logging out...' : 'Logout'}
          </button>
        </header>

        <section className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-gray-800 bg-gray-900 p-5">
            <p className="text-sm text-gray-400">Cash balance</p>
            <p className="mt-2 text-2xl font-bold text-yellow-300">${account.balance.toFixed(2)}</p>
          </div>
          <div className="rounded-lg border border-gray-800 bg-gray-900 p-5">
            <p className="text-sm text-gray-400">Fees paid</p>
            <p className="mt-2 text-2xl font-bold">${account.total_fees_paid.toFixed(2)}</p>
          </div>
          <div className="rounded-lg border border-gray-800 bg-gray-900 p-5">
            <p className="text-sm text-gray-400">Account status</p>
            <p className={`mt-2 text-2xl font-bold ${account.is_dead ? 'text-red-400' : 'text-green-400'}`}>
              {account.is_dead ? 'LOCKED' : 'ACTIVE'}
            </p>
          </div>
        </section>

        {account.is_dead ? (
          <div className="rounded-lg border border-red-800 bg-red-950/40 p-5 text-red-200">
            This paper account is locked during its cooling-off period.
          </div>
        ) : (
          <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <form onSubmit={handlePlaceOrder} className="space-y-4 rounded-lg border border-gray-800 bg-gray-900 p-5">
              <div>
                <h2 className="text-xl font-bold">Place an order</h2>
                <p className="mt-1 text-xs text-gray-400">Enter the price you want to simulate; live market quotes are not connected yet.</p>
              </div>

              <label className="block space-y-1 text-sm">
                <span>Symbol</span>
                <input className={fieldClass} maxLength={20} onChange={(event) => setSymbol(event.target.value)} placeholder="e.g. AAPL or BTC" required value={symbol} />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1 text-sm">
                  <span>Asset type</span>
                  <select className={fieldClass} onChange={(event) => setAssetClass(event.target.value as typeof assetClass)} value={assetClass}>
                    <option value="stock">Stock</option>
                    <option value="etf">ETF</option>
                    <option value="crypto">Crypto</option>
                  </select>
                </label>
                <label className="block space-y-1 text-sm">
                  <span>Side</span>
                  <select className={fieldClass} onChange={(event) => setSide(event.target.value as typeof side)} value={side}>
                    <option value="buy">Buy</option>
                    <option value="sell">Sell</option>
                  </select>
                </label>
              </div>

              <label className="block space-y-1 text-sm">
                <span>Quantity</span>
                <input className={fieldClass} min="0.000001" onChange={(event) => setQty(event.target.value)} required step="any" type="number" value={qty} />
              </label>

              <label className="block space-y-1 text-sm">
                <span>Reference price (USD)</span>
                <input className={fieldClass} min="0.000001" onChange={(event) => setPrice(event.target.value)} placeholder="e.g. 150.00" required step="any" type="number" value={price} />
              </label>

              <label className="block space-y-1 text-sm">
                <span>Reason for this trade</span>
                <select className={fieldClass} onChange={(event) => setReasonEntry(event.target.value)} required value={reasonEntry}>
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

              <label className="block space-y-1 text-sm">
                <span>Notes (optional)</span>
                <textarea className={fieldClass} onChange={(event) => setNotes(event.target.value)} rows={2} value={notes} />
              </label>

              <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-300">
                <input checked={highVolatilityMode} onChange={(event) => setHighVolatilityMode(event.target.checked)} type="checkbox" />
                High volatility simulation
              </label>

              <p className="text-xs text-gray-400">
                Approximate order value: ${((Number(qty) || 0) * (Number(price) || 0)).toFixed(2)} before fees and simulated slippage.
              </p>

              {errorMessage && <p role="alert" className="text-sm text-red-400">{errorMessage}</p>}
              {successMessage && <p role="status" className="text-sm text-green-400">{successMessage}</p>}

              <button
                className={`w-full rounded px-4 py-3 font-bold disabled:cursor-not-allowed disabled:opacity-50 ${side === 'buy' ? 'bg-green-600 hover:bg-green-500' : 'bg-red-600 hover:bg-red-500'}`}
                disabled={submitting || !symbol.trim() || !reasonEntry || !Number(qty) || !Number(price)}
                type="submit"
              >
                {submitting ? 'Submitting order...' : `${side === 'buy' ? 'Buy' : 'Sell'} ${symbol.trim().toUpperCase() || 'asset'}`}
              </button>
            </form>

            <section className="rounded-lg border border-gray-800 bg-gray-900 p-5">
              <h2 className="mb-4 text-xl font-bold">Recent orders</h2>
              {orders.length === 0 ? (
                <p className="text-sm text-gray-400">No orders yet. Place your first paper trade using the form.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[540px] text-left text-sm">
                    <thead className="text-xs uppercase text-gray-400">
                      <tr>
                        <th className="pb-3 pr-3">Symbol</th>
                        <th className="pb-3 pr-3">Side</th>
                        <th className="pb-3 pr-3">Filled</th>
                        <th className="pb-3 pr-3">Price</th>
                        <th className="pb-3 pr-3">Status</th>
                        <th className="pb-3">Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.map((order) => (
                        <tr className="border-t border-gray-800" key={order.id}>
                          <td className="py-3 pr-3 font-bold">{order.symbol}</td>
                          <td className={`py-3 pr-3 uppercase ${order.side === 'buy' ? 'text-green-400' : 'text-red-400'}`}>{order.side}</td>
                          <td className="py-3 pr-3">{Number(order.filled_qty || 0).toFixed(4)}</td>
                          <td className="py-3 pr-3">{order.fill_price === null ? '—' : `$${Number(order.fill_price).toFixed(2)}`}</td>
                          <td className="py-3 pr-3 capitalize">{order.status}</td>
                          <td className="py-3 text-xs text-gray-400">{new Date(order.created_at).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </section>
        )}
      </div>
    </main>
  );
}

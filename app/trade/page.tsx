'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { RealMoneyWidget } from '@/components/RealMoneyWidget';
import { TradeJournalModal } from '@/components/TradeJournalModal';
import { RevengeWarning } from '@/components/RevengeWarning';
import { AccountDeathScreen } from '@/components/AccountDeathScreen';
import { RealismToggle } from '@/components/RealismToggle';

export default function TradePage() {
  const [account, setAccount] = useState<any>(null);
  const [orders, setOrders] = useState<any[]>([]);
  const [showJournal, setShowJournal] = useState(false);
  const [revengeFreeze, setRevengeFreeze] = useState<string | null>(null);
  const [pendingOrder, setPendingOrder] = useState<any>(null);
  const [highVolMode, setHighVolMode] = useState(false);

  // Load account + orders
  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const [acc, ord] = await Promise.all([
        supabase.from('accounts').select('*').eq('user_id', user.id).single(),
        supabase.from('orders').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(50),
      ]);
      setAccount(acc.data);
      setOrders(ord.data || []);
    };
    load();
  }, []);

  if (!account) return <div className="p-8">Loading...</div>;

  // Account death override
  if (account.is_dead && account.dead_until && new Date(account.dead_until) > new Date()) {
    return <AccountDeathScreen deadUntil={account.dead_until} />;
  }

  const submitOrder = async (journal: any) => {
    try {
      const res = await fetch('/api/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...pendingOrder,
          reasonEntry: journal.reason,
          notes: journal.notes,
          highVolatilityMode: highVolMode,
          recentVolatility: 0.4,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      // Refresh
      const { data: acc } = await supabase.from('accounts').select('*').eq('user_id', account.user_id).single();
      setAccount(acc);
      setShowJournal(false);
    } catch (err: any) {
      if (err.message.startsWith('REVENGE_TRADING')) {
        const freeze = err.message.split('FREEZE_UNTIL:')[1];
        setRevengeFreeze(freeze);
        setShowJournal(false);
      } else {
        alert(err.message);
      }
    }
  };

  return (
    <div className="min-h-screen bg-[#0B0E11] text-white">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <div className="text-xl font-black">TestTrade</div>
          <div className="text-sm">
            <span className="text-gray-400">Equity:</span>
            <span className="ml-2 font-mono font-bold text-lg">${account.equity.toFixed(2)}</span>
          </div>
          <div className="text-sm">
            <span className="text-gray-400">Fees paid:</span>
            <span className="ml-2 font-mono text-red-400">${account.total_fees_paid.toFixed(2)}</span>
          </div>
        </div>
        <RealismToggle enabled={highVolMode} onChange={setHighVolMode} />
      </header>

      <div className="grid grid-cols-12 gap-4 p-4">
        {/* Left: Portfolio */}
        <div className="col-span-3 space-y-4">
          <RealMoneyWidget pnlUSD={account.equity - 1000} region="ID" />
          <div className="bg-[#12161C] rounded-xl p-4">
            <div className="text-sm text-gray-400 mb-2">Balance</div>
            <div className="text-3xl font-mono font-bold">${account.balance.toFixed(2)}</div>
            <div className="text-xs text-gray-500 mt-2">
              Fees: ${account.total_fees_paid.toFixed(2)} · Trades: {account.total_trades}
            </div>
          </div>
        </div>

        {/* Center: Chart placeholder */}
        <div className="col-span-6 bg-[#12161C] rounded-xl p-4 min-h-[600px]">
          <div className="text-gray-500">Chart coming soon — integrate lightweight-charts here</div>
        </div>

        {/* Right: Order form */}
        <div className="col-span-3 bg-[#12161C] rounded-xl p-4">
          <h3 className="font-bold mb-4">Place Order</h3>
          <button
            onClick={() => {
              setPendingOrder({ symbol: 'BTCUSDT', assetClass: 'crypto', side: 'buy', orderType: 'market', qty: 0.01, requestedPrice: 65000, avgDailyVolume: 1e9 });
              setShowJournal(true);
            }}
            className="w-full bg-green-600 hover:bg-green-500 py-3 rounded-lg font-bold"
          >
            Buy BTC
          </button>
          <button
            onClick={() => {
              setPendingOrder({ symbol: 'BTCUSDT', assetClass: 'crypto', side: 'sell', orderType: 'market', qty: 0.01, requestedPrice: 65000, avgDailyVolume: 1e9 });
              setShowJournal(true);
            }}
            className="w-full bg-red-600 hover:bg-red-500 py-3 rounded-lg font-bold mt-2"
          >
            Sell BTC
          </button>
        </div>
      </div>

      <TradeJournalModal
        open={showJournal}
        onClose={() => setShowJournal(false)}
        onSubmit={submitOrder}
        symbol={pendingOrder?.symbol || ''}
        side={pendingOrder?.side || ''}
        qty={pendingOrder?.qty || 0}
        price={pendingOrder?.requestedPrice || 0}
      />

      {revengeFreeze && (
        <RevengeWarning
          frozenUntil={revengeFreeze}
          onDismiss={() => setRevengeFreeze(null)}
        />
      )}
    </div>
  );
}
'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import { RealMoneyWidget } from '@/components/RealMoneyWidget';
import { TradeJournalModal } from '@/components/TradeJournalModal';
import { RevengeWarning } from '@/components/RevengeWarning';
import { AccountDeathScreen } from '@/components/AccountDeathScreen';

export default function TradePage() {
  const [account, setAccount] = useState<any>(null);
  const [orders, setOrders] = useState<any[]>([]);
  const [showJournal, setShowJournal] = useState(false);
  const [revengeFreeze, setRevengeFreeze] = useState<string | null>(null);
  const [pendingOrder, setPendingOrder] = useState<any>(null);
  const [highVolMode, setHighVolMode] = useState(false);
  
  // State untuk mencegah "Loading abadi"
  const [isLoading, setIsLoading] = useState(true); 
  const [authError, setAuthError] = useState(false);

  const router = useRouter();

  useEffect(() => {
    const load = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        
        // Kalau belum login, tendang ke halaman /login
        if (!session) {
          router.push('/login');
          return;
        }

        const userId = session.user.id;
        
        // Fetch akun
        const { data: acc, error: accErr } = await supabase
          .from('accounts')
          .select('*')
          .eq('user_id', userId)
          .single();

        if (accErr) throw accErr;

        // Fetch order history
        const { data: ord } = await supabase
          .from('orders')
          .select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(50);

        setAccount(acc);
        setOrders(ord || []);
      } catch (err) {
        console.error("Load error:", err);
        setAuthError(true);
      } finally {
        setIsLoading(false); // Selesai loading (apapun hasilnya)
      }
    };
    load();
  }, [router]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

  // 1. Tampilan saat Loading
  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0B0E11] flex flex-col items-center justify-center text-white">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-yellow-500 mb-4"></div>
        <p className="text-gray-400">Memuat data akun...</p>
      </div>
    );
  }

  // 2. Tampilan kalau error
  if (authError || !account) {
    return (
      <div className="min-h-screen bg-[#0B0E11] flex flex-col items-center justify-center text-white">
        <h2 className="text-2xl font-bold text-red-500 mb-2">Gagal memuat akun</h2>
        <p className="text-gray-400 mb-6">Pastikan database Supabase sudah di-setup dengan benar.</p>
        <button onClick={() => window.location.reload()} className="bg-yellow-500 text-black px-6 py-2 rounded-lg font-bold">
          Coba Lagi
        </button>
      </div>
    );
  }

  // 3. Tampilan Account Death
  if (account.is_dead && account.dead_until && new Date(account.dead_until) > new Date()) {
    return <AccountDeathScreen deadUntil={account.dead_until} />;
  }

  // 4. Tampilan Utama Trading
  const submitOrder = async (journal: any) => {
    try {
      // Kode order engine kamu tetap di sini...
      // (Anggap fungsi fetch API /api/order kamu sudah jalan)
      alert('Order berhasil dieksekusi! (simulasi)');
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
        <div className="flex items-center gap-4">
          <button
            onClick={() => setHighVolMode(!highVolMode)}
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition ${
              highVolMode ? 'bg-red-500/20 border-red-500 text-red-400' : 'bg-gray-900 border-gray-700 text-gray-400'
            }`}
          >
            {highVolMode ? '🔥 High Volatility: ON' : '⚡ Normal Volatility'}
          </button>
          <button onClick={handleLogout} className="text-sm text-gray-400 hover:text-white">
            Logout
          </button>
        </div>
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
        <div className="col-span-6 bg-[#12161C] rounded-xl p-4 min-h-[600px] flex items-center justify-center text-gray-600">
          Chart Component Here
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
        <RevengeWarning frozenUntil={revengeFreeze} onDismiss={() => setRevengeFreeze(null)} />
      )}
    </div>
  );
}
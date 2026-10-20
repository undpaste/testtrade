'use client';
import { useEffect, useState, useRef } from 'react';
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
  
  const [isLoading, setIsLoading] = useState(true); 
  const [authError, setAuthError] = useState<string | null>(null);

  const router = useRouter();
  const hasFetched = useRef(false); // Mencegah fetch double

  useEffect(() => {
    if (hasFetched.current) return; // Kalau udah fetch, jangan ulangi
    hasFetched.current = true;

    const load = async () => {
      try {
        // 1. Ambil Session
        const { data: { session }, error: sessionErr } = await supabase.auth.getSession();
        if (sessionErr) throw sessionErr;
        if (!session) {
          router.push('/login');
          return;
        }

        const userId = session.user.id;
        const userEmail = session.user.email || 'user';

        // 2. Cek Profile (buat kalau belum ada)
        const { data: profile } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
        if (!profile) {
          await supabase.from('profiles').insert({ id: userId, username: userEmail.split('@')[0] });
        }

        // 3. Cek Akun (buat kalau belum ada)
        let { data: acc } = await supabase.from('accounts').select('*').eq('user_id', userId).maybeSingle();
        
        if (!acc) {
          const { data: newAcc, error: createErr } = await supabase
            .from('accounts')
            .insert({ user_id: userId, balance: 1000, equity: 1000 })
            .select()
            .single();
            
          if (createErr) throw new Error(`Gagal buat akun: ${createErr.message}`);
          acc = newAcc;
        }

        // 4. Ambil Orders
        const { data: ord } = await supabase
          .from('orders')
          .select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(50);

        setAccount(acc);
        setOrders(ord || []);
      } catch (err: any) {
        console.error("Load error:", err);
        setAuthError(err.message || JSON.stringify(err));
      } finally {
        setIsLoading(false);
      }
    };
    
    load();
  }, [router]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0B0E11] flex flex-col items-center justify-center text-white">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-yellow-500 mb-4"></div>
        <p className="text-gray-400">Memuat data akun...</p>
      </div>
    );
  }

  // TAMPILAN ERROR YANG JELAS
  if (authError || !account) {
    return (
      <div className="min-h-screen bg-[#0B0E11] flex flex-col items-center justify-center text-white p-6">
        <h2 className="text-2xl font-bold text-red-500 mb-4">Gagal memuat akun</h2>
        <div className="bg-red-950/50 border border-red-800 p-4 rounded-lg max-w-2xl w-full mb-6 break-words">
          <p className="text-sm font-mono text-red-300">Error: {authError || 'Akun tidak ditemukan'}</p>
        </div>
        <button onClick={() => window.location.reload()} className="bg-yellow-500 text-black px-6 py-2 rounded-lg font-bold">
          Coba Lagi
        </button>
      </div>
    );
  }

  if (account.is_dead && account.dead_until && new Date(account.dead_until) > new Date()) {
    return <AccountDeathScreen deadUntil={account.dead_until} />;
  }

  return (
    <div className="min-h-screen bg-[#0B0E11] text-white">
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
          <button onClick={handleLogout} className="text-sm text-gray-400 hover:text-white">Logout</button>
        </div>
      </header>

      <div className="p-8 text-center text-gray-500">
        <h1 className="text-2xl mb-4">Selamat datang di TestTrade!</h1>
        <p>Saldo kamu: ${account.balance.toFixed(2)}</p>
        <p className="mt-2 text-sm">UI Trading akan muncul di sini.</p>
      </div>
    </div>
  );
}
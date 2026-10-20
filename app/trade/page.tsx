'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';

export default function TradePage() {
  const [account, setAccount] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const router = useRouter();

  useEffect(() => {
    const init = async () => {
      try {
        // 1. Cek login
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          router.push('/login');
          return;
        }

        const userId = session.user.id;

        // 2. Cek akun, kalau gak ada bikin baru $1000
        let { data: acc, error } = await supabase
          .from('accounts')
          .select('*')
          .eq('user_id', userId)
          .maybeSingle();

        if (error) throw error;

        if (!acc) {
          const { data: newAcc, error: createErr } = await supabase
            .from('accounts')
            .insert({ user_id: userId, balance: 1000, equity: 1000 })
            .select()
            .single();
          if (createErr) throw createErr;
          acc = newAcc;
        }

        setAccount(acc);
      } catch (err: any) {
        setErrorMsg(err.message);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [router]);

  if (loading) return <div className="p-10 text-white bg-black min-h-screen">Loading data akun...</div>;
  if (errorMsg) return <div className="p-10 text-red-500 bg-black min-h-screen">Error: {errorMsg}</div>;
  if (!account) return <div className="p-10 text-white bg-black min-h-screen">Akun tidak ditemukan. Coba logout lalu login lagi.</div>;

  return (
    <div className="p-10 bg-black text-white min-h-screen font-mono">
      <h1 className="text-3xl font-bold text-green-400 mb-6">🎉 BERHASIL MASUK KE DASHBOARD</h1>
      
      <div className="border border-gray-700 p-6 rounded-lg bg-gray-900 max-w-md">
        <p className="mb-2">Saldo Kamu: <strong className="text-yellow-400 text-xl">${account.balance.toFixed(2)}</strong></p>
        <p className="mb-2">Total Fee: ${account.total_fees_paid}</p>
        <p className="mb-6">Status: {account.is_dead ? 'DEAD' : 'AKTIF'}</p>

        <button 
          onClick={async () => {
            await supabase.auth.signOut();
            router.push('/login');
          }}
          className="bg-red-600 px-4 py-2 rounded font-bold hover:bg-red-500"
        >
          Logout
        </button>
      </div>
    </div>
  );
}
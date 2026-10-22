'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';

type Account = {
  balance: number;
  total_fees_paid: number;
  is_dead: boolean;
};

export default function TradePage() {
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState('');
  const router = useRouter();

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

        let { data: acc, error } = await supabase
          .from('accounts')
          .select('balance, total_fees_paid, is_dead')
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

        if (!acc) throw new Error('Account could not be loaded');

        if (!cancelled) {
          setAccount({
            balance: Number(acc.balance),
            total_fees_paid: Number(acc.total_fees_paid ?? 0),
            is_dead: Boolean(acc.is_dead),
          });
        }
      } catch (error) {
        if (!cancelled) {
          setErrorMsg(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    init();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (loading) return <div className="p-10 text-white bg-black min-h-screen">Loading data akun...</div>;
  if (errorMsg) return <div className="p-10 text-red-500 bg-black min-h-screen">Error: {errorMsg}</div>;
  if (!account) return <div className="p-10 text-white bg-black min-h-screen">Akun tidak ditemukan. Coba logout lalu login lagi.</div>;

  return (
    <div className="p-10 bg-black text-white min-h-screen font-mono">
      <h1 className="text-3xl font-bold text-green-400 mb-6">🎉 BERHASIL MASUK KE DASHBOARD</h1>
      
      <div className="border border-gray-700 p-6 rounded-lg bg-gray-900 max-w-md">
        <p className="mb-2">Saldo Kamu: <strong className="text-yellow-400 text-xl">${account.balance.toFixed(2)}</strong></p>
        <p className="mb-2">Total Fee: ${account.total_fees_paid.toFixed(2)}</p>
        <p className="mb-6">Status: {account.is_dead ? 'DEAD' : 'AKTIF'}</p>

        <button 
          onClick={async () => {
            setSigningOut(true);
            setSignOutError('');
            const { error } = await supabase.auth.signOut();
            if (error) {
              setSignOutError(error.message);
              setSigningOut(false);
              return;
            }
            router.replace('/login');
          }}
          disabled={signingOut}
          className="bg-red-600 px-4 py-2 rounded font-bold hover:bg-red-500 disabled:opacity-50"
        >
          {signingOut ? 'Logging out...' : 'Logout'}
        </button>
        {signOutError && <p role="alert" className="mt-3 text-red-400">{signOutError}</p>}
      </div>
    </div>
  );
}
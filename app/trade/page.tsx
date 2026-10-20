'use client';
import { useEffect, useState } from 'react';

export default function SuperSimpleDebug() {
  const [log, setLog] = useState('Mulai ngecek...');

  useEffect(() => {
    // Fungsi ini cuma jalan SEKALI. Titik.
    async function cekKoneksi() {
      try {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

        if (!url || !key) {
          setLog("❌ ERROR: URL atau Key di Vercel KOSONG! Buka Vercel > Settings > Environment Variables. Jangan lupa klik Redeploy setelah ngisi.");
          return;
        }

        // Nembak langsung ke Supabase (tanpa library)
        const res = await fetch(`${url}/rest/v1/profiles?select=*&limit=1`, {
          headers: {
            'apikey': key,
            'Authorization': `Bearer ${key}`
          }
        });
        
        const data = await res.json();

        if (!res.ok) {
          // Kalau Supabase nolak
          setLog(`❌ SUPABASE NOLAK: ${JSON.stringify(data)}`);
        } else {
          // Kalau sukses
          setLog(`✅ KONEKSI AMAN! Vercel bisa baca database Supabase. Data sampel: ${JSON.stringify(data)}`);
        }

      } catch (err: any) {
        setLog(`💥 FATAL ERROR: ${err.message}`);
      }
    }
    
    cekKoneksi();
  }, []); // <--- Array kosong ini wajib, biar gak infinite loop

  return (
    <div style={{ padding: '40px', background: 'black', color: 'lime', fontFamily: 'monospace', minHeight: '100vh' }}>
      <h1 style={{ fontSize: '24px', marginBottom: '20px' }}>🔍 TES KONEKSI DARURAT</h1>
      <div style={{ background: '#111', padding: '20px', border: '1px solid #333', borderRadius: '8px', wordBreak: 'break-all' }}>
        {log}
      </div>
    </div>
  );
}
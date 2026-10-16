'use client';
import { useEffect, useState } from 'react';

export function AccountDeathScreen({ deadUntil }: { deadUntil: string }) {
  const [remaining, setRemaining] = useState({ d: 0, h: 0, m: 0, s: 0 });

  useEffect(() => {
    const tick = () => {
      const ms = new Date(deadUntil).getTime() - Date.now();
      const total = Math.max(0, Math.floor(ms / 1000));
      setRemaining({
        d: Math.floor(total / 86400),
        h: Math.floor((total % 86400) / 3600),
        m: Math.floor((total % 3600) / 60),
        s: total % 60,
      });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [deadUntil]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gradient-to-br from-black via-red-950 to-black">
      <div className="max-w-2xl text-center p-12">
        <div className="text-8xl mb-6 grayscale">💀</div>
        <h1 className="text-5xl font-black text-red-500 mb-4 tracking-tight">ACCOUNT DEAD</h1>
        <p className="text-xl text-gray-300 mb-8">
          You blew through $1,000. In the real world, this would be catastrophic.
          <br />Here, you get a second chance — but not immediately.
        </p>
        <div className="grid grid-cols-4 gap-4 mb-8">
          {Object.entries(remaining).map(([key, val]) => (
            <div key={key} className="bg-red-950/50 border border-red-800 rounded-lg p-4">
              <div className="text-4xl font-mono text-white">{String(val).padStart(2, '0')}</div>
              <div className="text-xs text-red-400 uppercase">{key === 'd' ? 'Days' : key === 'h' ? 'Hours' : key === 'm' ? 'Min' : 'Sec'}</div>
            </div>
          ))}
        </div>
        <p className="text-gray-400 italic mb-6">
          "The market is a device for transferring money from the impatient to the patient."
          <br />— Warren Buffett
        </p>
        <div className="text-left bg-black/50 border border-red-900 rounded-lg p-6 text-sm text-gray-300">
          <div className="font-bold text-red-400 mb-3">📚 While you wait, study:</div>
          <ul className="space-y-2">
            <li>→ Read <em>Trading in the Zone</em> by Mark Douglas</li>
            <li>→ Review your losing trades in the Journal tab</li>
            <li>→ Backtest the 2021 crash using our Backtest mode</li>
            <li>→ Analyze your emotional triggers (FOMO? Revenge? Boredom?)</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
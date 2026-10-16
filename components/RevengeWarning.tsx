'use client';
import { useEffect, useState } from 'react';

export function RevengeWarning({ frozenUntil, onDismiss }: {
  frozenUntil: string;
  onDismiss: () => void;
}) {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    const tick = () => {
      const ms = new Date(frozenUntil).getTime() - Date.now();
      setRemaining(Math.max(0, Math.floor(ms / 1000)));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [frozenUntil]);

  const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
  const ss = String(remaining % 60).padStart(2, '0');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-red-950/95 backdrop-blur">
      <div className="max-w-lg text-center p-8 border-2 border-red-500 rounded-2xl bg-black/50">
        <div className="text-6xl mb-4 animate-pulse">🛑</div>
        <h2 className="text-3xl font-bold text-red-400 mb-3">Revenge Trading Detected</h2>
        <p className="text-red-200 mb-6">
          Your last trade was a loss. Your new position is significantly larger.
          This is the #1 way traders blow accounts.
        </p>
        <p className="text-sm text-red-300 mb-4">
          Cooling-off period active. Breathe. Walk away. The market will still be here.
        </p>
        <div className="text-5xl font-mono text-white mb-6">{mm}:{ss}</div>
        <button
          onClick={onDismiss}
          disabled={remaining > 0}
          className="px-6 py-2 bg-red-600 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed hover:bg-red-500"
        >
          {remaining > 0 ? `Wait ${mm}:${ss}` : 'Continue'}
        </button>
      </div>
    </div>
  );
}
'use client';
import { useState } from 'react';

const REASONS = [
  { value: 'breakout', label: '📈 Breakout', desc: 'Price broke key resistance' },
  { value: 'support_bounce', label: '🔄 Support Bounce', desc: 'Bounced off support' },
  { value: 'trend_follow', label: '➡️ Trend Follow', desc: 'Following established trend' },
  { value: 'news', label: '📰 News Catalyst', desc: 'Reacting to fundamental news' },
  { value: 'fomo', label: '😰 FOMO', desc: 'Fear of missing out — honestly' },
  { value: 'revenge', label: '😡 Revenge', desc: 'Trying to make back losses' },
  { value: 'boredom', label: '😴 Boredom', desc: 'Just want action' },
  { value: 'signal', label: '🎯 Signal', desc: 'From a trusted signal/alert' },
];

const EMOTIONS = ['calm', 'confident', 'anxious', 'greedy', 'fearful', 'frustrated'];

export function TradeJournalModal({
  open, onClose, onSubmit, symbol, side, qty, price,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: { reason: string; emotion: string; notes: string }) => void;
  symbol: string;
  side: string;
  qty: number;
  price: number;
}) {
  const [reason, setReason] = useState('');
  const [emotion, setEmotion] = useState('calm');
  const [notes, setNotes] = useState('');

  if (!open) return null;

  const notional = qty * price;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 backdrop-blur">
      <div className="max-w-2xl w-full mx-4 bg-[#0B0E11] border border-gray-800 rounded-2xl p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="text-2xl font-bold mb-1">Confirm Order</h2>
        <p className="text-sm text-gray-400 mb-6">
          {side === 'buy' ? 'Buying' : 'Selling'} <span className="text-white font-mono">{qty} {symbol}</span> @ <span className="text-white font-mono">${price.toFixed(2)}</span>
          <span className="ml-3 text-xs">Notional: ${notional.toFixed(2)}</span>
        </p>

        <div className="mb-6">
          <label className="block text-sm font-semibold mb-3">
            Why are you entering this trade? <span className="text-red-400">*wajib</span>
          </label>
          <div className="grid grid-cols-2 gap-2">
            {REASONS.map(r => (
              <button
                key={r.value}
                onClick={() => setReason(r.value)}
                className={`text-left p-3 rounded-lg border transition ${
                  reason === r.value
                    ? 'border-yellow-500 bg-yellow-500/10'
                    : 'border-gray-800 hover:border-gray-600'
                }`}
              >
                <div className="font-semibold text-sm">{r.label}</div>
                <div className="text-xs text-gray-400">{r.desc}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="mb-6">
          <label className="block text-sm font-semibold mb-3">How do you feel?</label>
          <div className="flex flex-wrap gap-2">
            {EMOTIONS.map(e => (
              <button
                key={e}
                onClick={() => setEmotion(e)}
                className={`px-3 py-1.5 rounded-full text-sm transition ${
                  emotion === e
                    ? 'bg-yellow-500 text-black'
                    : 'bg-gray-800 hover:bg-gray-700'
                }`}
              >{e}</button>
            ))}
          </div>
        </div>

        <div className="mb-6">
          <label className="block text-sm font-semibold mb-2">Notes (optional)</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
            className="w-full bg-[#0B0E11] border border-gray-800 rounded-lg px-3 py-2 text-sm"
            placeholder="What's your thesis? Where's your stop? Target?"
          />
        </div>

        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 px-4 py-3 rounded-lg border border-gray-800 hover:bg-gray-900">
            Cancel
          </button>
          <button
            onClick={() => onSubmit({ reason, emotion, notes })}
            disabled={!reason}
            className="flex-1 px-4 py-3 rounded-lg bg-yellow-500 text-black font-bold disabled:opacity-30 hover:bg-yellow-400"
          >
            Confirm Order
          </button>
        </div>
      </div>
    </div>
  );
}
'use client';
export function RealismToggle({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!enabled)}
      className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition ${
        enabled
          ? 'bg-red-500/20 border-red-500 text-red-400'
          : 'bg-gray-900 border-gray-700 text-gray-400'
      }`}
    >
      {enabled ? '🔥 High Volatility: ON' : '⚡ Normal Volatility'}
    </button>
  );
}
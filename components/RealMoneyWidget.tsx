'use client';

export function RealMoneyWidget({ pnlUSD, region = 'ID' }: { pnlUSD: number; region?: 'ID' | 'US' }) {
  const presets = {
    ID: { rent: 3_000_000, hourly: 50_000, fx: 15800, currency: 'Rp', symbol: '🇮🇩' },
    US: { rent: 1_800, hourly: 15, fx: 1, currency: '$', symbol: '🇺🇸' },
  };
  const p = presets[region];
  const pnlLocal = pnlUSD * p.fx;
  const rentMonths = pnlLocal / p.rent;
  const hours = Math.abs(pnlLocal) / p.hourly;

  const isLoss = pnlUSD < 0;
  const absRent = Math.abs(rentMonths);

  const label = absRent >= 1
    ? `${absRent.toFixed(1)} month${absRent >= 2 ? 's' : ''} of rent`
    : `${hours.toFixed(0)} hours of minimum wage`;

  return (
    <div className={`rounded-xl p-4 border ${isLoss ? 'bg-red-950/40 border-red-800' : 'bg-green-950/40 border-green-800'}`}>
      <div className="text-xs uppercase tracking-wider opacity-60 mb-1">Real Money Equivalent</div>
      <div className={`text-2xl font-bold ${isLoss ? 'text-red-400' : 'text-green-400'}`}>
        {isLoss ? '-' : '+'}{p.currency}{Math.abs(pnlLocal).toLocaleString()}
      </div>
      <div className="text-sm text-gray-400 mt-1">
        {p.symbol} {isLoss ? 'lost' : 'gained'}: <span className="font-semibold text-white">{label}</span>
      </div>
    </div>
  );
}
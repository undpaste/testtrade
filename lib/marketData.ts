export type MarketAssetClass = 'crypto' | 'stock' | 'etf' | 'dex';
export type MarketType = 'crypto_spot' | 'crypto_perp' | 'dex_spot' | 'stock' | 'etf';

export type MarketSummary = {
  symbol: string;
  name: string;
  assetClass: MarketAssetClass;
  marketType: MarketType;
  venue: string;
  network?: string;
  poolAddress?: string;
  currency: string;
  markPrice: number;
  change24hPct: number;
  volume24h: number;
  liquidityUsd?: number;
  fundingRate: number;
  openInterest: number;
};

export type MarketLevel = { px: string; sz: string; n: number };
export type MarketCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type MarketSnapshot = {
  source: string;
  updatedAt: number;
  market: MarketSummary;
  bookSource: 'exchange' | 'simulated';
  book: { bids: MarketLevel[]; asks: MarketLevel[] };
  candles: MarketCandle[];
};

const HYPERLIQUID_INFO_URL = 'https://api.hyperliquid.xyz/info';
const BINANCE_API_URL = 'https://api.binance.com/api/v3';
const BINANCE_DATA_API_URL = 'https://data-api.binance.vision/api/v3';
const YAHOO_QUERY_URL = 'https://query1.finance.yahoo.com';
const GECKOTERMINAL_URL = 'https://api.geckoterminal.com/api/v2';
const DEFAULT_STOCK_SYMBOLS = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'BRK-B'];
const DEFAULT_ETF_SYMBOLS = ['SPY', 'QQQ', 'VOO', 'IWM', 'DIA', 'VTI', 'ARKK', 'GLD'];
const REQUEST_TIMEOUT_MS = 12_000;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numeric(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: 'no-store',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { 'User-Agent': 'TradeLabPaper/1.0', ...init?.headers },
  });
  if (!response.ok) throw new Error(`Market data provider returned ${response.status}`);
  return response.json() as Promise<T>;
}

async function fetchBinance<T>(path: string): Promise<T> {
  try {
    return await fetchJson<T>(`${BINANCE_API_URL}${path}`);
  } catch (primaryError) {
    try {
      return await fetchJson<T>(`${BINANCE_DATA_API_URL}${path}`);
    } catch (fallbackError) {
      const primaryMessage = primaryError instanceof Error ? primaryError.message : String(primaryError);
      const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      throw new Error(`Binance public data is unavailable (${primaryMessage}; fallback: ${fallbackMessage})`);
    }
  }
}

async function postHyperliquid<T>(body: UnknownRecord): Promise<T> {
  return fetchJson<T>(HYPERLIQUID_INFO_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function getHyperliquidCatalog(query: string): Promise<MarketSummary[]> {
  const [metaAndContexts, mids] = await Promise.all([
    postHyperliquid<[UnknownRecord, UnknownRecord[]]>({ type: 'metaAndAssetCtxs' }),
    postHyperliquid<Record<string, string>>({ type: 'allMids' }),
  ]);
  const universe = Array.isArray(metaAndContexts[0]?.universe) ? metaAndContexts[0].universe : [];
  const normalizedQuery = query.trim().toUpperCase();

  return universe.flatMap((item, index) => {
    if (!isRecord(item) || typeof item.name !== 'string') return [];
    const symbol = item.name;
    const context = metaAndContexts[1]?.[index] ?? {};
    const price = numeric(context.markPx, numeric(mids[symbol]));
    if (price <= 0 || (normalizedQuery && !symbol.includes(normalizedQuery))) return [];
    const previous = numeric(context.prevDayPx);
    return [{
      symbol,
      name: `${symbol} Perpetual`,
      assetClass: 'crypto' as const,
      marketType: 'crypto_perp' as const,
      venue: 'Hyperliquid',
      currency: 'USD',
      markPrice: price,
      change24hPct: previous > 0 ? ((price / previous) - 1) * 100 : 0,
      volume24h: numeric(context.dayNtlVlm),
      fundingRate: numeric(context.funding),
      openInterest: numeric(context.openInterest),
    }];
  }).sort((a, b) => b.volume24h - a.volume24h);
}

async function getBinanceCatalog(query: string): Promise<MarketSummary[]> {
  const [exchangeInfo, tickers] = await Promise.all([
    fetchBinance<{ symbols?: Array<{ symbol: string; status: string; quoteAsset: string; baseAsset: string }> }>('/exchangeInfo'),
    fetchBinance<Array<{ symbol: string; lastPrice: string; priceChangePercent: string; quoteVolume: string }>>('/ticker/24hr'),
  ]);
  const tickerBySymbol = new Map(tickers.map((ticker) => [ticker.symbol, ticker]));
  const normalizedQuery = query.trim().toUpperCase();

  return (exchangeInfo.symbols ?? []).flatMap((item) => {
    if (item.status !== 'TRADING' || item.quoteAsset !== 'USDT') return [];
    if (normalizedQuery && !item.symbol.includes(normalizedQuery) && !item.baseAsset.includes(normalizedQuery)) return [];
    const ticker = tickerBySymbol.get(item.symbol);
    if (!ticker) return [];
    const markPrice = numeric(ticker.lastPrice);
    if (markPrice <= 0) return [];
    return [{
      symbol: item.symbol,
      name: `${item.baseAsset} / ${item.quoteAsset}`,
      assetClass: 'crypto' as const,
      marketType: 'crypto_spot' as const,
      venue: 'Binance spot',
      currency: 'USDT',
      markPrice,
      change24hPct: numeric(ticker.priceChangePercent),
      volume24h: numeric(ticker.quoteVolume),
      fundingRate: 0,
      openInterest: 0,
    }];
  }).sort((a, b) => b.volume24h - a.volume24h).slice(0, 100);
}

function equityTypeMatches(type: unknown, assetClass: 'stock' | 'etf'): boolean {
  return assetClass === 'etf' ? type === 'ETF' : type === 'EQUITY';
}

async function getYahooCatalog(assetClass: 'stock' | 'etf', query: string): Promise<MarketSummary[]> {
  const searchTerm = query.trim() || '';
  const quotes = searchTerm
    ? (await fetchJson<{ quotes?: UnknownRecord[] }>(
      `${YAHOO_QUERY_URL}/v1/finance/search?q=${encodeURIComponent(searchTerm)}&quotesCount=30&newsCount=0`
    )).quotes ?? []
    : [];
  const fallbackSymbols = searchTerm ? [] : assetClass === 'stock' ? DEFAULT_STOCK_SYMBOLS : DEFAULT_ETF_SYMBOLS;
  const candidates = (quotes.length
    ? quotes.filter((quote) => equityTypeMatches(quote.quoteType, assetClass)).map((quote) => ({
      symbol: String(quote.symbol ?? ''),
      name: String(quote.shortname ?? quote.longname ?? quote.symbol ?? ''),
      price: numeric(quote.regularMarketPrice),
      change: numeric(quote.regularMarketChangePercent),
      volume: numeric(quote.regularMarketVolume),
    }))
    : fallbackSymbols.map((symbol) => ({ symbol, name: symbol, price: 0, change: 0, volume: 0 })))
    .filter((item) => /^[A-Z0-9.^=-]{1,20}$/.test(item.symbol));

  if (!candidates.length) return [];
  const priced = await Promise.all(candidates.slice(0, 16).map(async (candidate) => {
    if (candidate.price > 0) return candidate;
    const chart = await getYahooSnapshot(candidate.symbol, assetClass).catch(() => null);
    return chart ? { ...candidate, price: chart.market.markPrice, change: chart.market.change24hPct, volume: chart.market.volume24h } : candidate;
  }));

  return priced.filter((item) => item.price > 0).map((item) => ({
    symbol: item.symbol,
    name: item.name,
    assetClass,
    marketType: assetClass,
    venue: 'US market',
    currency: 'USD',
    markPrice: item.price,
    change24hPct: item.change,
    volume24h: item.volume,
    fundingRate: 0,
    openInterest: 0,
  })).sort((a, b) => b.volume24h - a.volume24h);
}

function makeSimulatedBook(price: number, volume: number): { bids: MarketLevel[]; asks: MarketLevel[] } {
  const spread = Math.max(price * 0.0002, Math.min(price * 0.002, 0.01));
  const depthBase = Math.max(volume / Math.max(price, 1) / 86_400, 0.001);
  return {
    bids: Array.from({ length: 20 }, (_, index) => ({
      px: (price - spread * (index + 1)).toPrecision(12),
      sz: (depthBase * (1 + index * 0.35)).toPrecision(8),
      n: 1 + (index % 4),
    })),
    asks: Array.from({ length: 20 }, (_, index) => ({
      px: (price + spread * (index + 1)).toPrecision(12),
      sz: (depthBase * (1 + index * 0.32)).toPrecision(8),
      n: 1 + ((index + 2) % 4),
    })),
  };
}

function parseGeckoPool(pool: UnknownRecord, network: string): MarketSummary | null {
  const attributes = isRecord(pool.attributes) ? pool.attributes : {};
  const address = typeof attributes.address === 'string' ? attributes.address : '';
  const symbol = typeof attributes.name === 'string'
    ? `${attributes.name.replace(/\s*\/\s*/g, '-')}-${address.slice(2, 10)}`
    : '';
  const price = numeric(attributes.base_token_price_usd);
  if (!address || !symbol || price <= 0) return null;
  const volume = isRecord(attributes.volume_usd) ? numeric(attributes.volume_usd.h24) : 0;
  const change = isRecord(attributes.price_change_percentage)
    ? numeric(attributes.price_change_percentage.h24)
    : 0;
  return {
    symbol,
    name: String(attributes.name),
    assetClass: 'dex',
    marketType: 'dex_spot',
    venue: 'GeckoTerminal DEX pool',
    currency: 'USD',
    markPrice: price,
    change24hPct: change,
    volume24h: volume,
    liquidityUsd: numeric(attributes.reserve_in_usd),
    fundingRate: 0,
    openInterest: 0,
    network,
    poolAddress: address,
  };
}

async function getDexCatalog(query: string): Promise<MarketSummary[]> {
  const network = 'eth';
  const data = await fetchJson<{ data?: UnknownRecord[] }>(
    `${GECKOTERMINAL_URL}/networks/${network}/trending_pools?page=1`,
    { headers: { Accept: 'application/json;version=20230302' } }
  );
  const normalizedQuery = query.trim().toUpperCase();
  return (data.data ?? []).flatMap((pool) => {
    const summary = parseGeckoPool(pool, network);
    return summary && (!normalizedQuery || summary.symbol.toUpperCase().includes(normalizedQuery) || summary.name.toUpperCase().includes(normalizedQuery))
      ? [summary]
      : [];
  });
}

async function getYahooSnapshot(symbol: string, assetClass: 'stock' | 'etf'): Promise<MarketSnapshot | null> {
  const url = `${YAHOO_QUERY_URL}/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1m`;
  const data = await fetchJson<UnknownRecord>(url);
  const chart = isRecord(data.chart) ? data.chart : {};
  const result = Array.isArray(chart.result) ? chart.result[0] : null;
  if (!isRecord(result) || !isRecord(result.meta)) return null;

  const meta = result.meta;
  const quoteContainer = Array.isArray(result.indicators) && isRecord(result.indicators[0]) ? result.indicators[0] : {};
  const quote = Array.isArray(quoteContainer.quote) && isRecord(quoteContainer.quote[0]) ? quoteContainer.quote[0] : {};
  const timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];
  const closes = Array.isArray(quote.close) ? quote.close : [];
  const opens = Array.isArray(quote.open) ? quote.open : [];
  const highs = Array.isArray(quote.high) ? quote.high : [];
  const lows = Array.isArray(quote.low) ? quote.low : [];
  const volumes = Array.isArray(quote.volume) ? quote.volume : [];
  const candles: MarketCandle[] = timestamps.flatMap((timestamp, index) => {
    const open = numeric(opens[index]);
    const high = numeric(highs[index]);
    const low = numeric(lows[index]);
    const close = numeric(closes[index]);
    if (open <= 0 || high <= 0 || low <= 0 || close <= 0) return [];
    return [{ time: numeric(timestamp) * 1000, open, high, low, close, volume: numeric(volumes[index]) }];
  });

  const lastCandle = candles[candles.length - 1];
  const price = numeric(meta.regularMarketPrice, lastCandle?.close ?? 0);
  if (price <= 0) return null;
  const previousClose = numeric(meta.chartPreviousClose, numeric(meta.previousClose));
  const volume = numeric(meta.regularMarketVolume);
  const market: MarketSummary = {
    symbol,
    name: String(meta.longName ?? meta.shortName ?? symbol),
    assetClass,
    marketType: assetClass,
    venue: 'US market',
    currency: String(meta.currency ?? 'USD'),
    markPrice: price,
    change24hPct: previousClose > 0 ? ((price / previousClose) - 1) * 100 : 0,
    volume24h: volume,
    fundingRate: 0,
    openInterest: 0,
  };
  return {
    source: 'Yahoo Finance chart data (delayed; provider availability may vary)',
    updatedAt: Date.now(),
    market,
    bookSource: 'simulated',
    book: makeSimulatedBook(price, volume),
    candles,
  };
}

async function getDexSnapshot(symbol: string, poolAddress: string, network = 'eth'): Promise<MarketSnapshot> {
  if (!/^0x[a-fA-F0-9]{40}$/.test(poolAddress)) throw new Error('Invalid DEX pool address');
  const [poolResponse, ohlcvResponse] = await Promise.all([
    fetchJson<{ data?: UnknownRecord }>(
      `${GECKOTERMINAL_URL}/networks/${network}/pools/${poolAddress}`,
      { headers: { Accept: 'application/json;version=20230302' } }
    ),
    fetchJson<{ data?: { attributes?: { ohlcv_list?: unknown[][] } } }>(
      `${GECKOTERMINAL_URL}/networks/${network}/pools/${poolAddress}/ohlcv/minute?aggregate=1&limit=100&currency=usd`,
      { headers: { Accept: 'application/json;version=20230302' } }
    ),
  ]);
  const attributes = isRecord(poolResponse.data?.attributes) ? poolResponse.data.attributes : {};
  const price = numeric(attributes.base_token_price_usd);
  const reserveUsd = numeric(attributes.reserve_in_usd);
  if (price <= 0 || reserveUsd <= 0) throw new Error('DEX pool price or liquidity is unavailable');
  const summary = parseGeckoPool(poolResponse.data ?? {}, network) ?? {
    symbol,
    name: symbol,
    assetClass: 'dex' as const,
    marketType: 'dex_spot' as const,
    venue: 'GeckoTerminal DEX pool',
    currency: 'USD',
    markPrice: price,
    change24hPct: 0,
    volume24h: 0,
    fundingRate: 0,
    openInterest: 0,
    network,
    poolAddress,
  };
  const ohlcv = ohlcvResponse.data?.attributes?.ohlcv_list ?? [];
  const candles = ohlcv.flatMap((row) => {
    if (row.length < 6) return [];
    const [time, open, high, low, close, volume] = row;
    return [{
      time: numeric(time) * 1000,
      open: numeric(open),
      high: numeric(high),
      low: numeric(low),
      close: numeric(close),
      volume: numeric(volume),
    }];
  }).filter((candle) => candle.open > 0 && candle.high > 0 && candle.low > 0 && candle.close > 0).reverse();
  return {
    source: 'GeckoTerminal public pool data',
    updatedAt: Date.now(),
    market: { ...summary, markPrice: price, liquidityUsd: reserveUsd },
    bookSource: 'simulated',
    book: makeSimulatedBook(price, reserveUsd),
    candles,
  };
}

export async function getMarketCatalog(assetClass: MarketAssetClass, query = ''): Promise<MarketSummary[]> {
  if (assetClass === 'crypto') {
    const [perpetuals, spot] = await Promise.all([
      getHyperliquidCatalog(query),
      getBinanceCatalog(query),
    ]);
    return [...perpetuals, ...spot].sort((a, b) => b.volume24h - a.volume24h);
  }
  if (assetClass === 'dex') return getDexCatalog(query);
  return getYahooCatalog(assetClass, query);
}

async function fetchMarketSnapshot(
  assetClass: MarketAssetClass,
  symbol: string,
  marketType?: MarketType,
  poolAddress?: string,
  network?: string
): Promise<MarketSnapshot> {
  if (assetClass === 'crypto' && marketType === 'crypto_spot') {
    const [ticker, book, rawCandles] = await Promise.all([
      fetchBinance<{ lastPrice: string; priceChangePercent: string; quoteVolume: string }>(
        `/ticker/24hr?symbol=${encodeURIComponent(symbol)}`
      ),
      fetchBinance<{ bids: string[][]; asks: string[][] }>(`/depth?symbol=${encodeURIComponent(symbol)}&limit=20`),
      fetchBinance<Array<[number, string, string, string, string, string]>>(
        `/klines?symbol=${encodeURIComponent(symbol)}&interval=1m&limit=100`
      ),
    ]);
    const price = numeric(ticker.lastPrice);
    if (price <= 0) throw new Error('Spot market price is unavailable');
    const candles: MarketCandle[] = rawCandles.flatMap((candle) => {
      const open = numeric(candle[1]);
      const high = numeric(candle[2]);
      const low = numeric(candle[3]);
      const close = numeric(candle[4]);
      if (!open || !high || !low || !close) return [];
      return [{ time: numeric(candle[0]), open, high, low, close, volume: numeric(candle[5]) }];
    });
    return {
      source: 'Binance public spot market data',
      updatedAt: Date.now(),
      market: {
        symbol, name: symbol, assetClass: 'crypto', marketType: 'crypto_spot',
        venue: 'Binance spot', currency: 'USDT', markPrice: price,
        change24hPct: numeric(ticker.priceChangePercent), volume24h: numeric(ticker.quoteVolume),
        fundingRate: 0, openInterest: 0,
      },
      bookSource: 'exchange',
      book: {
        bids: book.bids.map(([px, sz]) => ({ px, sz, n: 1 })),
        asks: book.asks.map(([px, sz]) => ({ px, sz, n: 1 })),
      },
      candles,
    };
  }

  if (assetClass === 'stock' || assetClass === 'etf') {
    const snapshot = await getYahooSnapshot(symbol, assetClass);
    if (!snapshot) throw new Error(`No ${assetClass.toUpperCase()} quote is available for ${symbol}`);
    return snapshot;
  }
  if (assetClass === 'dex') {
    if (!poolAddress) throw new Error('A DEX pool address is required to fetch its price');
    return getDexSnapshot(symbol, poolAddress, network);
  }

  const [metaAndContexts, mids, book, candles] = await Promise.all([
    postHyperliquid<[UnknownRecord, UnknownRecord[]]>({ type: 'metaAndAssetCtxs' }),
    postHyperliquid<Record<string, string>>({ type: 'allMids' }),
    postHyperliquid<{ levels?: Array<Array<{ px: string; sz: string; n: number }>> }>({ type: 'l2Book', coin: symbol }),
    postHyperliquid<Array<{ t: number; o: string; h: string; l: string; c: string; v: string }>>({
      type: 'candleSnapshot',
      req: { coin: symbol, interval: '1m', startTime: Date.now() - 100 * 60_000, endTime: Date.now() },
    }),
  ]);
  const universe = Array.isArray(metaAndContexts[0]?.universe) ? metaAndContexts[0].universe : [];
  const index = universe.findIndex((item) => isRecord(item) && item.name === symbol);
  if (index < 0) throw new Error(`No crypto perpetual market is available for ${symbol}`);
  const context = metaAndContexts[1]?.[index] ?? {};
  const price = numeric(mids[symbol], numeric(context.markPx));
  if (price <= 0) throw new Error('Crypto market price is unavailable');

  return {
    source: 'Hyperliquid public perpetual market data',
    updatedAt: Date.now(),
    market: {
      symbol, name: `${symbol} Perpetual`, assetClass: 'crypto', marketType: 'crypto_perp',
      venue: 'Hyperliquid', currency: 'USD', markPrice: price,
      change24hPct: numeric(context.prevDayPx) > 0 ? ((price / numeric(context.prevDayPx)) - 1) * 100 : 0,
      volume24h: numeric(context.dayNtlVlm), fundingRate: numeric(context.funding), openInterest: numeric(context.openInterest),
    },
    bookSource: 'exchange',
    book: { bids: book.levels?.[0] ?? [], asks: book.levels?.[1] ?? [] },
    candles: candles.map((candle) => ({
      time: candle.t, open: numeric(candle.o), high: numeric(candle.h), low: numeric(candle.l),
      close: numeric(candle.c), volume: numeric(candle.v),
    })),
  };
}

const snapshotCache = new Map<string, { expiresAt: number; value: Promise<MarketSnapshot> }>();

export function getMarketSnapshot(
  assetClass: MarketAssetClass,
  symbol: string,
  marketType?: MarketType,
  poolAddress?: string,
  network?: string
): Promise<MarketSnapshot> {
  const key = [assetClass, marketType ?? '', symbol, poolAddress ?? '', network ?? ''].join(':');
  const cached = snapshotCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const value = fetchMarketSnapshot(assetClass, symbol, marketType, poolAddress, network);
  snapshotCache.set(key, { expiresAt: Date.now() + 2_500, value });
  value.catch(() => {
    if (snapshotCache.get(key)?.value === value) snapshotCache.delete(key);
  });
  return value;
}

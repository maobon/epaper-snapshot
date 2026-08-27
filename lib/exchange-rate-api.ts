const FRANKFURTER_RATES_URL = 'https://api.frankfurter.dev/v2/rates';
const RANGE_DAYS = 30;
const CACHE_TTL_MS = Math.max(1_000, Number(process.env.EXCHANGE_RATE_CACHE_TTL_MS) || 300_000);

type FrankfurterRate = {
  date?: string;
  base?: string;
  quote?: string;
  rate?: number;
};

export type ExchangeRatePoint = {
  date: string;
  rate: number;
};

export type ExchangeRateSeries = {
  currentDate: string;
  points: ExchangeRatePoint[];
};

type ExchangeRateCacheEntry = { expiresAt: number; promise: Promise<ExchangeRateSeries> };
const exchangeRateCacheGlobal = globalThis as typeof globalThis & {
  __weatherEpaperExchangeRateCache?: ExchangeRateCacheEntry;
};

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export async function fetchMonthlyUsdCnh(): Promise<ExchangeRateSeries> {
  const cachedRates = exchangeRateCacheGlobal.__weatherEpaperExchangeRateCache;
  if (cachedRates && cachedRates.expiresAt > Date.now()) return cachedRates.promise;
  const promise = fetchMonthlyUsdCnhUncached();
  exchangeRateCacheGlobal.__weatherEpaperExchangeRateCache = {
    expiresAt: (Math.floor(Date.now() / CACHE_TTL_MS) + 1) * CACHE_TTL_MS,
    promise,
  };
  promise.catch(() => {
    if (exchangeRateCacheGlobal.__weatherEpaperExchangeRateCache?.promise === promise) {
      exchangeRateCacheGlobal.__weatherEpaperExchangeRateCache = undefined;
    }
  });
  return promise;
}

async function fetchMonthlyUsdCnhUncached(): Promise<ExchangeRateSeries> {
  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setUTCDate(endDate.getUTCDate() - (RANGE_DAYS - 1));

  const endpoint = new URL(FRANKFURTER_RATES_URL);
  endpoint.search = new URLSearchParams({
    from: formatDate(startDate),
    to: formatDate(endDate),
    base: 'USD',
    quotes: 'CNH',
  }).toString();

  const response = await fetch(endpoint, {
    headers: {
      Accept: 'application/json',
    },
    next: { revalidate: Math.ceil(CACHE_TTL_MS / 1_000) },
  });
  if (!response.ok) throw new Error(`Frankfurter returned ${response.status}`);

  const payload = (await response.json()) as FrankfurterRate[];
  const points = payload
    .filter((item): item is Required<FrankfurterRate> => (
      typeof item.date === 'string'
      && item.base === 'USD'
      && item.quote === 'CNH'
      && typeof item.rate === 'number'
    ))
    .map(({ date, rate }) => ({ date, rate }))
    .sort((left, right) => left.date.localeCompare(right.date));

  if (points.length < 15) throw new Error('Frankfurter returned too few monthly USD/CNH observations');
  return { currentDate: points.at(-1)!.date, points };
}

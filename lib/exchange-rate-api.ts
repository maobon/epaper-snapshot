const FRANKFURTER_RATES_URL = 'https://api.frankfurter.dev/v2/rates';
const RANGE_DAYS = 30;

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

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export async function fetchMonthlyUsdCnh(): Promise<ExchangeRateSeries> {
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
    cache: 'no-store',
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

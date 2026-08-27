const WEATHER_API_BASE_URL = process.env.WEATHER_API_BASE_URL || 'https://h5-api.zuimeitianqi.com/h5en/api/';
const WEATHER_PAGE_ORIGIN = 'https://samsung-h5.zuimeitianqi.com/';

const commonParams = {
  lan: 'en-us',
  cityId: '0101010102',
  partner: '994522173e38afd27b732e8ec3b2fa80',
  metric: 'true',
};

type WeatherEndpoint = 'hw-daily' | 'hw-days' | 'hw-hourly';
type WeatherEnvelope<T> = { data?: T };
type WeatherCacheEntry = { expiresAt: number; promise: Promise<unknown> };

const cacheTtl = Math.max(1_000, Number(process.env.WEATHER_CACHE_TTL_MS) || 300_000);
const weatherCacheGlobal = globalThis as typeof globalThis & {
  __weatherEpaperResponseCache?: Map<WeatherEndpoint, WeatherCacheEntry>;
};
// Next.js can bundle pages and route handlers as separate module instances. Keep
// one process-wide cache so the HTML screenshot and PNG API use the same source
// response instead of taking slightly different live-weather snapshots.
const responseCache = weatherCacheGlobal.__weatherEpaperResponseCache ??= new Map();

async function fetchWeatherData<T>(endpointName: WeatherEndpoint): Promise<T> {
  const cached = responseCache.get(endpointName);
  if (cached && cached.expiresAt > Date.now()) return cached.promise as Promise<T>;

  const promise = fetchWeatherDataUncached<T>(endpointName);
  const expiresAt = (Math.floor(Date.now() / cacheTtl) + 1) * cacheTtl;
  responseCache.set(endpointName, { expiresAt, promise });
  promise.catch(() => {
    if (responseCache.get(endpointName)?.promise === promise) responseCache.delete(endpointName);
  });
  return promise;
}

async function fetchWeatherDataUncached<T>(endpointName: WeatherEndpoint): Promise<T> {
  const endpoint = new URL(endpointName, WEATHER_API_BASE_URL);
  endpoint.search = new URLSearchParams({
    ...commonParams,
    updateTime: String(Math.floor(Date.now() / cacheTtl) * cacheTtl),
  }).toString();

  const response = await fetch(endpoint, {
    headers: {
      Accept: 'application/json',
      Referer: WEATHER_PAGE_ORIGIN,
    },
    next: { revalidate: Math.ceil(cacheTtl / 1_000) },
  });

  if (!response.ok) {
    throw new Error(`${endpointName} returned ${response.status}`);
  }

  const payload = (await response.json()) as WeatherEnvelope<T>;
  if (!payload.data) {
    throw new Error(`${endpointName} returned no data`);
  }

  return payload.data;
}

export function fetchHourlyWeather<T>() {
  return fetchWeatherData<T>('hw-hourly');
}

export function fetchDailyWeather<T>() {
  return fetchWeatherData<T>('hw-daily');
}

export function fetchDaysWeather<T>() {
  return fetchWeatherData<T>('hw-days');
}

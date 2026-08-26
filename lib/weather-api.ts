const WEATHER_API_BASE_URL = 'https://h5-api.zuimeitianqi.com/h5en/api/';
const WEATHER_PAGE_ORIGIN = 'https://samsung-h5.zuimeitianqi.com/';

const commonParams = {
  lan: 'en-us',
  cityId: '0101010102',
  partner: '994522173e38afd27b732e8ec3b2fa80',
  metric: 'true',
};

type WeatherEndpoint = 'hw-daily' | 'hw-days' | 'hw-hourly';
type WeatherEnvelope<T> = { data?: T };

async function fetchWeatherData<T>(endpointName: WeatherEndpoint): Promise<T> {
  const endpoint = new URL(endpointName, WEATHER_API_BASE_URL);
  endpoint.search = new URLSearchParams({
    ...commonParams,
    updateTime: String(Date.now()),
  }).toString();

  const response = await fetch(endpoint, {
    headers: {
      Accept: 'application/json',
      Referer: WEATHER_PAGE_ORIGIN,
    },
    cache: 'no-store',
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

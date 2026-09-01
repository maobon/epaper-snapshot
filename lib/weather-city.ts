export type WeatherCity = {
  key: string;
  cityId: string;
  name: string;
};

const defaultCities: WeatherCity[] = [
  { key: 'beijing', cityId: '0101010102', name: 'Beijing' },
];

function parseConfiguredCities(value?: string): WeatherCity[] {
  if (!value?.trim()) return defaultCities;

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(`WEATHER_CITIES must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('WEATHER_CITIES must be a non-empty JSON array');
  }

  const cities = parsed.map((item, index) => {
    if (!item || typeof item !== 'object') throw new Error(`WEATHER_CITIES[${index}] must be an object`);
    const candidate = item as Partial<WeatherCity>;
    const key = candidate.key?.trim().toLowerCase();
    const cityId = candidate.cityId?.trim();
    const name = candidate.name?.trim();
    if (!key || !/^[a-z0-9][a-z0-9-]*$/.test(key)) {
      throw new Error(`WEATHER_CITIES[${index}].key must contain only lowercase letters, numbers, and hyphens`);
    }
    if (!cityId) throw new Error(`WEATHER_CITIES[${index}].cityId is required`);
    if (!name) throw new Error(`WEATHER_CITIES[${index}].name is required`);
    return { key, cityId, name };
  });

  if (new Set(cities.map((city) => city.key)).size !== cities.length) {
    throw new Error('WEATHER_CITIES contains duplicate keys');
  }
  return cities;
}

const configuredCities = parseConfiguredCities(process.env.WEATHER_CITIES);

export function getWeatherCities(): readonly WeatherCity[] {
  return configuredCities;
}

export function getDefaultWeatherCity(): WeatherCity {
  return configuredCities[0];
}

export function findWeatherCity(key?: string | null): WeatherCity | undefined {
  if (!key) return getDefaultWeatherCity();
  return configuredCities.find((city) => city.key === key.trim().toLowerCase());
}

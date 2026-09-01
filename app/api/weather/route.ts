import { findWeatherCity, getWeatherCities, type WeatherCity } from '@/lib/weather-city';
import { loadForecast15Dashboard, loadLandscapeDashboard, loadPortraitDashboard } from '@/lib/weather-dashboard';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const views = ['landscape', 'portrait', 'forecast-15d'] as const;
type WeatherView = (typeof views)[number];

function requestedCities(url: URL): WeatherCity[] {
  const keys = url.searchParams.getAll('city').flatMap((value) => value.split(',')).map((value) => value.trim()).filter(Boolean);
  if (keys.length === 0) return [...getWeatherCities()];

  const cities = keys.map((key) => {
    const city = findWeatherCity(key);
    if (!city) throw new Error(`Unknown city "${key}"`);
    return city;
  });
  return cities.filter((city, index) => cities.findIndex((candidate) => candidate.key === city.key) === index);
}

function loadView(view: WeatherView, city: WeatherCity) {
  if (view === 'landscape') return loadLandscapeDashboard(city);
  if (view === 'portrait') return loadPortraitDashboard(city);
  return loadForecast15Dashboard(city);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedView = url.searchParams.get('view') ?? 'landscape';
  if (!views.includes(requestedView as WeatherView)) {
    return Response.json({ error: `Unknown view. Use ${views.join(', ')}.` }, { status: 400 });
  }

  try {
    const cities = requestedCities(url);
    const results = await Promise.all(cities.map(async (city) => ({
      key: city.key,
      cityId: city.cityId,
      ...(await loadView(requestedView as WeatherView, city)),
    })));
    return Response.json({ view: requestedView, results });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

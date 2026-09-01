import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CloudIcon } from '@phosphor-icons/react/dist/ssr/Cloud';
import { CloudLightningIcon } from '@phosphor-icons/react/dist/ssr/CloudLightning';
import { CloudRainIcon } from '@phosphor-icons/react/dist/ssr/CloudRain';
import { CloudSnowIcon } from '@phosphor-icons/react/dist/ssr/CloudSnow';
import { CloudSunIcon } from '@phosphor-icons/react/dist/ssr/CloudSun';
import { DropIcon } from '@phosphor-icons/react/dist/ssr/Drop';
import { SunIcon } from '@phosphor-icons/react/dist/ssr/Sun';
import { createRenderManifest, serializeRenderManifest } from '@/lib/render-monitor';
import { findWeatherCity } from '@/lib/weather-city';
import { loadForecast15Dashboard } from '@/lib/weather-dashboard';

export const metadata: Metadata = {
  title: 'Weather · 15-Day Forecast',
  description: 'A live 480 by 800 pixel, four-level grayscale 15-day weather forecast for portrait e-paper displays.',
  openGraph: {
    title: 'Weather · 15-Day Forecast',
    description: 'Live 15-day weather data in a 480 × 800 four-level grayscale e-paper layout.',
    images: [],
  },
  twitter: {
    card: 'summary',
    title: 'Weather · 15-Day Forecast',
    description: 'Live 15-day weather data in a 480 × 800 four-level grayscale e-paper layout.',
    images: [],
  },
};

export const dynamic = 'force-dynamic';

const weatherIcons = {
  cloudy: CloudIcon,
  rain: CloudRainIcon,
  partly: CloudSunIcon,
  snow: CloudSnowIcon,
  storm: CloudLightningIcon,
  sunny: SunIcon,
};

export default async function FifteenDayForecast({ searchParams }: { searchParams: Promise<{ city?: string | string[] }> }) {
  const cityKey = (await searchParams).city;
  const configuredCity = findWeatherCity(Array.isArray(cityKey) ? cityKey[0] : cityKey);
  if (!configuredCity) notFound();
  const loaded = await loadForecast15Dashboard(configuredCity);
  const { city, forecast, range, windSpeedUnit } = loaded.data;
  const manifest = createRenderManifest('forecast-15d', loaded.source, loaded.data);

  return (
    <main className="portrait-stage grid min-h-screen min-w-[480px] place-items-center bg-white font-sans text-black">
      <script id="render-monitor-manifest" type="application/json" dangerouslySetInnerHTML={{ __html: serializeRenderManifest(manifest) }} />
      <section className="epaper-forecast15 flex h-[800px] w-[480px] flex-col gap-[3px] overflow-hidden rounded-none border-2 border-black bg-white p-2" aria-label={`${city} 15-day weather forecast`}>
        <header className="forecast15-header shrink-0 overflow-hidden bg-white px-2 py-1.5">
          <div className="flex h-full items-center justify-between">
            <div>
              <h1 className="forecast15-title text-base leading-none font-semibold tracking-tight">15-DAY FORECAST</h1>
              <p className="forecast15-subtitle mt-1 text-[9px] font-semibold tracking-wide text-[#555] uppercase">{city} · {range}</p>
            </div>
          </div>
        </header>

        <section className="forecast15-list flex flex-col gap-[3px] overflow-hidden" aria-label="Daily forecasts">
          {forecast.map((item) => {
            const WeatherIcon = weatherIcons[item.kind];
            return (
              <article
                className="forecast15-columns forecast15-row shrink-0 items-center overflow-hidden bg-white px-2"
                key={item.date}
                aria-label={`${item.day} ${item.date}, ${item.condition}, high ${item.high}, low ${item.low}, ${item.rain} percent rain, wind ${item.windDirection} ${item.windSpeed} ${windSpeedUnit}`}
              >
                <div className="leading-tight">
                  <h2 className="forecast15-day text-[11px] font-semibold">{item.day}</h2>
                  <p className="forecast15-date text-[9px] text-[#555]">{item.date}</p>
                </div>
                <WeatherIcon className="-translate-x-[10px]" color="#555" size={36} weight="light" aria-hidden="true" />
                <p className="forecast15-temperature text-[11px] whitespace-nowrap"><strong className="font-semibold">{item.high}°</strong><span className="text-[#555]"> / {item.low}°</span></p>
                <p className="forecast15-rain flex translate-x-[10px] items-center gap-1 text-[10px]"><DropIcon color="#555" size={13} weight="light" aria-hidden="true" /><span>{item.rain}%</span></p>
                <div className="min-w-0 max-w-full justify-self-end text-right leading-tight">
                  <p className="forecast15-wind truncate text-[10px] font-semibold">{item.windDirection} · {item.windSpeed} {windSpeedUnit}</p>
                  <p className="forecast15-condition truncate text-[8px] text-[#555]">{item.condition}</p>
                </div>
              </article>
            );
          })}
        </section>
      </section>
    </main>
  );
}

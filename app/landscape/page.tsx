import type { Metadata } from 'next';
import { CloudIcon } from '@phosphor-icons/react/dist/ssr/Cloud';
import { CloudLightningIcon } from '@phosphor-icons/react/dist/ssr/CloudLightning';
import { CloudMoonIcon } from '@phosphor-icons/react/dist/ssr/CloudMoon';
import { CloudRainIcon } from '@phosphor-icons/react/dist/ssr/CloudRain';
import { CloudSnowIcon } from '@phosphor-icons/react/dist/ssr/CloudSnow';
import { CloudSunIcon } from '@phosphor-icons/react/dist/ssr/CloudSun';
import { MoonStarsIcon } from '@phosphor-icons/react/dist/ssr/MoonStars';
import { SunIcon } from '@phosphor-icons/react/dist/ssr/Sun';
import { createRenderManifest, serializeRenderManifest } from '@/lib/render-monitor';
import { loadLandscapeDashboard, type LandscapeDashboard } from '@/lib/weather-dashboard';
import type { WeatherDisplayKind } from '@/lib/weather-presentation';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Beijing Weather',
  description: 'A live 800 by 480 pixel four-level grayscale weather dashboard for e-paper displays.',
  openGraph: {
    title: 'Beijing Weather',
    description: 'Live 800 × 480 weather dashboard for e-paper displays.',
    images: [],
  },
  twitter: {
    card: 'summary',
    title: 'Beijing Weather',
    description: 'Live 800 × 480 weather dashboard for e-paper displays.',
    images: [],
  },
};

const weatherIcons = {
  sunny: SunIcon,
  'night-clear': MoonStarsIcon,
  partly: CloudSunIcon,
  rain: CloudRainIcon,
  storm: CloudLightningIcon,
  snow: CloudSnowIcon,
  'partly-small': CloudMoonIcon,
  cloudy: CloudIcon,
};

function WeatherIcon({ kind, inverted = false }: { kind: WeatherDisplayKind; inverted?: boolean }) {
  const Icon = weatherIcons[kind];
  return (
    <span className="mt-1 flex h-[57px] w-[70px] items-center justify-center" aria-hidden="true">
      <Icon color={inverted ? '#fff' : '#000'} size={54} weight="light" />
    </span>
  );
}

function makeChartPoints(hourly: LandscapeDashboard['hourly']) {
  const temperatures = hourly.map((item) => item.temp);
  const min = Math.min(...temperatures);
  const max = Math.max(...temperatures);
  const span = Math.max(1, max - min);
  return hourly.map((item, index) => ({
    x: (index * 746) / Math.max(1, hourly.length - 1),
    y: 68 - ((item.temp - min) / span) * 52,
  }));
}

export default async function LandscapeWeather() {
  const loaded = await loadLandscapeDashboard();
  const dashboard = loaded.data;
  const manifest = createRenderManifest('landscape', loaded.source, dashboard);
  const CurrentIcon = weatherIcons[dashboard.current.kind];
  const chartPoints = makeChartPoints(dashboard.hourly);
  const highestTemperature = Math.max(...dashboard.hourly.map((item) => item.temp));
  const areaPoints = ['0 100%', ...chartPoints.map(({ x, y }) => `${x}px ${y}px`), '746px 100%'].join(', ');
  const labelIndices = [0, 3, 6, 9, 12, 15, 18, 21].filter((index) => index < dashboard.hourly.length);

  return (
    <main className="screen-stage grid min-h-screen min-w-[800px] place-items-center bg-white font-sans text-black">
      <script id="render-monitor-manifest" type="application/json" dangerouslySetInnerHTML={{ __html: serializeRenderManifest(manifest) }} />
      <section className="epaper-landscape h-[480px] w-[800px] overflow-hidden rounded-none border-2 border-black bg-white p-3" aria-label={`${dashboard.city} weather dashboard`}>
        <header className="flex h-8 items-center justify-between">
          <div className="flex items-center rounded-full border border-[#555] bg-white px-3 py-1 text-sm font-semibold tracking-wide">
            {dashboard.city}
          </div>
          <div className="flex items-center gap-2 text-xs font-semibold tracking-wide">
            <span className="text-[#555]">{dashboard.dateLabel}</span>
            <span className="rounded-full bg-black px-3 py-1 text-white">{dashboard.current.condition.toUpperCase()}</span>
          </div>
        </header>

        <section className="mt-2 flex h-[100px] items-center rounded-2xl border border-[#555] bg-white px-4" aria-label="Current weather">
          <span className="flex h-[66px] w-[66px] shrink-0 items-center justify-center rounded-full border border-black bg-white" aria-hidden="true">
            <CurrentIcon color="#000" size={50} weight="light" />
          </span>
          <div className="ml-4 flex items-start">
            <span className="text-[60px] leading-[.85] font-semibold tracking-[-4px]">{dashboard.current.temp}</span>
            <span className="mt-1 ml-2 flex gap-1 text-xl leading-none text-[#555]"><strong className="font-semibold text-black">°C</strong></span>
          </div>
          <div className="ml-4 max-w-[150px]">
            <h1 className="text-lg leading-tight font-semibold tracking-tight">{dashboard.current.condition}</h1>
            <p className="truncate text-sm text-[#555]">Live conditions</p>
          </div>
          <dl className="ml-auto grid h-[68px] w-[342px] grid-cols-3 divide-x divide-[#555] rounded-xl border border-[#555] bg-white">
            <div className="flex flex-col items-center justify-center"><dt className="text-[10px] font-semibold tracking-wider text-[#555] uppercase">Rain</dt><dd className="mt-1 text-lg leading-none font-semibold">{dashboard.current.rain}%</dd></div>
            <div className="flex flex-col items-center justify-center"><dt className="text-[10px] font-semibold tracking-wider text-[#555] uppercase">Humidity</dt><dd className="mt-1 text-lg leading-none font-semibold">{dashboard.current.humidity}%</dd></div>
            <div className="flex flex-col items-center justify-center"><dt className="text-[10px] font-semibold tracking-wider text-[#555] uppercase">Wind</dt><dd className="mt-1 text-lg leading-none font-semibold">{dashboard.current.wind} km/h</dd></div>
          </dl>
        </section>

        <section className="mt-2 h-[154px] rounded-2xl border border-[#555] bg-white px-3 py-2" aria-label="Hourly temperature forecast">
          <div className="flex h-6 items-center justify-between">
            <h2 className="text-sm font-semibold tracking-tight">Next 24 hours</h2>
            <span className="rounded-md bg-black px-2 py-0.5 text-[10px] font-semibold text-white">TEMPERATURE</span>
          </div>
          <div className="relative h-[82px] w-[746px] overflow-visible border-b border-[#aaa]">
            <div className="chart-area" style={{ clipPath: `polygon(${areaPoints})` }} />
            {chartPoints.slice(0, -1).map((point, index) => {
              const next = chartPoints[index + 1];
              const dx = next.x - point.x;
              const dy = next.y - point.y;
              return <i className="chart-line" key={`${point.x}-${point.y}`} style={{ left: point.x, top: point.y, width: Math.sqrt(dx * dx + dy * dy), transform: `rotate(${Math.atan2(dy, dx) * (180 / Math.PI)}deg)` }} />;
            })}
            {labelIndices.map((index) => {
              const point = chartPoints[index];
              const isHighest = dashboard.hourly[index].temp === highestTemperature;
              return <b className={`absolute z-[3] rounded-sm bg-white px-1 py-0.5 text-[11px] font-semibold ${index === 0 ? 'text-black' : 'text-[#555]'}`} key={index} style={{ left: point.x, top: Math.max(isHighest ? -6 : 0, point.y - (isHighest ? 30 : 24)), transform: index === 0 ? undefined : 'translateX(-50%)' }}>{dashboard.hourly[index].temp}°</b>;
            })}
          </div>
          <div className="relative h-6 w-[746px] text-xs font-medium text-[#555]">
            {labelIndices.map((index) => (
              <span className="absolute top-1.5 whitespace-nowrap" key={index} style={{ left: chartPoints[index].x, transform: index === 0 ? undefined : 'translateX(-50%)' }}>
                {dashboard.hourly[index].time}
              </span>
            ))}
          </div>
        </section>

        <section className="mt-2 grid h-[142px] grid-cols-8 gap-1" aria-label="Eight day forecast">
          {dashboard.forecast.map((item, index) => (
            <article className={`flex h-[142px] flex-col items-center rounded-xl border px-1 pt-2 ${item.selected ? 'forecast-selected border-black bg-[#555] text-white' : 'border-[#aaa] bg-white text-black'}`} key={`${item.day}-${index}`} aria-label={`${item.day}, high ${item.high} degrees, low ${item.low} degrees`}>
              <h2 className="text-base leading-none font-semibold tracking-tight">{item.day}</h2>
              <p className={`mt-1 text-[10px] font-medium tracking-wide uppercase ${item.selected ? 'text-[#aaa]' : 'text-[#555]'}`}>{item.selected ? 'Today' : 'Forecast'}</p>
              <WeatherIcon inverted={item.selected} kind={item.kind} />
              <p className={`mt-auto mb-2 flex gap-1.5 text-sm ${item.selected ? 'text-[#aaa]' : 'text-[#555]'}`}><strong className={`font-semibold ${item.selected ? 'text-white' : 'text-black'}`}>{item.high}°</strong><span>{item.low}°</span></p>
            </article>
          ))}
        </section>
      </section>
    </main>
  );
}

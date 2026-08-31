import type { Metadata } from 'next';
import { CloudIcon } from '@phosphor-icons/react/dist/ssr/Cloud';
import { CloudLightningIcon } from '@phosphor-icons/react/dist/ssr/CloudLightning';
import { CloudRainIcon } from '@phosphor-icons/react/dist/ssr/CloudRain';
import { CloudSnowIcon } from '@phosphor-icons/react/dist/ssr/CloudSnow';
import { CloudMoonIcon } from '@phosphor-icons/react/dist/ssr/CloudMoon';
import { CloudSunIcon } from '@phosphor-icons/react/dist/ssr/CloudSun';
import { MoonStarsIcon } from '@phosphor-icons/react/dist/ssr/MoonStars';
import { SunIcon } from '@phosphor-icons/react/dist/ssr/Sun';
import { createRenderManifest, serializeRenderManifest } from '@/lib/render-monitor';
import { loadPortraitDashboard } from '@/lib/weather-dashboard';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Beijing Weather · Portrait',
  description: 'A live 480 by 800 pixel four-level grayscale weather dashboard for portrait e-paper displays.',
  openGraph: { title: 'Beijing Weather · Portrait', description: 'Live portrait weather dashboard for e-paper.', images: [] },
  twitter: { card: 'summary', title: 'Beijing Weather · Portrait', description: 'Live portrait weather dashboard for e-paper.', images: [] },
};

const weatherIcons = { rain: CloudRainIcon, storm: CloudLightningIcon, snow: CloudSnowIcon, partly: CloudSunIcon, cloudy: CloudIcon, sunny: SunIcon, 'night-clear': MoonStarsIcon, 'partly-small': CloudMoonIcon };

function seriesPoints(values: number[], top: number, bottom: number) {
  const min = Math.min(...values), max = Math.max(...values), span = Math.max(1, max - min);
  return values.map((value, index) => ({ x: ((index + 0.5) * 440) / values.length, y: bottom - ((value - min) / span) * (bottom - top) }));
}
function TemperatureLine({ points, color }: { points: Array<{ x: number; y: number }>; color: string }) {
  return <>{points.slice(0, -1).map((point, index) => { const next = points[index + 1], dx = next.x - point.x, dy = next.y - point.y; return <i className="absolute h-[2px] origin-left" key={`${color}-${point.x}`} style={{ background: color, left: point.x, top: point.y, transform: `rotate(${Math.atan2(dy, dx) * (180 / Math.PI)}deg)`, width: Math.sqrt(dx * dx + dy * dy) }} />; })}{points.map((point) => <i className="absolute h-1 w-1 rounded-full" key={`${color}-dot-${point.x}`} style={{ background: color, left: point.x - 1, top: point.y - 1 }} />)}</>;
}

export default async function PortraitWeather() {
  const loaded = await loadPortraitDashboard();
  const dashboard = loaded.data;
  const manifest = createRenderManifest('portrait', loaded.source, dashboard);
  const DayIcon = weatherIcons[dashboard.day.kind], NightIcon = weatherIcons[dashboard.night.kind];
  const highPoints = seriesPoints(dashboard.forecast.map((item) => item.high), 48, 86);
  const lowPoints = seriesPoints(dashboard.forecast.map((item) => item.low), 130, 168);
  return (
    <main className="portrait-stage grid min-h-screen min-w-[480px] place-items-center bg-white font-sans text-black">
      <script id="render-monitor-manifest" type="application/json" dangerouslySetInnerHTML={{ __html: serializeRenderManifest(manifest) }} />
      <section className="epaper-portrait flex h-[800px] w-[480px] flex-col gap-1.5 overflow-hidden rounded-none border-2 border-black bg-white p-2" aria-label={`Portrait ${dashboard.city} weather dashboard`}>
        <section className="h-[184px] shrink-0 overflow-hidden rounded-2xl border border-[#555] bg-white p-2" aria-label="Current weather">
          <header className="flex h-5 items-center justify-between text-xs font-semibold"><h1 className="tracking-wide">CURRENT</h1><p className="text-[10px] text-[#555]">{dashboard.city} · {dashboard.dateLabel}</p></header>
          <div className="grid h-[82px] grid-cols-[120px_minmax(0,1fr)_150px] items-center gap-2">
            <div className="flex items-start"><strong className="text-[70px] leading-[.86] tracking-[-4px]">{dashboard.day.temp}</strong><span className="ml-1 text-[28px] leading-none">°</span></div>
            <div className="flex flex-col items-center justify-self-center"><DayIcon color="#555" size={43} weight="light" /><span className="portrait-day-condition mt-0.5">{dashboard.day.condition}</span></div>
            <dl className="portrait-wind-details w-[126px] justify-self-end space-y-2"><div className="whitespace-nowrap"><dt className="sr-only">Wind</dt><dd><b>Wind</b> {dashboard.day.wind} {dashboard.windUnit}</dd></div><div className="whitespace-nowrap"><dt className="sr-only">Wind gust level</dt><dd><b>Gust</b> · Level {dashboard.day.gustLevel}</dd></div></dl>
          </div>
          <dl className="grid h-[64px] grid-cols-4 divide-x divide-[#aaa] border-t border-[#aaa] pt-1.5">
            <div className="portrait-detail-item"><dt className="portrait-detail-label">AQI</dt><dd className="portrait-detail-value">{dashboard.day.aqi}</dd></div>
            <div className="portrait-detail-item"><dt className="portrait-detail-label">Visibility</dt><dd className="portrait-detail-value">{dashboard.day.visibility} {dashboard.distanceUnit}</dd></div>
            <div className="portrait-detail-item"><dt className="portrait-detail-label">UV index</dt><dd className="portrait-detail-value">{dashboard.day.uv}</dd></div>
            <div className="portrait-detail-item"><dt className="portrait-detail-label">Cloud</dt><dd className="portrait-detail-value">{dashboard.day.cloud}%</dd></div>
          </dl>
        </section>
        <section className="h-[96px] shrink-0 rounded-2xl border border-[#555] bg-white p-2" aria-label="Night weather">
          <header className="flex h-5 items-center justify-between text-xs font-semibold"><h2 className="tracking-wide">NIGHT</h2><p className="text-[#555]">18:00 — 06:00</p></header>
          <div className="grid h-[58px] grid-cols-[120px_minmax(0,1fr)_150px] items-center gap-2"><div className="flex items-start"><strong className="text-[56px] leading-none tracking-[-3px]">{dashboard.night.temp}</strong><span className="text-2xl leading-none">°</span></div><div className="flex w-full items-center justify-center gap-3"><NightIcon className="shrink-0" color="#555" size={35} weight="light" /><span className="portrait-night-condition">{dashboard.night.condition}</span></div><dl className="portrait-wind-details w-[126px] justify-self-end space-y-1.5"><div className="whitespace-nowrap"><dt className="sr-only">Wind</dt><dd><b>Wind</b> {dashboard.night.wind} {dashboard.windUnit}</dd></div><div className="whitespace-nowrap"><dt className="sr-only">Wind gust level</dt><dd><b>Gust</b> · Level {dashboard.night.gustLevel}</dd></div></dl></div>
        </section>
        <section className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-[#555] bg-white p-2" aria-label="Seven day weather forecast">
          <header className="flex h-5 items-center"><h2 className="text-sm font-semibold">7-DAY FORECAST</h2></header>
          <div className="mt-1 grid h-[140px] grid-cols-7">{dashboard.forecast.map((item) => { const Icon = weatherIcons[item.kind]; return <article className="flex min-w-0 flex-col items-center justify-between pb-1 text-center" key={item.date}><p className="portrait-forecast-date translate-y-1 text-[#555]">{item.date}</p><h3 className="portrait-forecast-day translate-y-1.5">{item.day}</h3><Icon className="translate-y-1.5" color="#555" size={32} weight="light" aria-hidden="true" /><p className="portrait-forecast-condition w-full translate-y-1 px-0.5"><span>{item.condition}</span></p></article>; })}</div>
          <div className="relative h-[238px]"><TemperatureLine color="#aaa" points={highPoints} /><TemperatureLine color="#aaa" points={lowPoints} />{dashboard.forecast.map((item, index) => <div className="absolute top-0 flex h-[218px] w-[52px] -translate-x-1/2 flex-col justify-between text-center text-[10px] font-semibold" key={`temperature-${item.date}`} style={{ left: highPoints[index].x }}><span className="relative top-3 text-[16px] leading-none">{item.high}°</span><span className="relative top-3 text-[16px] leading-none text-[#555]">{item.low}°</span></div>)}</div>
          <div className="grid h-[55px] grid-cols-7">{dashboard.forecast.map((item) => <div className="portrait-forecast-wind flex items-center justify-center" key={`wind-${item.date}`}><span>{item.wind} {item.level}</span></div>)}</div>
        </section>
      </section>
    </main>
  );
}

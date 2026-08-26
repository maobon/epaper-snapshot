import type { Metadata } from 'next';
import { BasketballIcon } from '@phosphor-icons/react/dist/ssr/Basketball';
import { CarIcon } from '@phosphor-icons/react/dist/ssr/Car';
import { CloudIcon } from '@phosphor-icons/react/dist/ssr/Cloud';
import { CloudLightningIcon } from '@phosphor-icons/react/dist/ssr/CloudLightning';
import { CloudRainIcon } from '@phosphor-icons/react/dist/ssr/CloudRain';
import { CloudSnowIcon } from '@phosphor-icons/react/dist/ssr/CloudSnow';
import { CloudSunIcon } from '@phosphor-icons/react/dist/ssr/CloudSun';
import { EyeIcon } from '@phosphor-icons/react/dist/ssr/Eye';
import { PillIcon } from '@phosphor-icons/react/dist/ssr/Pill';
import { SunIcon } from '@phosphor-icons/react/dist/ssr/Sun';
import { ThermometerSimpleIcon } from '@phosphor-icons/react/dist/ssr/ThermometerSimple';
import { TShirtIcon } from '@phosphor-icons/react/dist/ssr/TShirt';
import { WindIcon } from '@phosphor-icons/react/dist/ssr/Wind';
import { fetchDailyWeather } from '@/lib/weather-api';
import { getWeatherPresentation, type WeatherKind } from '@/lib/weather-presentation';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Chaoyang District Weather · Portrait',
  description: 'A live 480 by 800 pixel four-level grayscale weather dashboard for portrait e-paper displays.',
  openGraph: { title: 'Chaoyang District Weather · Portrait', description: 'Live portrait weather dashboard for e-paper.', images: [] },
  twitter: { card: 'summary', title: 'Chaoyang District Weather · Portrait', description: 'Live portrait weather dashboard for e-paper.', images: [] },
};

type Condition = { cloudCover?: number; winddir?: string; windGustPow?: number; windlevel?: number; windspeed?: number; weaName?: string; weaIcon?: string };
type SourceDay = { publicDate: string; maxtemp?: number; mintemp?: number; realFeelTempMax?: number; visibility?: number; uvIndex?: number; dayWeaName?: string; nightWeaName?: string; conditionDay?: Condition; conditionNight?: Condition };
type SourceData = {
  cityInfo?: { localizedName?: string; englishName?: string; name?: string };
  currentTime?: string;
  disUnit?: string;
  windSpeedUnit?: string;
  forecastList?: { dailyWeathers?: SourceDay[] };
  aqiHourly?: Array<{ time?: string; aqi?: number; lv?: number }>;
  lifeIndex?: Array<{ code?: string; levelList?: Array<{ day?: string; level?: string }> }>;
};
type ForecastDay = { date: string; day: string; condition: string; high: number; low: number; wind: string; level: number; kind: WeatherKind };
type Dashboard = {
  city: string;
  dateLabel: string;
  day: { temp: number; kind: WeatherKind; condition: string; wind: number; gustLevel: number; feels: number; visibility: number; uv: string; cloud: number };
  night: { temp: number; kind: WeatherKind; condition: string; wind: number; gustLevel: number };
  distanceUnit: string;
  windUnit: string;
  hourly: Array<{ time: string; value: number; level: number }>;
  life: { dressing: string; carWash: string; sports: string; colds: string };
  forecast: ForecastDay[];
};

const fallbackForecast: ForecastDay[] = [
  { date: '08/24', day: 'Yesterday', condition: 'Cloudy', high: 32, low: 25, wind: 'SE', level: 2, kind: 'cloudy' },
  { date: '08/25', day: 'Today', condition: 'Mod. rain', high: 30, low: 21, wind: 'NE', level: 2, kind: 'rain' },
  { date: '08/26', day: 'Wed', condition: 'Cloudy', high: 27, low: 21, wind: 'NW', level: 2, kind: 'cloudy' },
  { date: '08/27', day: 'Thu', condition: 'Cloudy', high: 29, low: 21, wind: 'N', level: 1, kind: 'cloudy' },
  { date: '08/28', day: 'Fri', condition: 'Light rain', high: 24, low: 19, wind: 'NW', level: 1, kind: 'rain' },
  { date: '08/29', day: 'Sat', condition: 'Sunny', high: 29, low: 19, wind: 'SW', level: 2, kind: 'sunny' },
  { date: '08/30', day: 'Sun', condition: 'Sunny', high: 31, low: 19, wind: 'NW', level: 2, kind: 'sunny' },
];
const fallback: Dashboard = {
  city: 'Chaoyang District', dateLabel: '08/25 TUE', distanceUnit: 'km', windUnit: 'km/h',
  day: { temp: 30, kind: 'rain', condition: 'Moderate rain', wind: 10, gustLevel: 3, feels: 34, visibility: 6, uv: 'Moderate', cloud: 95 },
  night: { temp: 21, kind: 'storm', condition: 'Thunderstorms', wind: 10, gustLevel: 3 },
  hourly: [33, 30, 31, 37, 34, 36, 40, 35, 42, 60, 59, 55, 68].map((value, index) => ({ time: String(index).padStart(2, '0'), value, level: value <= 50 ? 1 : 2 })),
  life: { dressing: 'Short sleeve', carWash: 'Not suitable', sports: 'Not suitable', colds: 'Easier' },
  forecast: fallbackForecast,
};
const forecastIcons = { rain: CloudRainIcon, storm: CloudLightningIcon, snow: CloudSnowIcon, partly: CloudSunIcon, cloudy: CloudIcon, sunny: SunIcon };

function uvLabel(value = 0) { return value <= 2 ? 'Low' : value <= 5 ? 'Moderate' : value <= 7 ? 'High' : value <= 10 ? 'Very high' : 'Extreme'; }
function aqiLabel(value: number) { return value <= 50 ? 'EXCELLENT' : value <= 100 ? 'GOOD' : value <= 150 ? 'LIGHT' : 'POLLUTED'; }
function translateLife(code: string, value?: string) {
  const known: Record<string, Record<string, string>> = {
    '2': { '短袖': 'Short sleeve', '长袖': 'Long sleeve', '薄外套': 'Light jacket' },
    '4': { '不宜': 'Not suitable', '较不宜': 'Less suitable', '适宜': 'Suitable', '较适宜': 'Suitable' },
    '5': { '不宜': 'Not suitable', '较不宜': 'Not suitable', '适宜': 'Suitable', '较适宜': 'Suitable' },
    '3': { '极易': 'Very easy', '较易': 'Easier', '易发': 'Likely', '少发': 'Unlikely', '不易': 'Unlikely' },
  };
  return (value && known[code]?.[value]) || value || ({ '2': 'Short sleeve', '4': 'Not suitable', '5': 'Not suitable', '3': 'Easier' }[code] ?? '—');
}
function formatDate(date: string, relative?: 'today' | 'yesterday') {
  const parsed = new Date(`${date}T12:00:00+08:00`);
  const mmdd = `${String(parsed.getMonth() + 1).padStart(2, '0')}/${String(parsed.getDate()).padStart(2, '0')}`;
  const weekday = parsed.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'Asia/Shanghai' });
  return { mmdd, weekday, day: relative === 'today' ? 'Today' : relative === 'yesterday' ? 'Yesterday' : weekday };
}

async function getDashboard(): Promise<Dashboard> {
  try {
    const data = await fetchDailyWeather<SourceData>();
    if (!data?.currentTime) throw new Error('Weather source omitted the current date');
    const days = data.forecastList?.dailyWeathers ?? [];
    const currentIndex = days.findIndex((item) => item.publicDate === data.currentTime);
    const current = currentIndex >= 0 ? days[currentIndex] : undefined;
    if (!current) throw new Error('Weather source omitted the current forecast');
    const dayWeather = getWeatherPresentation(current.dayWeaName, current.conditionDay?.weaIcon);
    const nightWeather = getWeatherPresentation(current.nightWeaName, current.conditionNight?.weaIcon);
    const currentDate = formatDate(data.currentTime, 'today');
    const sevenDays = days.slice(Math.max(0, currentIndex - 1), Math.max(0, currentIndex - 1) + 7).map((item, index) => {
      const presentation = getWeatherPresentation(item.dayWeaName, item.conditionDay?.weaIcon);
      const formatted = formatDate(item.publicDate, index === 0 ? 'yesterday' : index === 1 ? 'today' : undefined);
      return { date: formatted.mmdd, day: formatted.day, condition: presentation.label === 'Moderate rain' ? 'Mod. rain' : presentation.label, high: item.maxtemp ?? 0, low: item.mintemp ?? 0, wind: item.conditionDay?.winddir ?? '—', level: item.conditionDay?.windlevel ?? 0, kind: presentation.kind } satisfies ForecastDay;
    });
    const lifeValue = (code: string) => data.lifeIndex?.find((item) => item.code === code)?.levelList?.find((item) => item.day === data.currentTime)?.level;
    return {
      city: data.cityInfo?.localizedName ?? data.cityInfo?.englishName ?? data.cityInfo?.name ?? fallback.city,
      dateLabel: `${currentDate.mmdd} ${currentDate.weekday.toUpperCase()}`,
      day: { temp: current.maxtemp ?? fallback.day.temp, kind: dayWeather.kind, condition: dayWeather.label, wind: current.conditionDay?.windspeed ?? fallback.day.wind, gustLevel: current.conditionDay?.windGustPow ?? fallback.day.gustLevel, feels: current.realFeelTempMax ?? fallback.day.feels, visibility: current.visibility ?? fallback.day.visibility, uv: uvLabel(current.uvIndex), cloud: current.conditionDay?.cloudCover ?? fallback.day.cloud },
      night: { temp: current.mintemp ?? fallback.night.temp, kind: nightWeather.kind, condition: nightWeather.label, wind: current.conditionNight?.windspeed ?? fallback.night.wind, gustLevel: current.conditionNight?.windGustPow ?? fallback.night.gustLevel },
      distanceUnit: data.disUnit ?? fallback.distanceUnit,
      windUnit: data.windSpeedUnit ?? fallback.windUnit,
      hourly: (data.aqiHourly ?? []).slice(0, 13).map((item, index) => ({ time: item.time?.slice(-5, -3) ?? String(index).padStart(2, '0'), value: item.aqi ?? 0, level: item.lv ?? 1 })),
      life: { dressing: translateLife('2', lifeValue('2')), carWash: translateLife('4', lifeValue('4')), sports: translateLife('5', lifeValue('5')), colds: translateLife('3', lifeValue('3')) },
      forecast: sevenDays.length === 7 ? sevenDays : fallback.forecast,
    };
  } catch (error) {
    console.error('Unable to load portrait weather data:', error);
    return fallback;
  }
}
function seriesPoints(values: number[], top: number, bottom: number) {
  const min = Math.min(...values), max = Math.max(...values), span = Math.max(1, max - min);
  return values.map((value, index) => ({ x: ((index + 0.5) * 440) / values.length, y: bottom - ((value - min) / span) * (bottom - top) }));
}
function TemperatureLine({ points, color }: { points: Array<{ x: number; y: number }>; color: string }) {
  return <>{points.slice(0, -1).map((point, index) => { const next = points[index + 1], dx = next.x - point.x, dy = next.y - point.y; return <i className="absolute h-[2px] origin-left" key={`${color}-${point.x}`} style={{ background: color, left: point.x, top: point.y, transform: `rotate(${Math.atan2(dy, dx) * (180 / Math.PI)}deg)`, width: Math.sqrt(dx * dx + dy * dy) }} />; })}{points.map((point) => <i className="absolute h-1 w-1 rounded-full" key={`${color}-dot-${point.x}`} style={{ background: color, left: point.x - 1, top: point.y - 1 }} />)}</>;
}

export default async function PortraitWeather() {
  const dashboard = await getDashboard();
  const DayIcon = forecastIcons[dashboard.day.kind], NightIcon = forecastIcons[dashboard.night.kind];
  const highPoints = seriesPoints(dashboard.forecast.map((item) => item.high), 14, 30);
  const lowPoints = seriesPoints(dashboard.forecast.map((item) => item.low), 50, 68);
  const hourly = dashboard.hourly.length === 13 ? dashboard.hourly : fallback.hourly;
  return (
    <main className="portrait-stage grid min-h-screen min-w-[480px] place-items-center bg-white font-sans text-black">
      <section className="epaper-portrait flex h-[800px] w-[480px] flex-col gap-1.5 overflow-hidden rounded-none border-2 border-black bg-white p-2" aria-label={`Portrait ${dashboard.city} weather dashboard`}>
        <section className="h-[184px] shrink-0 overflow-hidden rounded-2xl border border-[#555] bg-white p-2" aria-label="Day weather">
          <header className="flex h-5 items-center justify-between text-xs font-semibold"><h1 className="tracking-wide">DAY</h1><p className="text-[10px] text-[#555]">{dashboard.city.toUpperCase()} · {dashboard.dateLabel}</p></header>
          <div className="grid h-[82px] grid-cols-[120px_minmax(0,1fr)_150px] items-center gap-2">
            <div className="flex items-start"><strong className="text-[70px] leading-[.86] tracking-[-4px]">{dashboard.day.temp}</strong><span className="ml-1 text-[28px] leading-none">°</span></div>
            <div className="flex flex-col items-center justify-self-center"><DayIcon color="#555" size={43} weight="light" /><span className="mt-0.5 text-center text-[11px] leading-none font-semibold uppercase">{dashboard.day.condition}</span></div>
            <dl className="w-[126px] justify-self-end space-y-2 text-xs"><div className="flex items-center gap-1.5"><WindIcon size={16} weight="light" /><dt className="sr-only">Wind</dt><dd><b>Wind</b> {dashboard.day.wind} {dashboard.windUnit}</dd></div><div className="flex items-center gap-1.5"><WindIcon className="rotate-180" size={16} weight="light" /><dt className="sr-only">Wind gust level</dt><dd><b>Gust</b> · Level {dashboard.day.gustLevel}</dd></div></dl>
          </div>
          <dl className="grid h-[64px] grid-cols-4 divide-x divide-[#aaa] border-t border-[#aaa] pt-1.5">
            <div className="flex items-center gap-1.5 px-1"><ThermometerSimpleIcon color="#555" size={20} weight="light" /><div><dt className="text-[9px] font-semibold text-[#555] uppercase">Feels like</dt><dd className="text-sm font-semibold">{dashboard.day.feels}°</dd></div></div>
            <div className="flex items-center gap-1.5 px-2"><EyeIcon color="#555" size={20} weight="light" /><div><dt className="text-[9px] font-semibold text-[#555] uppercase">Visibility</dt><dd className="text-sm font-semibold">{dashboard.day.visibility} {dashboard.distanceUnit}</dd></div></div>
            <div className="flex items-center gap-1.5 px-2"><span className="grid h-5 w-5 place-items-center rounded-full border border-[#555] text-[9px] font-semibold text-[#555]">UV</span><div><dt className="text-[9px] font-semibold text-[#555] uppercase">UV index</dt><dd className="text-sm font-semibold">{dashboard.day.uv}</dd></div></div>
            <div className="flex items-center gap-1.5 px-2"><CloudIcon color="#555" size={20} weight="light" /><div><dt className="text-[9px] font-semibold text-[#555] uppercase">Cloud</dt><dd className="text-sm font-semibold">{dashboard.day.cloud}%</dd></div></div>
          </dl>
        </section>
        <section className="h-[96px] shrink-0 rounded-2xl border border-[#555] bg-white p-2" aria-label="Night weather">
          <header className="flex h-5 items-center justify-between text-xs font-semibold"><h2 className="tracking-wide">NIGHT</h2><p className="text-[#555]">18:00 — 06:00</p></header>
          <div className="grid h-[58px] grid-cols-[120px_minmax(0,1fr)_150px] items-center gap-2"><div className="flex items-start"><strong className="text-[56px] leading-none tracking-[-3px]">{dashboard.night.temp}</strong><span className="text-2xl leading-none">°</span></div><div className="flex items-center justify-self-center gap-2"><NightIcon color="#555" size={35} weight="light" /><span className="max-w-[88px] text-[10px] leading-tight font-semibold uppercase">{dashboard.night.condition}</span></div><dl className="w-[126px] justify-self-end space-y-1.5 text-xs"><div className="flex items-center gap-1.5"><WindIcon size={16} weight="light" /><dt className="sr-only">Wind</dt><dd><b>Wind</b> {dashboard.night.wind} {dashboard.windUnit}</dd></div><div className="flex items-center gap-1.5"><WindIcon className="rotate-180" size={16} weight="light" /><dt className="sr-only">Wind gust level</dt><dd><b>Gust</b> · Level {dashboard.night.gustLevel}</dd></div></dl></div>
        </section>
        <section className="h-[124px] shrink-0 rounded-2xl border border-[#555] bg-white p-2" aria-label="Hourly air quality forecast">
          <header className="flex h-5 items-center justify-between"><h2 className="text-sm font-semibold">HOURLY AQI FORECAST</h2><span className="text-xs text-[#555]">LIVE</span></header>
          <div className="relative mt-1 grid h-[76px] grid-cols-13 items-end border-b border-[#aaa] px-1">{hourly.map((item, index) => <div className="flex h-full flex-col items-center justify-end" key={`${item.time}-${index}`}>{index === 0 && <span className="absolute top-0 rounded bg-[#555] px-1 py-0.5 text-[9px] text-white">{item.value} · {aqiLabel(item.value)}</span>}<i className={`${item.level <= 1 ? 'bg-[#555]' : 'bg-black'} w-2 rounded-t-full`} style={{ height: `${Math.max(15, item.value * 0.48)}px` }} /><span className="mt-1 text-[9px] text-[#555]">{item.time}</span></div>)}</div>
        </section>
        <section className="h-[118px] shrink-0 rounded-2xl border border-[#555] bg-white p-2" aria-label="Life index">
          <header className="flex h-5 items-center justify-between"><h2 className="text-sm font-semibold">LIFE INDEX</h2><span className="text-xs text-[#555]">TODAY</span></header>
          <div className="mt-1 grid h-[76px] grid-cols-2 divide-x divide-[#aaa]"><div className="grid grid-rows-2 divide-y divide-[#aaa] pr-2"><div className="flex items-center gap-3"><TShirtIcon color="#555" size={23} weight="light" /><p className="text-xs"><b>Dressing</b><br /><span className="text-[#555]">{dashboard.life.dressing}</span></p></div><div className="flex items-center gap-3"><CarIcon color="#555" size={23} weight="light" /><p className="text-xs"><b>Car wash</b><br /><span className="text-[#555]">{dashboard.life.carWash}</span></p></div></div><div className="grid grid-rows-2 divide-y divide-[#aaa] pl-3"><div className="flex items-center gap-3"><BasketballIcon color="#555" size={23} weight="light" /><p className="text-xs"><b>Sports</b><br /><span className="text-[#555]">{dashboard.life.sports}</span></p></div><div className="flex items-center gap-3"><PillIcon color="#555" size={23} weight="light" /><p className="text-xs"><b>Colds</b><br /><span className="text-[#555]">{dashboard.life.colds}</span></p></div></div></div>
        </section>
        <section className="h-[234px] shrink-0 overflow-hidden rounded-2xl border border-[#555] bg-white p-2" aria-label="Seven day weather forecast">
          <header className="flex h-5 items-center justify-between"><h2 className="text-sm font-semibold">7-DAY FORECAST</h2><span className="text-xs text-[#555]">LIVE</span></header>
          <div className="mt-1 grid h-[82px] grid-cols-7">{dashboard.forecast.map((item) => { const Icon = forecastIcons[item.kind]; return <article className="flex min-w-0 flex-col items-center text-center" key={item.date}><p className="text-[9px] text-[#555]">{item.date}</p><h3 className="text-[10px] font-semibold">{item.day}</h3><Icon color="#555" size={26} weight="light" aria-hidden="true" /><p className="w-full truncate px-0.5 text-[9px]">{item.condition}</p></article>; })}</div>
          <div className="relative h-[72px]"><TemperatureLine color="#000" points={highPoints} /><TemperatureLine color="#aaa" points={lowPoints} />{dashboard.forecast.map((item, index) => <div className="absolute top-0 flex h-[72px] w-[52px] -translate-x-1/2 flex-col justify-between text-center text-[10px] font-semibold" key={`temperature-${item.date}`} style={{ left: highPoints[index].x }}><span>{item.high}°</span><span className="text-[#555]">{item.low}°</span></div>)}</div>
          <div className="grid h-[45px] grid-cols-7">{dashboard.forecast.map((item) => <div className="flex flex-col items-center text-[9px]" key={`wind-${item.date}`}><span>{item.wind}</span><span>{item.level} Level</span></div>)}</div>
        </section>
      </section>
    </main>
  );
}

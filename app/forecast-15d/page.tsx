import type { Metadata } from 'next';
import { CaretRightIcon } from '@phosphor-icons/react/dist/ssr/CaretRight';
import { CloudIcon } from '@phosphor-icons/react/dist/ssr/Cloud';
import { CloudLightningIcon } from '@phosphor-icons/react/dist/ssr/CloudLightning';
import { CloudRainIcon } from '@phosphor-icons/react/dist/ssr/CloudRain';
import { CloudSnowIcon } from '@phosphor-icons/react/dist/ssr/CloudSnow';
import { CloudSunIcon } from '@phosphor-icons/react/dist/ssr/CloudSun';
import { DropIcon } from '@phosphor-icons/react/dist/ssr/Drop';
import { SunIcon } from '@phosphor-icons/react/dist/ssr/Sun';
import { fetchDaysWeather } from '@/lib/weather-api';
import { getWeatherPresentation, type WeatherKind } from '@/lib/weather-presentation';

export const metadata: Metadata = {
  title: 'Chaoyang District · 15-Day Forecast',
  description: 'A live 480 by 800 pixel, four-level grayscale 15-day weather forecast for portrait e-paper displays.',
  openGraph: {
    title: 'Chaoyang District · 15-Day Forecast',
    description: 'Live 15-day weather data in a 480 × 800 four-level grayscale e-paper layout.',
    images: [],
  },
  twitter: {
    card: 'summary',
    title: 'Chaoyang District · 15-Day Forecast',
    description: 'Live 15-day weather data in a 480 × 800 four-level grayscale e-paper layout.',
    images: [],
  },
};

export const dynamic = 'force-dynamic';

type ForecastItem = {
  day: string;
  date: string;
  condition: string;
  kind: WeatherKind;
  high: number;
  low: number;
  rain: number;
  windDirection: string;
  windSpeed: number;
};

type SourceWeather = {
  publicDate: string;
  showDay?: string;
  maxtemp: number;
  mintemp: number;
  dayWeaIcon?: string;
  dayWeaName?: string;
  conditionDay?: {
    precProb?: number;
    rainProb?: number;
    winddir?: string;
    windspeed?: number;
  };
};

type SourceData = {
  currentTime?: string;
  windSpeedUnit?: string;
  cityInfo?: { localizedName?: string; englishName?: string };
  days?: { dailyWeathers?: SourceWeather[] };
};

const fallbackForecast: ForecastItem[] = [
  { day: 'Wed', date: '08/26', condition: 'Cloudy', kind: 'cloudy', high: 27, low: 21, rain: 0, windDirection: 'NW', windSpeed: 6 },
  { day: 'Thu', date: '08/27', condition: 'Partly cloudy', kind: 'partly', high: 29, low: 21, rain: 10, windDirection: 'N', windSpeed: 2 },
  { day: 'Fri', date: '08/28', condition: 'Moderate rain', kind: 'rain', high: 24, low: 19, rain: 60, windDirection: 'NW', windSpeed: 3 },
  { day: 'Sat', date: '08/29', condition: 'Sunny', kind: 'sunny', high: 29, low: 19, rain: 0, windDirection: 'SW', windSpeed: 11 },
  { day: 'Sun', date: '08/30', condition: 'Sunny', kind: 'sunny', high: 31, low: 19, rain: 0, windDirection: 'NW', windSpeed: 10 },
  { day: 'Mon', date: '08/31', condition: 'Sunny', kind: 'sunny', high: 29, low: 20, rain: 0, windDirection: 'NE', windSpeed: 10 },
  { day: 'Tue', date: '09/01', condition: 'Sunny', kind: 'sunny', high: 29, low: 19, rain: 0, windDirection: 'SE', windSpeed: 7 },
  { day: 'Wed', date: '09/02', condition: 'Sunny', kind: 'sunny', high: 29, low: 19, rain: 0, windDirection: 'SE', windSpeed: 8 },
  { day: 'Thu', date: '09/03', condition: 'Mostly sunny', kind: 'partly', high: 28, low: 20, rain: 0, windDirection: 'S', windSpeed: 10 },
  { day: 'Fri', date: '09/04', condition: 'Partly cloudy', kind: 'partly', high: 30, low: 21, rain: 10, windDirection: 'SE', windSpeed: 9 },
  { day: 'Sat', date: '09/05', condition: 'Cloudy', kind: 'cloudy', high: 26, low: 18, rain: 20, windDirection: 'SE', windSpeed: 11 },
  { day: 'Sun', date: '09/06', condition: 'Sunny', kind: 'sunny', high: 30, low: 20, rain: 0, windDirection: 'SE', windSpeed: 10 },
  { day: 'Mon', date: '09/07', condition: 'Cloudy', kind: 'cloudy', high: 29, low: 20, rain: 10, windDirection: 'SW', windSpeed: 6 },
  { day: 'Tue', date: '09/08', condition: 'Light rain', kind: 'rain', high: 25, low: 18, rain: 50, windDirection: 'SE', windSpeed: 8 },
  { day: 'Wed', date: '09/09', condition: 'Cloudy', kind: 'cloudy', high: 26, low: 17, rain: 20, windDirection: 'SE', windSpeed: 8 },
];

const weatherIcons = {
  cloudy: CloudIcon,
  rain: CloudRainIcon,
  partly: CloudSunIcon,
  snow: CloudSnowIcon,
  storm: CloudLightningIcon,
  sunny: SunIcon,
};

function dayName(date: string) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short' }).format(new Date(`${date}T00:00:00Z`));
}

function dateRange(items: ForecastItem[]) {
  const monthNames = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const label = (value: string) => {
    const [month, day] = value.split('/').map(Number);
    return `${monthNames[month - 1]} ${String(day).padStart(2, '0')}`;
  };

  return items.length ? `${label(items[0].date)} — ${label(items[items.length - 1].date)}` : '15 DAYS';
}

async function getForecast() {
  const fallback = {
    city: 'Chaoyang District',
    forecast: fallbackForecast,
    range: dateRange(fallbackForecast),
    windSpeedUnit: 'km/h',
  };

  try {
    const source = await fetchDaysWeather<SourceData>();
    const daily = source?.days?.dailyWeathers ?? [];
    const currentDate = source?.currentTime ?? '';
    const futureDays = daily.filter((item) => item.publicDate > currentDate).slice(0, 15);

    if (futureDays.length < 15) return fallback;

    const forecast = futureDays.map((item): ForecastItem => {
      const presentation = getWeatherPresentation(item.dayWeaName, item.dayWeaIcon);
      const condition = item.conditionDay ?? {};

      return {
        day: dayName(item.publicDate),
        date: item.showDay || item.publicDate.slice(5).replace('-', '/'),
        condition: presentation.label,
        kind: presentation.kind,
        high: Math.round(Number(item.maxtemp)),
        low: Math.round(Number(item.mintemp)),
        rain: Math.round(Number(condition.precProb ?? condition.rainProb ?? 0)),
        windDirection: condition.winddir || '—',
        windSpeed: Math.round(Number(condition.windspeed ?? 0)),
      };
    });

    return {
      city: source?.cityInfo?.localizedName || source?.cityInfo?.englishName || fallback.city,
      forecast,
      range: dateRange(forecast),
      windSpeedUnit: source?.windSpeedUnit || fallback.windSpeedUnit,
    };
  } catch {
    return fallback;
  }
}

export default async function FifteenDayForecast() {
  const { city, forecast, range, windSpeedUnit } = await getForecast();

  return (
    <main className="portrait-stage grid min-h-screen min-w-[480px] place-items-center bg-white font-sans text-black">
      <section className="epaper-forecast15 flex h-[800px] w-[480px] flex-col gap-[3px] overflow-hidden rounded-none border-2 border-black bg-white p-2" aria-label={`${city} 15-day weather forecast`}>
        <header className="forecast15-header shrink-0 overflow-hidden rounded-xl border border-[#555] bg-white px-2 py-1.5">
          <div className="flex h-[26px] items-center justify-between">
            <div>
              <h1 className="text-base leading-none font-semibold tracking-tight">15-DAY FORECAST</h1>
              <p className="mt-1 text-[9px] font-semibold tracking-wide text-[#555] uppercase">{city} · {range}</p>
            </div>
            <span className="rounded-full bg-black px-2.5 py-1 text-[9px] font-semibold text-white">15 DAYS</span>
          </div>
          <div className="forecast15-columns mt-1.5 text-[8px] font-semibold tracking-wide text-[#555] uppercase">
            <span>Date</span><span>Sky</span><span>High / Low</span><span>Rain</span><span>Wind</span><span />
          </div>
        </header>

        <section className="forecast15-list flex flex-col gap-[3px] overflow-hidden" aria-label="Daily forecasts">
          {forecast.map((item) => {
            const WeatherIcon = weatherIcons[item.kind];
            return (
              <article
                className="forecast15-columns forecast15-row shrink-0 items-center overflow-hidden rounded-xl border border-[#555] bg-white px-2"
                key={item.date}
                aria-label={`${item.day} ${item.date}, ${item.condition}, high ${item.high}, low ${item.low}, ${item.rain} percent rain, wind ${item.windDirection} ${item.windSpeed} ${windSpeedUnit}`}
              >
                <div className="leading-tight">
                  <h2 className="text-[11px] font-semibold">{item.day}</h2>
                  <p className="text-[9px] text-[#555]">{item.date}</p>
                </div>
                <WeatherIcon color="#555" size={27} weight="light" aria-hidden="true" />
                <p className="text-[11px] whitespace-nowrap"><strong className="font-semibold">{item.high}°</strong><span className="text-[#555]"> / {item.low}°</span></p>
                <p className="flex items-center gap-1 text-[10px]"><DropIcon color="#555" size={13} weight="light" aria-hidden="true" /><span>{item.rain}%</span></p>
                <div className="min-w-0 leading-tight">
                  <p className="truncate text-[10px] font-semibold">{item.windDirection} · {item.windSpeed} {windSpeedUnit}</p>
                  <p className="truncate text-[8px] text-[#555]">{item.condition}</p>
                </div>
                <CaretRightIcon color="#555" size={12} weight="light" aria-hidden="true" />
              </article>
            );
          })}
        </section>
      </section>
    </main>
  );
}

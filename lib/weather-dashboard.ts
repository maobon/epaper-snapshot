import { fetchDailyWeather, fetchDaysWeather, fetchHourlyWeather } from '@/lib/weather-api';
import { getWeatherPresentation, type WeatherDisplayKind, type WeatherKind } from '@/lib/weather-presentation';

const DISPLAY_CITY = 'Beijing';

export type MonitoredData<T> = {
  data: T;
  source: 'live' | 'fallback';
  error?: string;
};

function failureMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export type LandscapeDashboard = {
  city: string;
  dateLabel: string;
  current: { temp: number; kind: WeatherDisplayKind; condition: string; rain: number; humidity: number; wind: number };
  hourly: Array<{ time: string; temp: number }>;
  forecast: Array<{ day: string; high: number; low: number; kind: WeatherDisplayKind; selected?: boolean }>;
};

const fallbackLandscape: LandscapeDashboard = {
  city: DISPLAY_CITY,
  dateLabel: 'TUE · 22:25',
  current: { temp: 22, kind: 'partly-small', condition: 'Partly cloudy', rain: 9, humidity: 92, wind: 10 },
  hourly: [22, 25, 25, 25, 24, 24, 22, 22, 23, 24, 24, 25, 26, 26, 27, 27, 27, 27, 26, 25, 25, 25, 24, 24].map(
    (temp, index) => ({ time: `${String((22 + index) % 24).padStart(2, '0')}:00`, temp }),
  ),
  forecast: [
    ['Tue', 30, 22, 'rain'], ['Wed', 27, 21, 'cloudy'], ['Thu', 29, 21, 'cloudy'], ['Fri', 24, 19, 'rain'],
    ['Sat', 29, 19, 'sunny'], ['Sun', 31, 19, 'sunny'], ['Mon', 29, 20, 'sunny'], ['Tue', 29, 19, 'sunny'],
  ].map(([day, high, low, kind], index) => ({ day: String(day), high: Number(high), low: Number(low), kind: kind as WeatherKind, selected: index === 0 })),
};

function formatCurrentTime(value: string) {
  const [date = '2026-08-25', time = '22:25:00'] = value.split(' ');
  const parsed = new Date(`${date}T12:00:00+08:00`);
  const weekday = parsed.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'Asia/Shanghai' }).toUpperCase();
  return `${weekday} · ${time.slice(0, 5)}`;
}

function formatWeekday(value?: string) {
  if (!value) return '—';
  return new Date(`${value}T12:00:00+08:00`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'Asia/Shanghai' });
}

export async function loadLandscapeDashboard(): Promise<MonitoredData<LandscapeDashboard>> {
  type Hour = { temp?: number; rainprobability?: number; humidity?: number; ws?: number; time?: string; showHour?: string; icon?: string; weaType?: string; isdaynight?: boolean };
  type Day = { publicDate?: string; maxtemp?: number; mintemp?: number; dayWeaName?: string; dayWeaIcon?: string; conditionDay?: { weaIcon?: string } };
  type Source = { currentTime?: string; cityInfo?: { localizedName?: string; englishName?: string; name?: string }; actual?: { temperature?: number; humidity?: number; windspeed?: number; weaName?: string; weaIcon?: string }; hourly?: Hour[]; days?: { dailyWeathers?: Day[] } };

  try {
    const source = await fetchHourlyWeather<Source>();
    if (!source.actual || !source.currentTime) throw new Error('Hourly weather source omitted current conditions');
    const sourceHourly = source.hourly ?? [];
    const currentHour = sourceHourly[0];
    const currentWeather = getWeatherPresentation(source.actual.weaName ?? currentHour?.weaType, source.actual.weaIcon ?? currentHour?.icon, currentHour?.isdaynight ?? false);
    const currentDate = source.currentTime.slice(0, 10);
    const sourceDays = source.days?.dailyWeathers ?? [];
    const currentDayIndex = sourceDays.findIndex((item) => item.publicDate === currentDate);
    const forecast = (currentDayIndex >= 0 ? sourceDays.slice(currentDayIndex, currentDayIndex + 8) : []).map((item, index) => ({
      day: formatWeekday(item.publicDate),
      high: item.maxtemp ?? 0,
      low: item.mintemp ?? 0,
      kind: getWeatherPresentation(item.dayWeaName, item.dayWeaIcon ?? item.conditionDay?.weaIcon, true).kind,
      selected: index === 0,
    }));
    const hourly = sourceHourly.slice(0, 24).map((item, index) => ({
      time: item.showHour === '现在' ? 'Now' : item.time?.slice(11, 16) ?? `${String(index).padStart(2, '0')}:00`,
      temp: item.temp ?? 0,
    }));
    if (hourly.length !== 24 || forecast.length !== 8) throw new Error('Hourly weather source returned an incomplete forecast');
    return { source: 'live', data: {
      city: DISPLAY_CITY,
      dateLabel: formatCurrentTime(source.currentTime),
      current: {
        temp: source.actual.temperature ?? fallbackLandscape.current.temp,
        kind: currentWeather.kind,
        condition: currentWeather.label,
        rain: currentHour?.rainprobability ?? fallbackLandscape.current.rain,
        humidity: source.actual.humidity ?? currentHour?.humidity ?? fallbackLandscape.current.humidity,
        wind: source.actual.windspeed ?? currentHour?.ws ?? fallbackLandscape.current.wind,
      },
      hourly,
      forecast,
    } };
  } catch (error) {
    console.error('Unable to load landscape weather data:', error);
    return { source: 'fallback', data: fallbackLandscape, error: failureMessage(error) };
  }
}

export type PortraitForecastDay = { date: string; day: string; condition: string; high: number; low: number; wind: string; level: number; kind: WeatherKind };
export type PortraitDashboard = {
  city: string;
  dateLabel: string;
  day: { temp: number; kind: WeatherDisplayKind; condition: string; wind: number; gustLevel: number; feels: number; visibility: number; uv: string; cloud: number };
  night: { temp: number; kind: WeatherDisplayKind; condition: string; wind: number; gustLevel: number };
  distanceUnit: string;
  windUnit: string;
  hourly: Array<{ time: string; value: number; level: number }>;
  life: { dressing: string; carWash: string; sports: string; colds: string };
  forecast: PortraitForecastDay[];
};

const fallbackPortraitForecast: PortraitForecastDay[] = [
  ['08/24', 'Yesterday', 'Cloudy', 32, 25, 'SE', 2, 'cloudy'], ['08/25', 'Today', 'Mod. rain', 30, 21, 'NE', 2, 'rain'], ['08/26', 'Wed', 'Cloudy', 27, 21, 'NW', 2, 'cloudy'],
  ['08/27', 'Thu', 'Cloudy', 29, 21, 'N', 1, 'cloudy'], ['08/28', 'Fri', 'Light rain', 24, 19, 'NW', 1, 'rain'], ['08/29', 'Sat', 'Sunny', 29, 19, 'SW', 2, 'sunny'], ['08/30', 'Sun', 'Sunny', 31, 19, 'NW', 2, 'sunny'],
].map(([date, day, condition, high, low, wind, level, kind]) => ({ date: String(date), day: String(day), condition: String(condition), high: Number(high), low: Number(low), wind: String(wind), level: Number(level), kind: kind as WeatherKind }));

export const fallbackPortrait: PortraitDashboard = {
  city: DISPLAY_CITY, dateLabel: '08/25 TUE', distanceUnit: 'km', windUnit: 'km/h',
  day: { temp: 30, kind: 'rain', condition: 'Moderate rain', wind: 10, gustLevel: 3, feels: 34, visibility: 6, uv: 'Moderate', cloud: 95 },
  night: { temp: 21, kind: 'storm', condition: 'Thunderstorms', wind: 10, gustLevel: 3 },
  hourly: [33, 30, 31, 37, 34, 36, 40, 35, 42, 60, 59, 55, 68].map((value, index) => ({ time: String(index).padStart(2, '0'), value, level: value <= 50 ? 1 : 2 })),
  life: { dressing: 'Short sleeve', carWash: 'Not suitable', sports: 'Not suitable', colds: 'Easier' },
  forecast: fallbackPortraitForecast,
};

function uvLabel(value = 0) { return value <= 2 ? 'Low' : value <= 5 ? 'Moderate' : value <= 7 ? 'High' : value <= 10 ? 'Very high' : 'Extreme'; }
function translateLife(code: string, value?: string) {
  const known: Record<string, Record<string, string>> = {
    '2': { '短袖': 'Short sleeve', '长袖': 'Long sleeve', '薄外套': 'Light jacket' },
    '4': { '不宜': 'Not suitable', '较不宜': 'Less suitable', '适宜': 'Suitable', '较适宜': 'Suitable' },
    '5': { '不宜': 'Not suitable', '较不宜': 'Not suitable', '适宜': 'Suitable', '较适宜': 'Suitable' },
    '3': { '极易': 'Very easy', '较易': 'Easier', '易发': 'Likely', '少发': 'Unlikely', '不易': 'Unlikely' },
  };
  return (value && known[code]?.[value]) || value || ({ '2': 'Short sleeve', '4': 'Not suitable', '5': 'Not suitable', '3': 'Easier' }[code] ?? '—');
}
function formatPortraitDate(date: string, relative?: 'today' | 'yesterday') {
  const parsed = new Date(`${date}T12:00:00+08:00`);
  const mmdd = `${String(parsed.getMonth() + 1).padStart(2, '0')}/${String(parsed.getDate()).padStart(2, '0')}`;
  const weekday = parsed.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'Asia/Shanghai' });
  return { mmdd, weekday, day: relative === 'today' ? 'Today' : relative === 'yesterday' ? 'Yesterday' : weekday };
}

export async function loadPortraitDashboard(): Promise<MonitoredData<PortraitDashboard>> {
  type Condition = { winddir?: string; windGustPow?: number; windlevel?: number; windspeed?: number; weaIcon?: string };
  type Day = { publicDate: string; maxtemp?: number; mintemp?: number; dayWeaName?: string; nightWeaName?: string; conditionDay?: Condition; conditionNight?: Condition };
  type DailySource = { cityInfo?: { localizedName?: string; englishName?: string; name?: string }; currentTime?: string; disUnit?: string; windSpeedUnit?: string; forecastList?: { dailyWeathers?: Day[] }; lifeIndex?: Array<{ code?: string; levelList?: Array<{ day?: string; level?: string }> }> };
  type HourlySource = { actual?: { temperature?: number; realfeel?: number; visibility?: number; cloudCover?: number; uvindex?: number; windspeed?: number; windgustlevel?: number; weaName?: string; weaIcon?: string }; hourly?: Array<{ time?: string; aqi?: number; isdaynight?: boolean }> };
  try {
    const [source, hourlySource] = await Promise.all([fetchDailyWeather<DailySource>(), fetchHourlyWeather<HourlySource>()]);
    if (!source.currentTime || !hourlySource.actual) throw new Error('Weather source omitted current portrait conditions');
    const days = source.forecastList?.dailyWeathers ?? [];
    const currentIndex = days.findIndex((item) => item.publicDate === source.currentTime);
    const current = currentIndex >= 0 ? days[currentIndex] : undefined;
    if (!current) throw new Error('Weather source omitted the current portrait forecast');
    const currentHour = hourlySource.hourly?.[0];
    const dayWeather = getWeatherPresentation(hourlySource.actual.weaName, hourlySource.actual.weaIcon, currentHour?.isdaynight ?? true);
    const nightWeather = getWeatherPresentation(current.nightWeaName, current.conditionNight?.weaIcon, false);
    const currentDate = formatPortraitDate(source.currentTime, 'today');
    const forecast = days.slice(Math.max(0, currentIndex - 1), Math.max(0, currentIndex - 1) + 7).map((item, index) => {
      const presentation = getWeatherPresentation(item.dayWeaName, item.conditionDay?.weaIcon);
      const formatted = formatPortraitDate(item.publicDate, index === 0 ? 'yesterday' : index === 1 ? 'today' : undefined);
      return { date: formatted.mmdd, day: formatted.day, condition: presentation.label === 'Moderate rain' ? 'Mod. rain' : presentation.label, high: item.maxtemp ?? 0, low: item.mintemp ?? 0, wind: item.conditionDay?.winddir ?? '—', level: item.conditionDay?.windlevel ?? 0, kind: presentation.kind };
    });
    if (forecast.length !== 7) throw new Error('Weather source returned an incomplete portrait forecast');
    const lifeValue = (code: string) => source.lifeIndex?.find((item) => item.code === code)?.levelList?.find((item) => item.day === source.currentTime)?.level;
    const hourly = (hourlySource.hourly ?? []).slice(0, 13).map((item, index) => { const value = item.aqi ?? 0; return { time: item.time?.slice(11, 13) ?? String(index).padStart(2, '0'), value, level: value <= 50 ? 1 : value <= 100 ? 2 : 3 }; });
    if (hourly.length !== 13) throw new Error('Weather source returned an incomplete AQI forecast');
    return { source: 'live', data: {
      city: DISPLAY_CITY,
      dateLabel: `${currentDate.mmdd} ${currentDate.weekday.toUpperCase()}`,
      day: { temp: hourlySource.actual.temperature ?? fallbackPortrait.day.temp, kind: dayWeather.kind, condition: dayWeather.label, wind: hourlySource.actual.windspeed ?? fallbackPortrait.day.wind, gustLevel: hourlySource.actual.windgustlevel ?? fallbackPortrait.day.gustLevel, feels: hourlySource.actual.realfeel ?? fallbackPortrait.day.feels, visibility: hourlySource.actual.visibility ?? fallbackPortrait.day.visibility, uv: uvLabel(hourlySource.actual.uvindex), cloud: hourlySource.actual.cloudCover ?? fallbackPortrait.day.cloud },
      night: { temp: current.mintemp ?? fallbackPortrait.night.temp, kind: nightWeather.kind, condition: nightWeather.label, wind: current.conditionNight?.windspeed ?? fallbackPortrait.night.wind, gustLevel: current.conditionNight?.windGustPow ?? fallbackPortrait.night.gustLevel },
      distanceUnit: source.disUnit ?? fallbackPortrait.distanceUnit,
      windUnit: source.windSpeedUnit ?? fallbackPortrait.windUnit,
      hourly,
      life: { dressing: translateLife('2', lifeValue('2')), carWash: translateLife('4', lifeValue('4')), sports: translateLife('5', lifeValue('5')), colds: translateLife('3', lifeValue('3')) },
      forecast,
    } };
  } catch (error) {
    console.error('Unable to load portrait weather data:', error);
    return { source: 'fallback', data: fallbackPortrait, error: failureMessage(error) };
  }
}

export type Forecast15Item = { day: string; date: string; condition: string; kind: WeatherKind; high: number; low: number; rain: number; windDirection: string; windSpeed: number };
export type Forecast15Dashboard = { city: string; forecast: Forecast15Item[]; range: string; windSpeedUnit: string };

const fallback15: Forecast15Item[] = [
  ['Wed', '08/26', 'Cloudy', 'cloudy', 27, 21, 0, 'NW', 6], ['Thu', '08/27', 'Partly cloudy', 'partly', 29, 21, 10, 'N', 2], ['Fri', '08/28', 'Moderate rain', 'rain', 24, 19, 60, 'NW', 3],
  ['Sat', '08/29', 'Sunny', 'sunny', 29, 19, 0, 'SW', 11], ['Sun', '08/30', 'Sunny', 'sunny', 31, 19, 0, 'NW', 10], ['Mon', '08/31', 'Sunny', 'sunny', 29, 20, 0, 'NE', 10],
  ['Tue', '09/01', 'Sunny', 'sunny', 29, 19, 0, 'SE', 7], ['Wed', '09/02', 'Sunny', 'sunny', 29, 19, 0, 'SE', 8], ['Thu', '09/03', 'Mostly sunny', 'partly', 28, 20, 0, 'S', 10],
  ['Fri', '09/04', 'Partly cloudy', 'partly', 30, 21, 10, 'SE', 9], ['Sat', '09/05', 'Cloudy', 'cloudy', 26, 18, 20, 'SE', 11], ['Sun', '09/06', 'Sunny', 'sunny', 30, 20, 0, 'SE', 10],
  ['Mon', '09/07', 'Cloudy', 'cloudy', 29, 20, 10, 'SW', 6], ['Tue', '09/08', 'Light rain', 'rain', 25, 18, 50, 'SE', 8], ['Wed', '09/09', 'Cloudy', 'cloudy', 26, 17, 20, 'SE', 8],
].map(([day, date, condition, kind, high, low, rain, windDirection, windSpeed]) => ({ day: String(day), date: String(date), condition: String(condition), kind: kind as WeatherKind, high: Number(high), low: Number(low), rain: Number(rain), windDirection: String(windDirection), windSpeed: Number(windSpeed) }));

function forecast15Range(items: Forecast15Item[]) {
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const label = (value: string) => { const [month, day] = value.split('/').map(Number); return `${months[month - 1]} ${String(day).padStart(2, '0')}`; };
  return items.length ? `${label(items[0].date)} — ${label(items.at(-1)!.date)}` : '15 DAYS';
}

export async function loadForecast15Dashboard(): Promise<MonitoredData<Forecast15Dashboard>> {
  type Day = { publicDate: string; showDay?: string; maxtemp?: number; mintemp?: number; dayWeaName?: string; dayWeaIcon?: string; conditionDay?: { precProb?: number; rainProb?: number; winddir?: string; windspeed?: number } };
  type Source = { currentTime?: string; windSpeedUnit?: string; cityInfo?: { localizedName?: string; englishName?: string }; days?: { dailyWeathers?: Day[] } };
  const fallback = { city: DISPLAY_CITY, forecast: fallback15, range: forecast15Range(fallback15), windSpeedUnit: 'km/h' };
  try {
    const source = await fetchDaysWeather<Source>();
    const future = (source.days?.dailyWeathers ?? []).filter((item) => item.publicDate > (source.currentTime ?? '')).slice(0, 15);
    if (future.length !== 15) throw new Error('Weather source returned fewer than 15 future days');
    const forecast = future.map((item) => {
      const presentation = getWeatherPresentation(item.dayWeaName, item.dayWeaIcon);
      const condition = item.conditionDay ?? {};
      return { day: new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short' }).format(new Date(`${item.publicDate}T00:00:00Z`)), date: item.showDay || item.publicDate.slice(5).replace('-', '/'), condition: presentation.label, kind: presentation.kind, high: Math.round(Number(item.maxtemp ?? 0)), low: Math.round(Number(item.mintemp ?? 0)), rain: Math.round(Number(condition.precProb ?? condition.rainProb ?? 0)), windDirection: condition.winddir || '—', windSpeed: Math.round(Number(condition.windspeed ?? 0)) };
    });
    const data = { city: DISPLAY_CITY, forecast, range: forecast15Range(forecast), windSpeedUnit: source.windSpeedUnit ?? fallback.windSpeedUnit };
    return { source: 'live', data };
  } catch (error) {
    console.error('Unable to load 15-day weather data:', error);
    return { source: 'fallback', data: fallback, error: failureMessage(error) };
  }
}

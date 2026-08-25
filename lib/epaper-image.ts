import { BitDepth, ColorType, decode, encode } from '@cf-wasm/png/workerd';
import { Resvg } from '@cf-wasm/resvg/workerd';
import regularFontUrl from '@fontsource/inter/files/inter-latin-400-normal.woff2?url';
import boldFontUrl from '@fontsource/inter/files/inter-latin-700-normal.woff2?url';
import { fetchMonthlyUsdCnh, type ExchangeRatePoint } from '@/lib/exchange-rate-api';
import { fetchDailyWeather, fetchDaysWeather, fetchHourlyWeather } from '@/lib/weather-api';
import { getWeatherPresentation, type WeatherKind } from '@/lib/weather-presentation';

export type EpaperImageName = 'currency' | 'landscape' | 'portrait' | 'forecast-15d';

export const EPAPER_IMAGE_SPECS: Record<EpaperImageName, { width: number; height: number }> = {
  currency: { width: 800, height: 480 },
  landscape: { width: 800, height: 480 },
  portrait: { width: 480, height: 800 },
  'forecast-15d': { width: 480, height: 800 },
};

const BLACK = '#000000';
const DARK = '#555555';
const LIGHT = '#aaaaaa';
const WHITE = '#ffffff';
const CACHE_SECONDS = 3600;

let fontBuffersPromise: Promise<Uint8Array[]> | undefined;

function escapeXml(value: unknown) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function text(
  x: number,
  y: number,
  value: unknown,
  size = 12,
  weight: 400 | 700 = 400,
  options: { anchor?: 'start' | 'middle' | 'end'; fill?: string; spacing?: number } = {},
) {
  const anchor = options.anchor ?? 'start';
  const fill = options.fill ?? BLACK;
  const spacing = options.spacing ?? 0;
  return `<text x="${x}" y="${y}" font-family="Inter" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" fill="${fill}" letter-spacing="${spacing}">${escapeXml(value)}</text>`;
}

function rect(x: number, y: number, width: number, height: number, radius = 0, stroke = DARK, fill = WHITE, strokeWidth = 2) {
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
}

function line(x1: number, y1: number, x2: number, y2: number, stroke = LIGHT, width = 1) {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${width}"/>`;
}

function svgDocument(width: number, height: number, body: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${WHITE}"/>${body}</svg>`;
}

function weatherIcon(kind: WeatherKind, x: number, y: number, size: number, color = DARK) {
  const scale = size / 48;
  const cloud = `<path d="M10 30 C10 23 15 19 21 19 C23 12 29 9 35 12 C40 14 42 19 41 23 C46 24 48 28 47 33 C46 38 42 40 37 40 H18 C13 40 10 36 10 30 Z" fill="${WHITE}" stroke="${color}" stroke-width="2.4"/>`;
  const sun = `<circle cx="25" cy="24" r="8" fill="${WHITE}" stroke="${color}" stroke-width="2.4"/><g stroke="${color}" stroke-width="2"><line x1="25" y1="7" x2="25" y2="12"/><line x1="25" y1="36" x2="25" y2="41"/><line x1="8" y1="24" x2="13" y2="24"/><line x1="37" y1="24" x2="42" y2="24"/><line x1="13" y1="12" x2="17" y2="16"/><line x1="33" y1="32" x2="37" y2="36"/><line x1="37" y1="12" x2="33" y2="16"/><line x1="17" y1="32" x2="13" y2="36"/></g>`;
  let drawing = cloud;
  if (kind === 'sunny') drawing = sun;
  if (kind === 'partly') drawing = `<circle cx="17" cy="17" r="7" fill="${WHITE}" stroke="${color}" stroke-width="2"/>${cloud}`;
  if (kind === 'rain') drawing = `${cloud}<g stroke="${color}" stroke-width="2"><line x1="18" y1="42" x2="15" y2="47"/><line x1="29" y1="42" x2="26" y2="47"/><line x1="40" y1="42" x2="37" y2="47"/></g>`;
  if (kind === 'storm') drawing = `${cloud}<path d="M28 39 L23 47 H29 L25 54 L37 43 H31 L35 39 Z" fill="${color}"/>`;
  if (kind === 'snow') drawing = `${cloud}<g fill="${color}"><circle cx="18" cy="45" r="1.8"/><circle cx="29" cy="45" r="1.8"/><circle cx="40" cy="45" r="1.8"/></g>`;
  return `<g transform="translate(${x} ${y}) scale(${scale})">${drawing}</g>`;
}

function dateLabel(date: string, withYear = false) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    ...(withYear ? { year: 'numeric' as const } : {}),
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));
}

async function loadFontBuffers(requestUrl: string) {
  fontBuffersPromise ??= Promise.all([regularFontUrl, boldFontUrl].map(async (assetUrl) => {
    const response = await fetch(new URL(assetUrl, requestUrl));
    if (!response.ok) throw new Error(`Unable to load image font: ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }));
  return fontBuffersPromise;
}

async function svgToFourGrayPng(svg: string, requestUrl: string) {
  const fontBuffers = await loadFontBuffers(requestUrl);
  const renderer = await Resvg.async(svg, {
    background: WHITE,
    font: { fontBuffers, loadSystemFonts: false, defaultFontFamily: 'Inter' },
  });
  const rendered = renderer.render().asPng();
  const decoded = decode(rendered);
  if (decoded.colorType !== ColorType.RGBA || decoded.image.length !== decoded.width * decoded.height * 4) {
    throw new Error(`Unexpected raster format: colorType=${decoded.colorType}`);
  }

  const pixels = decoded.image;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const alpha = pixels[offset + 3] / 255;
    const red = pixels[offset] * alpha + 255 * (1 - alpha);
    const green = pixels[offset + 1] * alpha + 255 * (1 - alpha);
    const blue = pixels[offset + 2] * alpha + 255 * (1 - alpha);
    const luminance = red * 0.299 + green * 0.587 + blue * 0.114;
    const gray = Math.max(0, Math.min(255, Math.round(luminance / 85) * 85));
    pixels[offset] = gray;
    pixels[offset + 1] = gray;
    pixels[offset + 2] = gray;
    pixels[offset + 3] = 255;
  }

  return encode(pixels, decoded.width, decoded.height, {
    color: ColorType.RGBA,
    depth: BitDepth.Eight,
    stripAlpha: false,
  });
}

const fallbackRates: ExchangeRatePoint[] = [
  ['2026-07-27', 6.7666], ['2026-07-28', 6.7623], ['2026-07-29', 6.7634], ['2026-07-30', 6.7565],
  ['2026-07-31', 6.7463], ['2026-08-03', 6.7449], ['2026-08-04', 6.7492], ['2026-08-05', 6.7442],
  ['2026-08-06', 6.7418], ['2026-08-07', 6.7415], ['2026-08-10', 6.7407], ['2026-08-11', 6.7395],
  ['2026-08-12', 6.7415], ['2026-08-13', 6.7402], ['2026-08-14', 6.7407], ['2026-08-17', 6.7377],
  ['2026-08-18', 6.7376], ['2026-08-19', 6.7388], ['2026-08-20', 6.7263], ['2026-08-21', 6.718],
  ['2026-08-24', 6.716], ['2026-08-25', 6.7167],
].map(([date, rate]) => ({ date: String(date), rate: Number(rate) }));

async function currencySvg() {
  let points = fallbackRates;
  try { points = (await fetchMonthlyUsdCnh()).points; } catch { /* retain deterministic fallback */ }
  const values = points.map((point) => point.rate);
  const current = values.at(-1) ?? 6.7167;
  const change = ((current - (values[0] ?? current)) / (values[0] ?? current)) * 100;
  const min = Math.min(...values), max = Math.max(...values), padding = Math.max(0.008, (max - min) * 0.16);
  const low = min - padding, high = max + padding, span = high - low;
  const chart = values.map((value, index) => ({ x: 20 + index * 728 / Math.max(1, values.length - 1), y: 190 + (high - value) / span * 190 }));
  const chartPath = chart.map((point, index) => `${index ? 'L' : 'M'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
  const labels = Array.from({ length: 6 }, (_, index) => Math.round((points.length - 1) * index / 5));
  let body = rect(1, 1, 798, 478, 0, BLACK, WHITE, 2);
  body += text(20, 42, 'USD to CNH Chart', 27, 700);
  body += text(264, 42, `${change > 0 ? '+' : ''}${change.toFixed(2)}%`, 27, 400);
  body += text(356, 42, '(1M)', 16, 700);
  body += text(20, 75, 'US Dollar to Chinese Yuan Renminbi Offshore', 14, 700, { fill: DARK });
  body += `<circle cx="607" cy="29" r="5" fill="${BLACK}"/>`;
  body += text(620, 35, '1 USD =', 17, 400, { fill: DARK });
  body += text(688, 35, `${current.toFixed(4)} CNH`, 17, 700);
  body += text(780, 60, `${dateLabel(points.at(-1)?.date ?? '2026-08-25', true)} · Daily reference`, 12, 700, { anchor: 'end', fill: DARK });
  body += line(20, 105, 780, 105, LIGHT, 1);
  ['12H', '1D', '1W', '1M', '1Y', '2Y', '5Y', '10Y'].forEach((label, index) => {
    const x = 168 + index * 66;
    if (label === '1M') body += `<circle cx="${x}" cy="134" r="22" fill="${BLACK}"/>`;
    body += text(x, 140, label, 14, 700, { anchor: 'middle', fill: label === '1M' ? WHITE : DARK });
  });
  body += line(20, 176, 780, 176, LIGHT, 1);
  for (let index = 0; index < 5; index += 1) {
    const y = 190 + index * 47.5;
    body += line(20, y, 748, y, LIGHT, 1);
    body += text(778, y - 7, (high - span * index / 4).toFixed(5), 10, 700, { anchor: 'end', fill: DARK });
  }
  body += `<path d="${chartPath}" fill="none" stroke="${BLACK}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>`;
  const finalPoint = chart.at(-1)!;
  body += `<circle cx="${finalPoint.x}" cy="${finalPoint.y}" r="4" fill="${WHITE}" stroke="${BLACK}" stroke-width="2"/>`;
  body += line(20, 408, 780, 408, DARK, 1);
  labels.forEach((pointIndex, index) => { body += text(20 + index * 145.6, 430, dateLabel(points[pointIndex].date), 11, 700, { anchor: index === 0 ? 'start' : index === labels.length - 1 ? 'end' : 'middle', fill: DARK }); });
  body += line(20, 442, 780, 442, LIGHT, 1);
  body += text(20, 465, 'Reference exchange rate', 11, 700, { fill: DARK });
  body += text(780, 465, '30-day series · Refreshes hourly', 11, 700, { anchor: 'end', fill: DARK });
  return svgDocument(800, 480, body);
}

type LandscapeData = {
  city: string;
  time: string;
  current: { temp: number; condition: string; kind: WeatherKind; rain: number; humidity: number; wind: number };
  hourly: Array<{ time: string; temp: number }>;
  days: Array<{ day: string; high: number; low: number; condition: string; kind: WeatherKind }>;
};

const fallbackLandscape: LandscapeData = {
  city: 'Chaoyang District', time: 'WED · 00:42',
  current: { temp: 23, condition: 'Cloudy', kind: 'cloudy', rain: 46, humidity: 87, wind: 7 },
  hourly: [23, 23, 22, 22, 22, 23, 23, 25, 25, 27, 27, 27, 27, 25, 25, 25, 24, 24, 24, 24, 23, 23, 24, 24].map((temp, index) => ({ time: index === 0 ? 'Now' : `${String(index).padStart(2, '0')}:00`, temp })),
  days: [
    ['Wed', 27, 21, 'Cloudy', 'cloudy'], ['Thu', 29, 21, 'Cloudy', 'cloudy'], ['Fri', 24, 19, 'Light rain', 'rain'], ['Sat', 29, 19, 'Sunny', 'sunny'],
    ['Sun', 31, 19, 'Sunny', 'sunny'], ['Mon', 29, 20, 'Sunny', 'sunny'], ['Tue', 29, 19, 'Sunny', 'sunny'], ['Wed', 29, 19, 'Sunny', 'sunny'],
  ].map(([day, high, low, condition, kind]) => ({ day: String(day), high: Number(high), low: Number(low), condition: String(condition), kind: kind as WeatherKind })),
};

async function getLandscapeData(): Promise<LandscapeData> {
  type Hour = { temp?: number; rainprobability?: number; humidity?: number; ws?: number; time?: string; showHour?: string; weaType?: string; icon?: string };
  type Day = { publicDate?: string; maxtemp?: number; mintemp?: number; dayWeaName?: string; dayWeaIcon?: string };
  type Source = { currentTime?: string; cityInfo?: { localizedName?: string; englishName?: string }; actual?: { temperature?: number; humidity?: number; windspeed?: number; weaName?: string; weaIcon?: string }; hourly?: Hour[]; days?: { dailyWeathers?: Day[] } };
  try {
    const source = await fetchHourlyWeather<Source>();
    const hours = (source.hourly ?? []).slice(0, 24);
    const today = source.currentTime?.slice(0, 10) ?? '';
    const allDays = source.days?.dailyWeathers ?? [];
    const start = Math.max(0, allDays.findIndex((day) => day.publicDate === today));
    const days = allDays.slice(start, start + 8).map((day) => {
      const presentation = getWeatherPresentation(day.dayWeaName, day.dayWeaIcon);
      const weekday = day.publicDate ? new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${day.publicDate}T12:00:00Z`)) : '—';
      return { day: weekday, high: day.maxtemp ?? 0, low: day.mintemp ?? 0, condition: presentation.label, kind: presentation.kind };
    });
    if (!source.actual || hours.length < 8 || days.length < 8) return fallbackLandscape;
    const currentPresentation = getWeatherPresentation(source.actual.weaName ?? hours[0]?.weaType, source.actual.weaIcon ?? hours[0]?.icon);
    const timeParts = source.currentTime?.split(' ') ?? [];
    const weekday = timeParts[0] ? new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${timeParts[0]}T12:00:00Z`)).toUpperCase() : 'NOW';
    return {
      city: source.cityInfo?.localizedName ?? source.cityInfo?.englishName ?? fallbackLandscape.city,
      time: `${weekday} · ${(timeParts[1] ?? '00:00').slice(0, 5)}`,
      current: { temp: source.actual.temperature ?? 0, condition: currentPresentation.label, kind: currentPresentation.kind, rain: hours[0]?.rainprobability ?? 0, humidity: source.actual.humidity ?? hours[0]?.humidity ?? 0, wind: source.actual.windspeed ?? hours[0]?.ws ?? 0 },
      hourly: hours.map((hour, index) => ({ time: index === 0 ? 'Now' : hour.time?.slice(11, 16) ?? `${String(index).padStart(2, '0')}:00`, temp: hour.temp ?? 0 })),
      days,
    };
  } catch { return fallbackLandscape; }
}

async function landscapeSvg() {
  const data = await getLandscapeData();
  let body = rect(1, 1, 798, 478, 0, BLACK, WHITE, 2);
  body += rect(15, 15, 182, 31, 16, DARK, WHITE, 2) + `<circle cx="33" cy="30" r="6" fill="none" stroke="${BLACK}" stroke-width="2"/><circle cx="33" cy="28" r="2" fill="${BLACK}"/>` + text(47, 36, data.city, 14, 700);
  body += text(698, 35, data.time, 12, 700, { anchor: 'end', fill: DARK });
  body += rect(706, 19, 79, 23, 12, BLACK, BLACK, 0) + text(745, 35, data.current.condition.toUpperCase(), 12, 700, { anchor: 'middle', fill: WHITE });
  body += rect(15, 55, 770, 99, 16, DARK, WHITE, 2);
  body += weatherIcon(data.current.kind, 31, 72, 64, BLACK);
  body += text(114, 127, data.current.temp, 60, 700) + text(187, 100, '°C', 22, 700);
  body += text(227, 101, data.current.condition, 18, 700) + text(227, 123, 'Live conditions', 14, 700, { fill: DARK });
  const metrics = [['RAIN', `${data.current.rain}%`], ['HUMIDITY', `${data.current.humidity}%`], ['WIND', `${data.current.wind} km/h`]];
  metrics.forEach(([label, value], index) => {
    const x = 427 + index * 113;
    body += rect(x, 71, 114, 66, index === 0 ? 12 : index === 2 ? 12 : 0, DARK, WHITE, 1);
    body += text(x + 57, 97, label, 10, 700, { anchor: 'middle', fill: DARK, spacing: 1 }) + text(x + 57, 119, value, 18, 700, { anchor: 'middle' });
  });
  body += rect(15, 163, 770, 153, 16, DARK, WHITE, 2) + text(29, 188, 'Next 24 hours', 14, 700);
  body += rect(673, 176, 99, 18, 7, BLACK, BLACK, 0) + text(722, 189, 'TEMPERATURE', 10, 700, { anchor: 'middle', fill: WHITE });
  const temperatures = data.hourly.map((hour) => hour.temp), min = Math.min(...temperatures), max = Math.max(...temperatures), span = Math.max(1, max - min);
  const hourlyPoints = data.hourly.map((hour, index) => ({ x: 28 + index * 746 / Math.max(1, data.hourly.length - 1), y: 270 - (hour.temp - min) / span * 56 }));
  body += line(28, 278, 774, 278, LIGHT, 1) + `<path d="${hourlyPoints.map((p, i) => `${i ? 'L' : 'M'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')}" fill="none" stroke="${BLACK}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`;
  [0, 3, 6, 9, 12, 15, 18, 21].forEach((index, slot) => { const point = hourlyPoints[index]; body += text(point.x, Math.max(205, point.y - 8), `${data.hourly[index].temp}°`, 11, 700, { anchor: 'middle', fill: DARK }); body += text(75 + slot * 93, 297, data.hourly[index].time, 11, 700, { anchor: 'middle', fill: DARK }); });
  data.days.forEach((day, index) => {
    const x = 15 + index * 97;
    const selected = index === 0;
    body += rect(x, 325, 92, 141, 12, selected ? BLACK : LIGHT, selected ? DARK : WHITE, 2);
    body += text(x + 46, 351, day.day, 16, 700, { anchor: 'middle', fill: selected ? WHITE : BLACK });
    body += text(x + 46, 368, selected ? 'TODAY' : 'FORECAST', 9, 700, { anchor: 'middle', fill: selected ? LIGHT : DARK, spacing: 0.7 });
    body += weatherIcon(day.kind, x + 24, 376, 44, selected ? WHITE : BLACK);
    body += text(x + 35, 452, `${day.high}°`, 13, 700, { anchor: 'end', fill: selected ? WHITE : BLACK });
    body += text(x + 41, 452, `${day.low}°`, 13, 400, { fill: selected ? LIGHT : DARK });
  });
  return svgDocument(800, 480, body);
}

type PortraitDay = { date: string; day: string; high: number; low: number; kind: WeatherKind; condition: string; wind: string; level: number };
type PortraitData = {
  city: string; date: string; day: { temp: number; kind: WeatherKind; condition: string; wind: number; feels: number; visibility: number; uv: string; cloud: number }; night: { temp: number; kind: WeatherKind; condition: string; wind: number };
  aqi: Array<{ time: string; value: number }>; life: string[]; forecast: PortraitDay[];
};

const fallbackPortrait: PortraitData = {
  city: 'Chaoyang District', date: '08/26 WED',
  day: { temp: 27, kind: 'cloudy', condition: 'Cloudy', wind: 7, feels: 31, visibility: 10, uv: 'Low', cloud: 95 },
  night: { temp: 21, kind: 'partly', condition: 'Partly cloudy', wind: 9 },
  aqi: Array.from({ length: 13 }, (_, index) => ({ time: String(index).padStart(2, '0'), value: 20 + index * 2 })),
  life: ['Dressing · Short sleeve', 'Car wash · Not suitable', 'Sports · Suitable', 'Colds · Easier'],
  forecast: [
    ['08/25', 'Yesterday', 30, 22, 'rain', 'Mod. rain', 'NE', 2], ['08/26', 'Today', 27, 21, 'cloudy', 'Cloudy', 'NW', 2], ['08/27', 'Thu', 29, 21, 'cloudy', 'Cloudy', 'N', 1],
    ['08/28', 'Fri', 24, 19, 'rain', 'Light rain', 'N', 1], ['08/29', 'Sat', 29, 19, 'sunny', 'Sunny', 'SW', 2], ['08/30', 'Sun', 31, 19, 'sunny', 'Sunny', 'NW', 2], ['08/31', 'Mon', 29, 20, 'sunny', 'Sunny', 'NE', 2],
  ].map(([date, day, high, low, kind, condition, wind, level]) => ({ date: String(date), day: String(day), high: Number(high), low: Number(low), kind: kind as WeatherKind, condition: String(condition), wind: String(wind), level: Number(level) })),
};

async function getPortraitData(): Promise<PortraitData> {
  type Condition = { cloudCover?: number; winddir?: string; windspeed?: number; weaName?: string; weaIcon?: string };
  type Day = { publicDate: string; maxtemp?: number; mintemp?: number; realFeelTempMax?: number; visibility?: number; uvIndex?: number; dayWeaName?: string; nightWeaName?: string; conditionDay?: Condition; conditionNight?: Condition };
  type Source = { currentTime?: string; cityInfo?: { localizedName?: string; englishName?: string }; forecastList?: { dailyWeathers?: Day[] }; aqiHourly?: Array<{ time?: string; aqi?: number }> };
  try {
    const source = await fetchDailyWeather<Source>();
    const days = source.forecastList?.dailyWeathers ?? [], currentDate = source.currentTime ?? '';
    const currentIndex = days.findIndex((day) => day.publicDate === currentDate), current = days[currentIndex];
    if (!current) return fallbackPortrait;
    const dayPresentation = getWeatherPresentation(current.dayWeaName, current.conditionDay?.weaIcon), nightPresentation = getWeatherPresentation(current.nightWeaName, current.conditionNight?.weaIcon);
    const forecast = days.slice(Math.max(0, currentIndex - 1), Math.max(0, currentIndex - 1) + 7).map((day, index) => {
      const presentation = getWeatherPresentation(day.dayWeaName, day.conditionDay?.weaIcon);
      const parsed = new Date(`${day.publicDate}T12:00:00Z`), mmdd = `${String(parsed.getUTCMonth() + 1).padStart(2, '0')}/${String(parsed.getUTCDate()).padStart(2, '0')}`;
      return { date: mmdd, day: index === 0 ? 'Yesterday' : index === 1 ? 'Today' : new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(parsed), high: day.maxtemp ?? 0, low: day.mintemp ?? 0, kind: presentation.kind, condition: presentation.label, wind: day.conditionDay?.winddir ?? '—', level: 2 };
    });
    if (forecast.length < 7) return fallbackPortrait;
    const parsed = new Date(`${currentDate}T12:00:00Z`), displayDate = `${String(parsed.getUTCMonth() + 1).padStart(2, '0')}/${String(parsed.getUTCDate()).padStart(2, '0')} ${new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(parsed).toUpperCase()}`;
    return {
      city: source.cityInfo?.localizedName ?? source.cityInfo?.englishName ?? fallbackPortrait.city, date: displayDate,
      day: { temp: current.maxtemp ?? 0, kind: dayPresentation.kind, condition: dayPresentation.label, wind: current.conditionDay?.windspeed ?? 0, feels: current.realFeelTempMax ?? 0, visibility: current.visibility ?? 0, uv: (current.uvIndex ?? 0) <= 2 ? 'Low' : (current.uvIndex ?? 0) <= 5 ? 'Moderate' : 'High', cloud: current.conditionDay?.cloudCover ?? 0 },
      night: { temp: current.mintemp ?? 0, kind: nightPresentation.kind, condition: nightPresentation.label, wind: current.conditionNight?.windspeed ?? 0 },
      aqi: (source.aqiHourly ?? []).slice(0, 13).map((item, index) => ({ time: item.time?.slice(-5, -3) ?? String(index).padStart(2, '0'), value: item.aqi ?? 0 })),
      life: fallbackPortrait.life, forecast,
    };
  } catch { return fallbackPortrait; }
}

function sectionTitle(y: number, title: string, note?: string) {
  return text(20, y, title, 14, 700, { spacing: 0.2 }) + (note ? text(460, y, note, 11, 700, { anchor: 'end', fill: DARK }) : '');
}

async function portraitSvg() {
  const data = await getPortraitData();
  let body = rect(1, 1, 478, 798, 0, BLACK, WHITE, 2);
  body += rect(10, 10, 460, 184, 14, DARK, WHITE, 2) + text(20, 34, 'DAY', 14, 700) + text(460, 34, `${data.city.toUpperCase()} · ${data.date}`, 11, 700, { anchor: 'end', fill: DARK });
  body += text(20, 106, data.day.temp, 68, 700) + text(91, 65, '°', 26, 700) + weatherIcon(data.day.kind, 145, 47, 48, DARK) + text(169, 111, data.day.condition.toUpperCase(), 12, 700, { anchor: 'middle' });
  body += text(338, 70, `Wind ${data.day.wind} km/h`, 13, 700) + text(338, 94, 'Gust · Level 3', 13, 700);
  body += line(20, 122, 460, 122, LIGHT, 1);
  const detail = [['FEELS LIKE', `${data.day.feels}°`], ['VISIBILITY', `${data.day.visibility} km`], ['UV INDEX', data.day.uv], ['CLOUD', `${data.day.cloud}%`]];
  detail.forEach(([label, value], index) => { const x = 20 + index * 110; if (index) body += line(x, 130, x, 184, LIGHT, 1); body += text(x + 10, 153, label, 9, 700, { fill: DARK, spacing: 0.5 }) + text(x + 10, 177, value, 14, 700); });
  body += rect(10, 201, 460, 96, 14, DARK, WHITE, 2) + sectionTitle(225, 'NIGHT', '18:00 — 06:00');
  body += text(20, 280, data.night.temp, 55, 700) + text(77, 251, '°', 22, 700) + weatherIcon(data.night.kind, 132, 235, 38, DARK) + text(178, 265, data.night.condition.toUpperCase(), 10, 700) + text(338, 253, `Wind ${data.night.wind} km/h`, 13, 700) + text(338, 277, 'Gust · Level 3', 13, 700);
  body += rect(10, 304, 460, 123, 14, DARK, WHITE, 2) + sectionTitle(328, 'HOURLY AQI FORECAST', 'LIVE') + line(20, 410, 460, 410, LIGHT, 1);
  const aqi = data.aqi.length >= 13 ? data.aqi.slice(0, 13) : fallbackPortrait.aqi;
  aqi.forEach((item, index) => { const x = 40 + index * 33; const height = Math.max(14, Math.min(45, item.value * 0.45)); body += `<rect x="${x - 4}" y="${402 - height}" width="8" height="${height}" rx="3" fill="${index === 0 ? DARK : LIGHT}"/>` + text(x, 420, item.time, 9, 700, { anchor: 'middle', fill: DARK }); });
  body += rect(10, 434, 460, 118, 14, DARK, WHITE, 2) + sectionTitle(458, 'LIFE INDEX', 'TODAY');
  body += line(240, 466, 240, 542, LIGHT, 1) + line(20, 506, 230, 506, LIGHT, 1) + line(250, 506, 460, 506, LIGHT, 1);
  data.life.forEach((item, index) => { const [label, value] = item.split(' · '); const col = index % 2, row = Math.floor(index / 2), x = 28 + col * 230, y = 487 + row * 40; body += text(x, y, label, 12, 700) + text(x, y + 15, value, 11, 400, { fill: DARK }); });
  body += rect(10, 559, 460, 231, 14, DARK, WHITE, 2) + sectionTitle(583, '7-DAY FORECAST', 'LIVE');
  data.forecast.forEach((day, index) => { const x = 43 + index * 65; body += text(x, 601, day.date, 9, 700, { anchor: 'middle', fill: DARK }) + text(x, 616, day.day, 10, 700, { anchor: 'middle' }) + weatherIcon(day.kind, x - 14, 621, 28, DARK) + text(x, 667, day.condition.length > 10 ? day.condition.slice(0, 9) : day.condition, 9, 700, { anchor: 'middle' }) + text(x, 700, `${day.high}°`, 11, 700, { anchor: 'middle' }) + text(x, 743, `${day.low}°`, 10, 700, { anchor: 'middle', fill: DARK }) + text(x, 766, `${day.wind} · ${day.level}`, 9, 700, { anchor: 'middle' }); });
  const high = data.forecast.map((day, index) => `${index ? 'L' : 'M'} ${43 + index * 65} ${718 - (day.high - Math.min(...data.forecast.map((item) => item.high))) * 3}`).join(' ');
  const low = data.forecast.map((day, index) => `${index ? 'L' : 'M'} ${43 + index * 65} ${756 - (day.low - Math.min(...data.forecast.map((item) => item.low))) * 3}`).join(' ');
  body += `<path d="${high}" fill="none" stroke="${BLACK}" stroke-width="2"/><path d="${low}" fill="none" stroke="${LIGHT}" stroke-width="2"/>`;
  return svgDocument(480, 800, body);
}

type Forecast15Item = { day: string; date: string; condition: string; kind: WeatherKind; high: number; low: number; rain: number; wind: string; speed: number };
const fallback15: Forecast15Item[] = Array.from({ length: 15 }, (_, index) => {
  const date = new Date(Date.UTC(2026, 7, 27 + index));
  const kinds: WeatherKind[] = ['cloudy', 'rain', 'sunny', 'sunny', 'sunny', 'sunny', 'sunny', 'sunny', 'cloudy', 'cloudy', 'sunny', 'cloudy', 'cloudy', 'cloudy', 'cloudy'];
  return { day: new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(date), date: `${String(date.getUTCMonth() + 1).padStart(2, '0')}/${String(date.getUTCDate()).padStart(2, '0')}`, condition: kinds[index] === 'sunny' ? 'Sunny' : kinds[index] === 'rain' ? 'Light rain' : 'Cloudy', kind: kinds[index], high: [29, 24, 29, 31, 29, 29, 29, 28, 30, 26, 30, 29, 25, 25, 26][index], low: [21, 19, 19, 19, 20, 19, 19, 20, 21, 18, 20, 20, 18, 18, 17][index], rain: [10, 80, 5, 5, 5, 5, 5, 5, 10, 30, 5, 20, 20, 10, 10][index], wind: ['N', 'N', 'SW', 'NW', 'NE', 'SE', 'SE', 'S', 'SE', 'SE', 'SE', 'SW', 'SE', 'SE', 'SE'][index], speed: [5, 4, 6, 9, 9, 8, 10, 11, 8, 9, 6, 8, 9, 6, 6][index] };
});

async function getForecast15() {
  type SourceDay = { publicDate: string; showDay?: string; maxtemp?: number; mintemp?: number; dayWeaName?: string; dayWeaIcon?: string; conditionDay?: { precProb?: number; rainProb?: number; winddir?: string; windspeed?: number } };
  type Source = { currentTime?: string; cityInfo?: { localizedName?: string; englishName?: string }; days?: { dailyWeathers?: SourceDay[] } };
  try {
    const source = await fetchDaysWeather<Source>();
    const future = (source.days?.dailyWeathers ?? []).filter((day) => day.publicDate > (source.currentTime ?? '')).slice(0, 15);
    if (future.length < 15) return { city: 'Chaoyang District', items: fallback15 };
    return { city: source.cityInfo?.localizedName ?? source.cityInfo?.englishName ?? 'Chaoyang District', items: future.map((day) => { const presentation = getWeatherPresentation(day.dayWeaName, day.dayWeaIcon), condition = day.conditionDay ?? {}; return { day: new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${day.publicDate}T12:00:00Z`)), date: day.showDay || day.publicDate.slice(5).replace('-', '/'), condition: presentation.label, kind: presentation.kind, high: Math.round(day.maxtemp ?? 0), low: Math.round(day.mintemp ?? 0), rain: Math.round(condition.precProb ?? condition.rainProb ?? 0), wind: condition.winddir ?? '—', speed: Math.round(condition.windspeed ?? 0) }; }) };
  } catch { return { city: 'Chaoyang District', items: fallback15 }; }
}

async function forecast15Svg() {
  const { city, items } = await getForecast15();
  let body = rect(1, 1, 478, 798, 0, BLACK, WHITE, 2) + rect(10, 10, 460, 58, 12, DARK, WHITE, 2);
  body += text(18, 31, '15-DAY FORECAST', 15, 700) + text(18, 46, `${city.toUpperCase()} · ${items[0].date} — ${items.at(-1)?.date}`, 9, 700, { fill: DARK, spacing: 0.4 });
  body += rect(399, 21, 61, 20, 10, BLACK, BLACK, 0) + text(429, 35, '15 DAYS', 9, 700, { anchor: 'middle', fill: WHITE });
  [['DATE', 18], ['SKY', 84], ['HIGH / LOW', 120], ['RAIN', 190], ['WIND', 240]].forEach(([label, x]) => { body += text(Number(x), 61, label, 8, 700, { fill: DARK, spacing: 0.5 }); });
  items.forEach((item, index) => {
    const y = 73 + index * 48;
    body += rect(10, y, 460, 44, 10, DARK, WHITE, 2);
    body += text(20, y + 18, item.day, 13, 700) + text(20, y + 33, item.date, 10, 700, { fill: DARK });
    body += weatherIcon(item.kind, 78, y + 7, 30, DARK);
    body += text(120, y + 23, `${item.high}°`, 13, 700) + text(151, y + 23, `/ ${item.low}°`, 12, 700, { fill: DARK });
    body += text(200, y + 23, `${item.rain}%`, 11, 700);
    body += text(240, y + 19, `${item.wind} · ${item.speed} km/h`, 11, 700) + text(240, y + 34, item.condition, 9, 700, { fill: DARK });
    body += text(458, y + 27, '›', 18, 400, { anchor: 'end', fill: DARK });
  });
  return svgDocument(480, 800, body);
}

export async function generateEpaperImage(name: EpaperImageName, requestUrl: string) {
  const svg = name === 'currency' ? await currencySvg() : name === 'landscape' ? await landscapeSvg() : name === 'portrait' ? await portraitSvg() : await forecast15Svg();
  const png = await svgToFourGrayPng(svg, requestUrl);
  return { png, svg, ...EPAPER_IMAGE_SPECS[name] };
}

export function imageCacheHeaders(fileName: string) {
  return {
    'Cache-Control': `public, max-age=0, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=60`,
    'Content-Disposition': `inline; filename="${fileName}"`,
    'X-Content-Type-Options': 'nosniff',
  };
}

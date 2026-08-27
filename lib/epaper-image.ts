import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BitDepth, ColorType, decode, encode } from '@cf-wasm/png/node';
import { Resvg } from '@cf-wasm/resvg/node';
import { fetchMonthlyUsdCnh, type ExchangeRatePoint } from '@/lib/exchange-rate-api';
import { createRenderManifest, type RenderManifest } from '@/lib/render-monitor';
import { loadForecast15Dashboard, loadLandscapeDashboard, loadPortraitDashboard } from '@/lib/weather-dashboard';
import type { WeatherDisplayKind } from '@/lib/weather-presentation';

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

function weatherIcon(kind: WeatherDisplayKind, x: number, y: number, size: number, color = DARK) {
  const scale = size / 48;
  const cloud = `<path d="M10 30 C10 23 15 19 21 19 C23 12 29 9 35 12 C40 14 42 19 41 23 C46 24 48 28 47 33 C46 38 42 40 37 40 H18 C13 40 10 36 10 30 Z" fill="${WHITE}" stroke="${color}" stroke-width="2.4"/>`;
  const sun = `<circle cx="25" cy="24" r="8" fill="${WHITE}" stroke="${color}" stroke-width="2.4"/><g stroke="${color}" stroke-width="2"><line x1="25" y1="7" x2="25" y2="12"/><line x1="25" y1="36" x2="25" y2="41"/><line x1="8" y1="24" x2="13" y2="24"/><line x1="37" y1="24" x2="42" y2="24"/><line x1="13" y1="12" x2="17" y2="16"/><line x1="33" y1="32" x2="37" y2="36"/><line x1="37" y1="12" x2="33" y2="16"/><line x1="17" y1="32" x2="13" y2="36"/></g>`;
  let drawing = cloud;
  if (kind === 'sunny') drawing = sun;
  if (kind === 'partly') drawing = `<circle cx="17" cy="17" r="7" fill="${WHITE}" stroke="${color}" stroke-width="2"/>${cloud}`;
  if (kind === 'night-clear') drawing = `<path d="M34 9 C22 12 17 27 25 37 C29 42 36 43 42 40 C36 48 22 48 15 38 C7 27 12 11 24 6 C28 5 31 6 34 9 Z" fill="${WHITE}" stroke="${color}" stroke-width="2.4"/>`;
  if (kind === 'partly-small') drawing = `<path d="M29 8 C20 11 17 22 23 29 C26 33 31 34 36 32 C31 39 20 39 15 31 C9 22 13 11 22 7 C25 6 27 7 29 8 Z" fill="${WHITE}" stroke="${color}" stroke-width="2"/>${cloud}`;
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

async function loadFontBuffers() {
  const fontDirectory = join(process.cwd(), 'node_modules', '@fontsource', 'inter', 'files');
  fontBuffersPromise ??= Promise.all([
    'inter-latin-400-normal.woff2',
    'inter-latin-700-normal.woff2',
  ].map(async (fileName) => new Uint8Array(await readFile(join(fontDirectory, fileName)))));
  return fontBuffersPromise;
}

async function svgToFourGrayPng(svg: string) {
  const fontBuffers = await loadFontBuffers();
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
  let source: 'live' | 'fallback' = 'fallback';
  try { points = (await fetchMonthlyUsdCnh()).points; source = 'live'; } catch { /* retain deterministic fallback */ }
  const values = points.map((point) => point.rate);
  const current = values.at(-1) ?? 6.7167;
  const min = Math.min(...values), max = Math.max(...values), padding = Math.max(0.008, (max - min) * 0.16);
  const low = min - padding, high = max + padding, span = high - low;
  const chart = values.map((value, index) => ({ x: 10 + index * 768 / Math.max(1, values.length - 1), y: 100 + (high - value) / span * 337 }));
  const chartPath = chart.map((point, index) => `${index ? 'L' : 'M'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
  const labels = Array.from({ length: 6 }, (_, index) => Math.round((points.length - 1) * index / 5));
  let body = rect(1, 1, 798, 478, 0, BLACK, WHITE, 2);
  body += text(10, 42, 'USD to CNH Chart', 27, 700);
  body += rect(244, 18, 42, 24, 12, DARK, WHITE, 1) + text(265, 35, '1M', 12, 700, { anchor: 'middle' });
  body += text(10, 75, 'US Dollar to Chinese Yuan Renminbi Offshore', 14, 700, { fill: DARK });
  body += text(630, 35, '1 USD =', 17, 400, { fill: DARK });
  body += text(698, 35, `${current.toFixed(4)} CNH`, 17, 700);
  body += text(790, 60, `${dateLabel(points.at(-1)?.date ?? '2026-08-25', true)} · Daily reference`, 12, 700, { anchor: 'end', fill: DARK });
  for (let index = 0; index < 5; index += 1) {
    const y = 100 + index * (337 / 4);
    body += line(10, y, 778, y, LIGHT, 1);
    body += text(788, y - 7, (high - span * index / 4).toFixed(4), 10, 700, { anchor: 'end', fill: DARK });
  }
  body += `<path d="${chartPath}" fill="none" stroke="${BLACK}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  const finalPoint = chart.at(-1)!;
  body += `<circle cx="${finalPoint.x}" cy="${finalPoint.y}" r="3" fill="${WHITE}" stroke="${BLACK}" stroke-width="1"/>`;
  labels.forEach((pointIndex) => {
    const point = chart[pointIndex];
    const nearbyLineYs = [point.y];
    for (const neighbor of [chart[pointIndex - 1], chart[pointIndex + 1]]) {
      if (!neighbor) continue;
      const distance = Math.abs(neighbor.x - point.x);
      const ratio = Math.min(23, distance) / Math.max(1, distance);
      nearbyLineYs.push(point.y + (neighbor.y - point.y) * ratio);
    }
    const upperLineY = Math.min(...nearbyLineYs), lowerLineY = Math.max(...nearbyLineYs);
    const placeBelow = upperLineY - 100 < 22 && 437 - lowerLineY > upperLineY - 100;
    const labelX = Math.max(10, Math.min(744, point.x - 23));
    const labelY = placeBelow ? lowerLineY + 8 : upperLineY - 22;
    body += rect(labelX, labelY, 46, 14, 2, WHITE, WHITE, 0);
    body += text(labelX + 23, labelY + 10, points[pointIndex].rate.toFixed(4), 9, 700, { anchor: 'middle', fill: DARK });
  });
  labels.forEach((pointIndex, index) => { body += text(chart[pointIndex].x, 463, dateLabel(points[pointIndex].date), 11, 700, { anchor: index === 0 ? 'start' : index === labels.length - 1 ? 'end' : 'middle', fill: DARK }); });
  return { svg: svgDocument(800, 480, body), manifest: createRenderManifest('currency', source, points) };
}

async function landscapeSvg() {
  const loaded = await loadLandscapeDashboard();
  const data = loaded.data;
  let body = rect(1, 1, 798, 478, 0, BLACK, WHITE, 2);
  body += rect(15, 15, 84, 31, 16, DARK, WHITE, 2) + text(27, 36, data.city, 14, 700);
  body += text(698, 35, data.dateLabel, 12, 700, { anchor: 'end', fill: DARK });
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
  body += line(28, 278, 774, 278, LIGHT, 1) + `<path d="${hourlyPoints.map((p, i) => `${i ? 'L' : 'M'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')}" fill="none" stroke="${BLACK}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
  [0, 3, 6, 9, 12, 15, 18, 21].forEach((index) => { const point = hourlyPoints[index], isHighest = data.hourly[index].temp === max; body += text(point.x, Math.max(isHighest ? 199 : 205, point.y - (isHighest ? 14 : 8)), `${data.hourly[index].temp}°`, 11, 700, { anchor: index === 0 ? 'start' : 'middle', fill: DARK }); body += text(point.x, 297, data.hourly[index].time, 11, 700, { anchor: index === 0 ? 'start' : 'middle', fill: DARK }); });
  data.forecast.forEach((day, index) => {
    const x = 15 + index * 97;
    const selected = index === 0;
    body += rect(x, 325, 92, 141, 12, selected ? BLACK : LIGHT, selected ? DARK : WHITE, 2);
    body += text(x + 46, 351, day.day, 16, 700, { anchor: 'middle', fill: selected ? WHITE : BLACK });
    body += text(x + 46, 368, selected ? 'TODAY' : 'FORECAST', 9, 700, { anchor: 'middle', fill: selected ? LIGHT : DARK, spacing: 0.7 });
    body += weatherIcon(day.kind, x + 24, 376, 44, selected ? WHITE : BLACK);
    body += text(x + 35, 452, `${day.high}°`, 13, 700, { anchor: 'end', fill: selected ? WHITE : BLACK });
    body += text(x + 41, 452, `${day.low}°`, 13, 400, { fill: selected ? LIGHT : DARK });
  });
  return { svg: svgDocument(800, 480, body), manifest: createRenderManifest('landscape', loaded.source, data) };
}

function sectionTitle(y: number, title: string, note?: string) {
  return text(20, y, title, 14, 700, { spacing: 0.2 }) + (note ? text(460, y, note, 11, 700, { anchor: 'end', fill: DARK }) : '');
}

async function portraitSvg() {
  const loaded = await loadPortraitDashboard();
  const data = loaded.data;
  let body = rect(1, 1, 478, 798, 0, BLACK, WHITE, 2);
  body += rect(10, 10, 460, 184, 14, DARK, WHITE, 2) + text(20, 34, 'CURRENT', 14, 700) + text(460, 34, `${data.city.toUpperCase()} · ${data.dateLabel}`, 11, 700, { anchor: 'end', fill: DARK });
  body += text(20, 106, data.day.temp, 68, 700) + text(91, 65, '°', 26, 700) + weatherIcon(data.day.kind, 201, 47, 48, DARK) + text(225, 111, data.day.condition.toUpperCase(), 12, 700, { anchor: 'middle' });
  body += text(358, 70, `Wind ${data.day.wind} ${data.windUnit}`, 13, 700) + text(358, 94, `Gust · Level ${data.day.gustLevel}`, 13, 700);
  body += line(20, 122, 460, 122, LIGHT, 1);
  const detail = [['FEELS LIKE', `${data.day.feels}°`], ['VISIBILITY', `${data.day.visibility} ${data.distanceUnit}`], ['UV INDEX', data.day.uv], ['CLOUD', `${data.day.cloud}%`]];
  detail.forEach(([label, value], index) => { const x = 20 + index * 110; if (index) body += line(x, 130, x, 184, LIGHT, 1); body += text(x + 10, 153, label, 9, 700, { fill: DARK, spacing: 0.5 }) + text(x + 10, 177, value, 14, 700); });
  body += rect(10, 201, 460, 96, 14, DARK, WHITE, 2) + sectionTitle(225, 'NIGHT', '18:00 — 06:00');
  body += text(20, 280, data.night.temp, 55, 700) + text(77, 251, '°', 22, 700) + weatherIcon(data.night.kind, 170, 235, 38, DARK) + text(216, 265, data.night.condition.toUpperCase(), 10, 700) + text(358, 253, `Wind ${data.night.wind} ${data.windUnit}`, 13, 700) + text(358, 277, `Gust · Level ${data.night.gustLevel}`, 13, 700);
  body += rect(10, 304, 460, 123, 14, DARK, WHITE, 2) + sectionTitle(328, 'HOURLY AQI FORECAST', 'LIVE') + line(20, 410, 460, 410, LIGHT, 1);
  const aqi = data.hourly;
  aqi.forEach((item, index) => { const x = 40 + index * 33; const height = Math.max(14, Math.min(45, item.value * 0.45)); body += `<rect x="${x - 4}" y="${402 - height}" width="8" height="${height}" rx="3" fill="${index === 0 ? DARK : LIGHT}"/>` + text(x, 420, item.time, 9, 700, { anchor: 'middle', fill: DARK }); });
  body += rect(10, 434, 460, 118, 14, DARK, WHITE, 2) + sectionTitle(458, 'LIFE INDEX', 'TODAY');
  body += line(240, 466, 240, 542, LIGHT, 1) + line(20, 506, 230, 506, LIGHT, 1) + line(250, 506, 460, 506, LIGHT, 1);
  Object.entries({ Dressing: data.life.dressing, 'Car wash': data.life.carWash, Sports: data.life.sports, Colds: data.life.colds }).forEach(([label, value], index) => { const col = index % 2, row = Math.floor(index / 2), x = 28 + col * 230, y = 487 + row * 40; body += text(x, y, label, 12, 700) + text(x, y + 15, value, 11, 400, { fill: DARK }); });
  body += rect(10, 559, 460, 231, 14, DARK, WHITE, 2) + sectionTitle(583, '7-DAY FORECAST', 'LIVE');
  const forecastX = (index: number) => 20 + ((index + 0.5) * 440) / data.forecast.length;
  data.forecast.forEach((day, index) => { const x = forecastX(index); body += text(x, 601, day.date, 9, 700, { anchor: 'middle', fill: DARK }) + text(x, 616, day.day, 10, 700, { anchor: 'middle' }) + weatherIcon(day.kind, x - 14, 621, 28, DARK) + text(x, 667, day.condition.length > 10 ? day.condition.slice(0, 9) : day.condition, 9, 700, { anchor: 'middle' }) + text(x, 700, `${day.high}°`, 11, 700, { anchor: 'middle' }) + text(x, 743, `${day.low}°`, 10, 700, { anchor: 'middle', fill: DARK }) + text(x, 766, `${day.wind} · ${day.level}`, 9, 700, { anchor: 'middle' }); });
  const high = data.forecast.map((day, index) => `${index ? 'L' : 'M'} ${forecastX(index)} ${718 - (day.high - Math.min(...data.forecast.map((item) => item.high))) * 3}`).join(' ');
  const low = data.forecast.map((day, index) => `${index ? 'L' : 'M'} ${forecastX(index)} ${756 - (day.low - Math.min(...data.forecast.map((item) => item.low))) * 3}`).join(' ');
  body += `<path d="${high}" fill="none" stroke="${BLACK}" stroke-width="2"/><path d="${low}" fill="none" stroke="${LIGHT}" stroke-width="2"/>`;
  return { svg: svgDocument(480, 800, body), manifest: createRenderManifest('portrait', loaded.source, data) };
}

async function forecast15Svg() {
  const loaded = await loadForecast15Dashboard();
  const { city, forecast: items } = loaded.data;
  let body = rect(1, 1, 478, 798, 0, BLACK, WHITE, 2);
  body += text(18, 32, '15-DAY FORECAST', 15, 700) + text(18, 47, `${city.toUpperCase()} · ${items[0].date} — ${items.at(-1)?.date}`, 9, 700, { fill: DARK, spacing: 0.4 });
  items.forEach((item, index) => {
    const y = 65 + index * (728 / 15);
    body += text(20, y + 18, item.day, 13, 700) + text(20, y + 33, item.date, 10, 700, { fill: DARK });
    body += weatherIcon(item.kind, 108, y + 7, 30, DARK);
    body += text(176, y + 23, `${item.high}°`, 13, 700) + text(207, y + 23, `/ ${item.low}°`, 12, 700, { fill: DARK });
    body += text(282, y + 23, `${item.rain}%`, 11, 700);
    body += text(460, y + 19, `${item.windDirection} · ${item.windSpeed} ${loaded.data.windSpeedUnit}`, 11, 700, { anchor: 'end' }) + text(460, y + 34, item.condition, 9, 700, { anchor: 'end', fill: DARK });
  });
  return { svg: svgDocument(480, 800, body), manifest: createRenderManifest('forecast-15d', loaded.source, loaded.data) };
}

export async function generateEpaperImage(name: EpaperImageName) {
  const rendered: { svg: string; manifest: RenderManifest } = name === 'currency' ? await currencySvg() : name === 'landscape' ? await landscapeSvg() : name === 'portrait' ? await portraitSvg() : await forecast15Svg();
  const { svg, manifest } = rendered;
  const png = await svgToFourGrayPng(svg);
  return { png, svg, manifest, ...EPAPER_IMAGE_SPECS[name] };
}

export function imageCacheHeaders(fileName: string) {
  return {
    'Cache-Control': 'no-store',
    'Content-Disposition': `inline; filename="${fileName}"`,
    'X-Content-Type-Options': 'nosniff',
  };
}

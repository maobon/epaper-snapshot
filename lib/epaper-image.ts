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
  options: { anchor?: 'start' | 'middle' | 'end'; baseline?: 'middle'; fill?: string; spacing?: number } = {},
) {
  const anchor = options.anchor ?? 'start';
  const fill = options.fill ?? BLACK;
  const spacing = options.spacing ?? 0;
  const baseline = options.baseline ? ` dominant-baseline="${options.baseline}"` : '';
  return `<text x="${x}" y="${y}" font-family="Inter" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" fill="${fill}" letter-spacing="${spacing}"${baseline}>${escapeXml(value)}</text>`;
}

function rect(x: number, y: number, width: number, height: number, radius = 0, stroke = DARK, fill = WHITE, strokeWidth = 2) {
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
}

function line(x1: number, y1: number, x2: number, y2: number, stroke = LIGHT, width = 1) {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${width}"/>`;
}

function wrapTextLines(value: string, maxLineLength: number) {
  const words = value.trim().split(/\s+/).flatMap((word) => {
    if (word.length <= maxLineLength) return [word];
    const splitAt = Math.ceil(word.length / 2);
    return [word.slice(0, splitAt), word.slice(splitAt)];
  });
  return words.reduce<string[]>((lines, word) => {
    const current = lines.at(-1);
    if (!current || `${current} ${word}`.length > maxLineLength) lines.push(word);
    else lines[lines.length - 1] = `${current} ${word}`;
    return lines;
  }, []).slice(0, 2);
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
  const chart = values.map((value, index) => ({ x: 10 + index * 768 / Math.max(1, values.length - 1), y: 70 + (high - value) / span * 367 }));
  const chartPath = chart.map((point, index) => `${index ? 'L' : 'M'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
  const labels = Array.from({ length: 6 }, (_, index) => Math.round((points.length - 1) * index / 5));
  let body = rect(1, 1, 798, 478, 0, BLACK, WHITE, 2);
  body += text(10, 42, 'USD to CNH Chart', 27, 700);
  body += rect(244, 18, 42, 24, 12, DARK, WHITE, 1) + text(265, 35, '1M', 12, 700, { anchor: 'middle' });
  body += text(10, 65, 'US Dollar to Chinese Yuan Renminbi Offshore', 14, 700, { fill: DARK });
  body += `<text x="790" y="39" font-family="Inter" font-size="25" text-anchor="end"><tspan font-weight="400" fill="${DARK}">1 USD = </tspan><tspan font-weight="700" fill="${BLACK}">${escapeXml(current.toFixed(4))} CNH</tspan></text>`;
  body += text(790, 60, `${dateLabel(points.at(-1)?.date ?? '2026-08-25', true)} · Daily reference`, 12, 700, { anchor: 'end', fill: DARK });
  for (let index = 0; index < 5; index += 1) {
    const y = 70 + index * (367 / 4);
    body += line(10, y, 778, y, LIGHT, 1);
    body += text(788, index === 0 ? y + 20 : y - 7, (high - span * index / 4).toFixed(4), 10, 700, { anchor: 'end', fill: DARK });
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
    const placeBelow = upperLineY - 70 < 22 && 437 - lowerLineY > upperLineY - 70;
    const labelX = Math.max(10, Math.min(726, point.x - 32));
    const labelY = placeBelow ? lowerLineY + 8 : upperLineY - 29;
    body += rect(labelX, labelY, 64, 21, 2, WHITE, WHITE, 0);
    body += text(labelX + 32, labelY + 15, points[pointIndex].rate.toFixed(4), 15, 700, { anchor: 'middle', fill: DARK });
  });
  labels.forEach((pointIndex, index) => { body += text(chart[pointIndex].x, 460, dateLabel(points[pointIndex].date), 9, 700, { anchor: index === 0 ? 'start' : index === labels.length - 1 ? 'end' : 'middle', fill: DARK }); });
  return { svg: svgDocument(800, 480, body), manifest: createRenderManifest('currency', source, points) };
}

async function landscapeSvg() {
  const loaded = await loadLandscapeDashboard();
  const data = loaded.data;
  let body = '<defs><pattern id="forecast-selected-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="8" stroke="#aaaaaa" stroke-width="1"/></pattern></defs>' + rect(1, 1, 798, 478, 0, BLACK, WHITE, 2);
  body += text(35, 39, data.city, 24, 700, { spacing: 0.2 });
  body += text(765, 38, data.dateLabel, 20, 700, { anchor: 'end', fill: DARK });
  body += rect(15, 55, 770, 99, 16, DARK, WHITE, 2);
  body += weatherIcon(data.current.kind, 31, 72, 64, BLACK);
  body += text(114, 127, data.current.temp, 60, 700) + text(187, 100, '°C', 22, 700);
  body += text(322, 104.5, data.current.condition, 30, 700, { anchor: 'middle', baseline: 'middle' });
  const metrics = [['RAIN', `${data.current.rain}%`], ['HUMIDITY', `${data.current.humidity}%`], ['WIND', `${data.current.wind} km/h`]];
  metrics.forEach(([label, value], index) => {
    const x = 427 + index * 113;
    body += rect(x, 71, 114, 66, index === 0 ? 12 : index === 2 ? 12 : 0, DARK, WHITE, 1);
    body += text(x + 57, 98, label, 18, 700, { anchor: 'middle', fill: DARK, spacing: 0.35 }) + text(x + 57, 126, value, 24, 700, { anchor: 'middle' });
  });
  body += rect(15, 163, 770, 153, 16, DARK, WHITE, 2) + text(29, 188, 'Next 24 hours', 14, 700);
  const temperatures = data.hourly.map((hour) => hour.temp), min = Math.min(...temperatures), max = Math.max(...temperatures), span = Math.max(1, max - min);
  const hourlyLabelIndices = Array.from({ length: 8 }, (_, position) => Math.round(position * (data.hourly.length - 1) / 7));
  const hourlyPeriods = hourlyLabelIndices.map((index) => data.hourly[index]);
  const hourlyPoints = hourlyPeriods.map((hour, position) => ({ x: 28 + position * 746 / Math.max(1, hourlyPeriods.length - 1), y: 270 - (hour.temp - min) / span * 56 }));
  body += line(28, 278, 774, 278, LIGHT, 1) + `<path d="${hourlyPoints.map((p, i) => `${i ? 'L' : 'M'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')}" fill="none" stroke="${BLACK}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
  hourlyPeriods.forEach((hour, position) => { const point = hourlyPoints[position], isHighest = hour.temp === max, anchor = position === 0 ? 'start' : position === hourlyPeriods.length - 1 ? 'end' : 'middle'; body += text(point.x, Math.max(isHighest ? 199 : 205, point.y - (isHighest ? 14 : 8)), `${hour.temp}°`, 11, 700, { anchor, fill: BLACK }); body += text(point.x, 297, hour.time, 11, 700, { anchor, fill: DARK }); });
  data.forecast.forEach((day, index) => {
    const x = 15 + index * 97;
    const selected = index === 0;
    body += rect(x, 325, 92, 141, 12, selected ? BLACK : LIGHT, selected ? 'url(#forecast-selected-hatch)' : WHITE, 2);
    body += text(x + 46, 352, day.day, 20, 700, { anchor: 'middle' });
    body += weatherIcon(day.kind, x + 24, 369, 44, BLACK);
    body += text(x + 43, 452, `${day.high}°`, 18, 700, { anchor: 'end' });
    body += text(x + 52, 452, `${day.low}°`, 18, 400, { fill: DARK });
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
  body += text(20, 106, data.day.temp, 68, 700) + text(91, 65, '°', 26, 700) + weatherIcon(data.day.kind, 201, 47, 48, DARK) + text(225, 111, data.day.condition.toUpperCase(), 20, 700, { anchor: 'middle' });
  body += text(350, 70, `Wind ${data.day.wind} ${data.windUnit}`, 17, 700) + text(350, 94, `Gust · Level ${data.day.gustLevel}`, 17, 700);
  body += line(20, 122, 460, 122, LIGHT, 1);
  const detail = [['FEELS LIKE', `${data.day.feels}°`], ['VISIBILITY', `${data.day.visibility} ${data.distanceUnit}`], ['UV INDEX', data.day.uv], ['CLOUD', `${data.day.cloud}%`]];
  detail.forEach(([label, value], index) => { const x = 20 + index * 110; if (index) body += line(x, 130, x, 184, LIGHT, 1); body += text(x + 55, 154, label, 14, 700, { anchor: 'middle', fill: DARK, spacing: 0.2 }) + text(x + 55, 179, value, 20, 700, { anchor: 'middle' }); });
  body += rect(10, 201, 460, 96, 14, DARK, WHITE, 2) + sectionTitle(225, 'NIGHT', '18:00 — 06:00');
  body += text(20, 280, data.night.temp, 55, 700) + text(77, 251, '°', 22, 700) + weatherIcon(data.night.kind, 142, 235, 38, DARK) + text(188, 265, data.night.condition.toUpperCase(), 18, 700) + text(350, 253, `Wind ${data.night.wind} ${data.windUnit}`, 17, 700) + text(350, 277, `Gust · Level ${data.night.gustLevel}`, 17, 700);
  body += rect(10, 304, 460, 123, 14, DARK, WHITE, 2) + sectionTitle(328, 'HOURLY AQI FORECAST', 'LIVE') + line(20, 410, 460, 410, LIGHT, 1);
  const aqi = data.hourly;
  aqi.forEach((item, index) => { const x = 40 + index * 33; const height = Math.max(14, Math.min(45, item.value * 0.45)); body += `<rect x="${x - 4}" y="${402 - height}" width="8" height="${height}" rx="3" fill="${index === 0 ? DARK : LIGHT}"/>` + text(x, 420, item.time, 9, 700, { anchor: 'middle', fill: DARK }); });
  body += rect(10, 434, 460, 356, 14, DARK, WHITE, 2) + sectionTitle(458, '7-DAY FORECAST', 'LIVE');
  const forecastX = (index: number) => 20 + ((index + 0.5) * 440) / data.forecast.length;
  data.forecast.forEach((day, index) => {
    const x = forecastX(index);
    const conditionLines = wrapTextLines(day.condition, 11);
    body += text(x, 499, day.date, 9, 700, { anchor: 'middle', fill: DARK }) + text(x, 522, day.day, 11, 700, { anchor: 'middle' }) + weatherIcon(day.kind, x - 16, 529, 32, DARK);
    body += conditionLines.map((condition, lineIndex) => text(x, conditionLines.length === 1 ? 600 : 594 + lineIndex * 12, condition, 11, 700, { anchor: 'middle' })).join('');
    body += text(x, 651, `${day.high}°`, 16, 700, { anchor: 'middle' }) + text(x, 735, `${day.low}°`, 16, 700, { anchor: 'middle', fill: DARK }) + text(x, 785, `${day.wind} · ${day.level}`, 11, 700, { anchor: 'middle' });
  });
  const high = data.forecast.map((day, index) => `${index ? 'L' : 'M'} ${forecastX(index)} ${679 - (day.high - Math.min(...data.forecast.map((item) => item.high))) * 4.5}`).join(' ');
  const low = data.forecast.map((day, index) => `${index ? 'L' : 'M'} ${forecastX(index)} ${737 - (day.low - Math.min(...data.forecast.map((item) => item.low))) * 4.5}`).join(' ');
  body += `<path d="${high}" fill="none" stroke="${LIGHT}" stroke-width="2"/><path d="${low}" fill="none" stroke="${LIGHT}" stroke-width="2"/>`;
  return { svg: svgDocument(480, 800, body), manifest: createRenderManifest('portrait', loaded.source, data) };
}

async function forecast15Svg() {
  const loaded = await loadForecast15Dashboard();
  const { city, forecast: items } = loaded.data;
  let body = rect(1, 1, 478, 798, 0, BLACK, WHITE, 2);
  body += text(18, 32, '15-DAY FORECAST', 18, 700) + text(18, 48, `${city.toUpperCase()} · ${items[0].date} — ${items.at(-1)?.date}`, 11, 700, { fill: DARK, spacing: 0.4 });
  items.forEach((item, index) => {
    const y = 65 + index * (728 / 15);
    body += text(20, y + 18, item.day, 16, 700) + text(20, y + 35, item.date, 13, 700, { fill: DARK });
    body += weatherIcon(item.kind, 94, y + 4, 36, DARK);
    body += text(166, y + 24, `${item.high}°`, 16, 700) + text(203, y + 24, `/ ${item.low}°`, 15, 700, { fill: DARK });
    body += text(264, y + 24, `${item.rain}%`, 16, 700);
    body += text(460, y + 19, `${item.windDirection} · ${item.windSpeed} ${loaded.data.windSpeedUnit}`, 16, 700, { anchor: 'end' }) + text(460, y + 36, item.condition, 14, 700, { anchor: 'end', fill: DARK });
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

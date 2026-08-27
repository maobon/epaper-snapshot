import type { CSSProperties } from 'react';
import { fetchMonthlyUsdCnh, type ExchangeRatePoint } from '@/lib/exchange-rate-api';
import { createRenderManifest, serializeRenderManifest } from '@/lib/render-monitor';

export const dynamic = 'force-dynamic';

type DashboardData = {
  points: ExchangeRatePoint[];
  currentDate: string;
};

const fallbackData: DashboardData = {
  currentDate: '2026-08-25',
  points: [
    ['2026-07-27', 6.7666], ['2026-07-28', 6.7623], ['2026-07-29', 6.7634],
    ['2026-07-30', 6.7565], ['2026-07-31', 6.7463], ['2026-08-03', 6.7449],
    ['2026-08-04', 6.7492], ['2026-08-05', 6.7442], ['2026-08-06', 6.7418],
    ['2026-08-07', 6.7415], ['2026-08-10', 6.7407], ['2026-08-11', 6.7395],
    ['2026-08-12', 6.7415], ['2026-08-13', 6.7402], ['2026-08-14', 6.7407],
    ['2026-08-17', 6.7377], ['2026-08-18', 6.7376], ['2026-08-19', 6.7388],
    ['2026-08-20', 6.7263], ['2026-08-21', 6.7180], ['2026-08-24', 6.7160],
    ['2026-08-25', 6.7167],
  ].map(([date, rate]) => ({ date: String(date), rate: Number(rate) })),
};

async function getDashboardData(): Promise<{ data: DashboardData; source: 'live' | 'fallback' }> {
  try {
    return { data: await fetchMonthlyUsdCnh(), source: 'live' };
  } catch (error) {
    console.error('Unable to load USD/CNH exchange rates:', error);
    return { data: fallbackData, source: 'fallback' };
  }
}

function formatDisplayDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T12:00:00Z`));
}

function formatAxisDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T12:00:00Z`));
}

function makeChartPoints(values: number[]) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const padding = Math.max(0.008, (max - min) * 0.16);
  const low = min - padding;
  const high = max + padding;
  const span = high - low;

  return {
    high,
    low,
    points: values.map((value, index) => ({
      x: (index * 768) / Math.max(1, values.length - 1),
      y: 4 + ((high - value) / span) * 337,
    })),
  };
}

function lineStyle(
  point: { x: number; y: number },
  next: { x: number; y: number },
): CSSProperties {
  const dx = next.x - point.x;
  const dy = next.y - point.y;

  return {
    left: point.x,
    top: point.y,
    width: Math.sqrt(dx * dx + dy * dy),
    transform: `rotate(${Math.atan2(dy, dx) * (180 / Math.PI)}deg)`,
  };
}

function rateLabelStyle(points: Array<{ x: number; y: number }>, index: number): CSSProperties {
  const point = points[index];
  const nearbyLineYs = [point.y];

  for (const neighbor of [points[index - 1], points[index + 1]]) {
    if (!neighbor) continue;
    const distance = Math.abs(neighbor.x - point.x);
    const ratio = Math.min(24, distance) / Math.max(1, distance);
    nearbyLineYs.push(point.y + (neighbor.y - point.y) * ratio);
  }

  const upperLineY = Math.min(...nearbyLineYs);
  const lowerLineY = Math.max(...nearbyLineYs);
  const spaceAbove = upperLineY - 4;
  const spaceBelow = 341 - lowerLineY;
  const placeBelow = spaceAbove < 24 && spaceBelow > spaceAbove;

  return placeBelow
    ? { top: lowerLineY + 8, transform: 'translate(-50%, 0)' }
    : { top: upperLineY - 8, transform: 'translate(-50%, -100%)' };
}

export default async function CurrencyDashboard() {
  const loaded = await getDashboardData();
  const dashboard = loaded.data;
  const manifest = createRenderManifest('currency', loaded.source, dashboard.points);
  const rates = dashboard.points.map((point) => point.rate);
  const currentRate = rates.at(-1) ?? 6.718;
  const chart = makeChartPoints(rates);
  const levels = Array.from({ length: 5 }, (_, index) => chart.high - ((chart.high - chart.low) * index) / 4);
  const lastPointIndex = dashboard.points.length - 1;
  const labelIndices = Array.from({ length: 6 }, (_, index) => Math.round((lastPointIndex * index) / 5)).filter(
    (index, position, indices) => index >= 0 && index < dashboard.points.length && indices.indexOf(index) === position,
  );

  return (
    <main className="currency-stage">
      <script id="render-monitor-manifest" type="application/json" dangerouslySetInnerHTML={{ __html: serializeRenderManifest(manifest) }} />
      <section className="currency-screen" aria-label="USD to CNH one month exchange rate chart">
        <header className="currency-header">
          <div>
            <div className="currency-title-row">
              <h1>USD to CNH Chart</h1>
              <span>1M</span>
            </div>
            <p>US Dollar to Chinese Yuan Renminbi Offshore</p>
          </div>
          <div className="currency-quote">
            <div>1 USD = <strong>{currentRate.toFixed(4)} CNH</strong></div>
            <time dateTime={dashboard.currentDate}>{formatDisplayDate(dashboard.currentDate)} · Daily reference</time>
          </div>
        </header>

        <section className="currency-chart" aria-label={`One month exchange rate, currently ${currentRate.toFixed(4)} CNH per US dollar`}>
          <div className="currency-plot">
            {levels.map((level, index) => (
              <div className="currency-grid-line" key={level} style={{ top: 4 + index * (337 / 4) }}>
                <span>{level.toFixed(4)}</span>
              </div>
            ))}
            {chart.points.slice(0, -1).map((point, index) => (
              <i className="currency-chart-line" key={`${point.x}-${point.y}`} style={lineStyle(point, chart.points[index + 1])} />
            ))}
            {labelIndices.map((pointIndex) => {
              const point = chart.points[pointIndex];
              return (
                <b
                  className="currency-point-rate"
                  key={`rate-${dashboard.points[pointIndex].date}`}
                  style={{ left: Math.min(744, Math.max(24, point.x)), ...rateLabelStyle(chart.points, pointIndex) }}
                >
                  {dashboard.points[pointIndex].rate.toFixed(4)}
                </b>
              );
            })}
            <i className="currency-last-dot" style={{ left: chart.points.at(-1)?.x, top: chart.points.at(-1)?.y }} />
          </div>

          <div className="currency-dates" aria-hidden="true">
            {labelIndices.map((pointIndex, position) => (
              <span
                key={dashboard.points[pointIndex].date}
                style={{
                  left: chart.points[pointIndex].x,
                  transform: position === 0 ? undefined : position === labelIndices.length - 1 ? 'translateX(-100%)' : 'translateX(-50%)',
                }}
              >
                {formatAxisDate(dashboard.points[pointIndex].date)}
              </span>
            ))}
          </div>
        </section>

      </section>
    </main>
  );
}

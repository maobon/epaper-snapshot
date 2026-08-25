import type { CSSProperties } from 'react';
import { fetchMonthlyUsdCnh, type ExchangeRatePoint } from '@/lib/exchange-rate-api';

export const dynamic = 'force-dynamic';

const timeRanges = ['12H', '1D', '1W', '1M', '1Y', '2Y', '5Y', '10Y'];

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

async function getDashboardData(): Promise<DashboardData> {
  try {
    return await fetchMonthlyUsdCnh();
  } catch (error) {
    console.error('Unable to load USD/CNH exchange rates:', error);
    return fallbackData;
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
      x: (index * 728) / Math.max(1, values.length - 1),
      y: 14 + ((high - value) / span) * 218,
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

export default async function CurrencyDashboard() {
  const dashboard = await getDashboardData();
  const rates = dashboard.points.map((point) => point.rate);
  const currentRate = rates.at(-1) ?? 6.718;
  const startRate = rates[0] ?? currentRate;
  const change = ((currentRate - startRate) / startRate) * 100;
  const chart = makeChartPoints(rates);
  const levels = Array.from({ length: 5 }, (_, index) => chart.high - ((chart.high - chart.low) * index) / 4);
  const lastPointIndex = dashboard.points.length - 1;
  const labelIndices = Array.from({ length: 6 }, (_, index) => Math.round((lastPointIndex * index) / 5)).filter(
    (index, position, indices) => index >= 0 && index < dashboard.points.length && indices.indexOf(index) === position,
  );

  return (
    <main className="currency-stage">
      <section className="currency-screen" aria-label="USD to CNH one month exchange rate chart">
        <header className="currency-header">
          <div>
            <div className="currency-title-row">
              <h1>USD to CNH Chart</h1>
              <strong className={change < 0 ? 'currency-negative' : 'currency-positive'}>
                {change > 0 ? '+' : ''}{change.toFixed(2)}%
              </strong>
              <span>(1M)</span>
            </div>
            <p>US Dollar to Chinese Yuan Renminbi Offshore</p>
          </div>
          <div className="currency-quote">
            <div><i aria-hidden="true" />1 USD = <strong>{currentRate.toFixed(4)} CNH</strong></div>
            <time dateTime={dashboard.currentDate}>{formatDisplayDate(dashboard.currentDate)} · Daily reference</time>
          </div>
        </header>

        <nav className="currency-ranges" aria-label="Chart time range">
          {timeRanges.map((range) => (
            <span className={range === '1M' ? 'active' : ''} key={range}>{range}</span>
          ))}
        </nav>

        <section className="currency-chart" aria-label={`One month exchange rate, currently ${currentRate.toFixed(4)} CNH per US dollar`}>
          <div className="currency-plot">
            {levels.map((level, index) => (
              <div className="currency-grid-line" key={level} style={{ top: 14 + index * 54.5 }}>
                <span>{level.toFixed(5)}</span>
              </div>
            ))}
            {chart.points.slice(0, -1).map((point, index) => (
              <i className="currency-chart-line" key={`${point.x}-${point.y}`} style={lineStyle(point, chart.points[index + 1])} />
            ))}
            <i className="currency-last-dot" style={{ left: chart.points.at(-1)?.x, top: chart.points.at(-1)?.y }} />
          </div>

          <div className="currency-dates" aria-hidden="true">
            {labelIndices.map((index) => <span key={dashboard.points[index].date}>{formatAxisDate(dashboard.points[index].date)}</span>)}
          </div>
        </section>

        <footer className="currency-footer">
          <span>Reference exchange rate</span>
          <span>30-day series · Refreshes hourly</span>
        </footer>
      </section>
    </main>
  );
}

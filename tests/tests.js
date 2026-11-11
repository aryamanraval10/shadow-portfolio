// Browser-run checks for the pure modules. Open tests/ through the dev server.
import { createMarket, dayIndex, tradingDays, buildPrices } from '../src/market.js';
import { compute } from '../src/portfolio.js';

const results = [];
const test = (name, fn) => {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (e) {
    results.push({ name, ok: false, error: e.message });
  }
};
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg || 'assertion failed');
};
const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

const market = createMarket('2026-10-01');
const { days, prices } = market;
const last = days.length - 1;

test('prices are identical on every build', () => {
  const again = buildPrices(days.length);
  for (const t in prices) for (let i = 0; i < days.length; i += 97) assert(prices[t][i] === again[t][i], t);
});

test('a longer history does not change earlier prices', () => {
  const longer = buildPrices(tradingDays('2020-01-02', '2027-01-01').length);
  assert(longer.AAPL[last] === prices.AAPL[last]);
});

test('trading days skip weekends', () => {
  assert(days.every((d) => ![0, 6].includes(new Date(d + 'T00:00:00Z').getUTCDay())));
});

test('weekend dates roll to the next trading day; out-of-range dates are rejected', () => {
  assert(days[dayIndex(days, '2026-09-26', market.today)] === '2026-09-28');
  assert(dayIndex(days, '2019-01-01', market.today) === -1);
  assert(dayIndex(days, '2026-10-02', market.today) === -1);
  assert(dayIndex(days, 'nope', market.today) === -1);
});

test('buying SPY itself ties the shadow exactly', () => {
  const date = '2025-06-02';
  const { series } = compute([{ id: 1, date, ticker: 'SPY', shares: 3, price: market.closeOn('SPY', date) }], market);
  for (let i = 0; i < series.n; i++) assert(close(series.you[i], series.shadow[i]), 'day ' + i);
});

test('invested steps up by each trade cost on its day', () => {
  const trades = [
    { id: 1, date: '2025-03-14', ticker: 'AAPL', shares: 10, price: 100 },
    { id: 2, date: '2025-05-02', ticker: 'NVDA', shares: 5, price: 20 },
  ];
  const { series } = compute(trades, market);
  const second = dayIndex(days, '2025-05-02', market.today) - series.first;
  assert(series.invested[0] === 1000);
  assert(series.invested[second - 1] === 1000);
  assert(series.invested[second] === 1100);
});

test('per-trade results add up to the portfolio totals', () => {
  const trades = [
    { id: 1, date: '2025-03-14', ticker: 'AAPL', shares: 10, price: 120 },
    { id: 2, date: '2025-05-02', ticker: 'NVDA', shares: 15, price: 31.5 },
    { id: 3, date: '2026-01-15', ticker: 'AAPL', shares: 2, price: 150 },
  ];
  const { per, series } = compute(trades, market);
  const L = series.n - 1;
  let now = 0;
  let vs = 0;
  for (const id in per) {
    now += per[id].now;
    vs += per[id].vs;
  }
  assert(close(now, series.you[L]));
  assert(close(vs, series.you[L] - series.shadow[L]));
});

test('invalid trades are left out, not counted as zero', () => {
  const { per, series } = compute(
    [
      { id: 1, date: '2025-03-14', ticker: 'AAPL', shares: 0, price: 100 },
      { id: 2, date: '2018-01-01', ticker: 'AAPL', shares: 1, price: 100 },
      { id: 3, date: '2025-03-14', ticker: 'NOPE', shares: 1, price: 100 },
    ],
    market,
  );
  assert(series === null);
  assert(per[1] === null && per[2] === null && per[3] === null);
});

const failed = results.filter((r) => !r.ok).length;
document.getElementById('summary').textContent = failed ? `${failed} of ${results.length} failed` : `All ${results.length} passed`;
document.getElementById('out').innerHTML = results
  .map((r) => `<li class="${r.ok ? 'ok' : 'fail'}">${r.ok ? '✓' : '✗'} ${r.name}${r.ok ? '' : ' — ' + r.error}</li>`)
  .join('');
window.testResults = results;

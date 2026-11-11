// Simulated market. Everything is seeded, so every reload produces the same prices.
// To use real data instead, replace createMarket() with something that returns the
// same shape: { days: ['YYYY-MM-DD', ...], prices: { TICKER: number[] }, today }.

export const START = '2020-01-02';
export const BENCHMARK = 'SPY';

// [start price, beta to market, own annual volatility, annual drift on top of the market]
export const TICKERS = {
  SPY: [325, 1, 0, 0],
  AAPL: [75, 1.15, 0.2, 0.07],
  MSFT: [160, 1.1, 0.18, 0.06],
  NVDA: [6, 1.7, 0.38, 0.3],
  GOOGL: [68, 1.1, 0.22, 0.06],
  AMZN: [95, 1.2, 0.26, 0.02],
  META: [210, 1.25, 0.32, 0.05],
  TSLA: [29, 1.8, 0.48, 0.18],
  AMD: [49, 1.7, 0.4, 0.02],
  NFLX: [330, 1.2, 0.34, 0.08],
  JPM: [140, 1.05, 0.2, 0],
  V: [190, 0.95, 0.16, -0.02],
  COST: [292, 0.8, 0.17, 0.09],
  KO: [55, 0.55, 0.13, -0.02],
  DIS: [146, 1.1, 0.26, -0.13],
  'BRK.B': [227, 0.8, 0.12, 0.03],
};

const MKT_DRIFT = 0.11;
const MKT_VOL = 0.155;

// Seeded standard-normal generator (FNV-1a hash -> mulberry32 -> Box-Muller).
export function rng(seedStr) {
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  const uniform = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(uniform() || 1e-12)) * Math.cos(2 * Math.PI * uniform());
}

// Weekdays from start to end inclusive. Market holidays are not skipped.
export function tradingDays(start, end) {
  const out = [];
  const d = new Date(start + 'T00:00:00Z');
  for (;;) {
    const iso = d.toISOString().slice(0, 10);
    if (iso > end) break;
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(iso);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

// One shared market factor drives every ticker; each adds its own noise and drift.
export function buildPrices(n) {
  const marketZ = rng('market-v1');
  const market = new Float64Array(n);
  const sqrtYear = Math.sqrt(252);
  for (let i = 1; i < n; i++) market[i] = MKT_DRIFT / 252 + (MKT_VOL / sqrtYear) * marketZ();

  const prices = {};
  for (const ticker in TICKERS) {
    const [p0, beta, idio, alpha] = TICKERS[ticker];
    const z = rng('stock-v1-' + ticker);
    const arr = new Float64Array(n);
    let logPrice = Math.log(p0);
    arr[0] = p0;
    for (let i = 1; i < n; i++) {
      logPrice += beta * market[i] + alpha / 252 + (idio / sqrtYear) * z();
      arr[i] = Math.round(Math.exp(logPrice) * 100) / 100;
    }
    prices[ticker] = arr;
  }
  return prices;
}

// Index of the first trading day on or after `date`; -1 when outside the simulated range.
export function dayIndex(days, date, today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || date < days[0] || date > today) return -1;
  let lo = 0;
  let hi = days.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (days[mid] < date) lo = mid + 1;
    else hi = mid;
  }
  return Math.min(lo, days.length - 1);
}

export function localToday(now = new Date()) {
  const pad = (v) => String(v).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function createMarket(today = localToday()) {
  const days = tradingDays(START, today);
  const prices = buildPrices(days.length);
  return {
    days,
    prices,
    today,
    stocks: Object.keys(TICKERS).filter((t) => t !== BENCHMARK).sort(),
    closeOn(ticker, date) {
      const i = dayIndex(days, date, today);
      return i < 0 || !prices[ticker] ? null : prices[ticker][i];
    },
  };
}

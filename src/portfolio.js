import { BENCHMARK, dayIndex } from './market.js';

// Walk forward day by day: apply that day's trades, then value everything at that day's close.
// Whenever a trade spends $X on a stock, the shadow portfolio buys $X of SPY at that day's price.
//
// trades: [{ id, date, ticker, shares, price }]
// returns {
//   per:    { [tradeId]: { cost, now, vs } | null }   null = trade not counted
//   series: { first, n, you[], shadow[], invested[], count } | null
// }
export function compute(trades, market) {
  const { days, prices, today } = market;
  const valid = [];
  const per = {};

  for (const t of trades) {
    const idx = dayIndex(days, t.date, today);
    if (idx < 0 || !prices[t.ticker] || !(t.shares > 0) || !(t.price > 0)) {
      per[t.id] = null;
      continue;
    }
    valid.push({ t, idx, cost: t.shares * t.price });
  }
  if (!valid.length) return { per, series: null };

  valid.sort((a, b) => a.idx - b.idx);
  const first = valid[0].idx;
  const last = days.length - 1;
  const n = last - first + 1;
  const bench = prices[BENCHMARK];
  const you = new Array(n);
  const shadow = new Array(n);
  const invested = new Array(n);
  const holdings = {};
  let k = 0;
  let totalInvested = 0;
  let benchShares = 0;

  for (let i = first; i <= last; i++) {
    while (k < valid.length && valid[k].idx === i) {
      const { t, cost } = valid[k++];
      holdings[t.ticker] = (holdings[t.ticker] || 0) + t.shares;
      totalInvested += cost;
      benchShares += cost / bench[i];
    }
    let value = 0;
    for (const ticker in holdings) value += holdings[ticker] * prices[ticker][i];
    you[i - first] = value;
    shadow[i - first] = benchShares * bench[i];
    invested[i - first] = totalInvested;
  }

  for (const { t, idx, cost } of valid) {
    const now = t.shares * prices[t.ticker][last];
    per[t.id] = { cost, now, vs: now - (cost / bench[idx]) * bench[last] };
  }
  return { per, series: { first, n, you, shadow, invested, count: valid.length } };
}

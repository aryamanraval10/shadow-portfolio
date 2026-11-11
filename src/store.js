// Trades persist in localStorage. Every read and write is guarded so the app
// still works in a private window or with storage blocked.

const KEY = 'shadow-portfolio-v1';
let nextId = 1;

export const newId = () => nextId++;

const EXAMPLES = [
  ['2025-03-14', 'AAPL', 10],
  ['2025-05-02', 'NVDA', 15],
  ['2025-07-21', 'MSFT', 4],
  ['2025-10-09', 'COST', 2],
  ['2026-01-15', 'AMZN', 8],
  ['2026-04-06', 'TSLA', 5],
  ['2026-07-13', 'JPM', 6],
];

export function exampleTrades(market) {
  return EXAMPLES.filter(([date]) => date <= market.today).map(([date, ticker, shares]) => ({
    id: newId(),
    date,
    ticker,
    shares,
    price: market.closeOn(ticker, date),
    auto: true,
  }));
}

// Returns { trades, example }. First visit (or unreadable storage) starts with marked examples.
export function load(market) {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    if (raw && Array.isArray(raw.trades)) {
      return {
        example: !!raw.example,
        trades: raw.trades.map((t) => ({
          id: newId(),
          date: String(t.date || ''),
          ticker: String(t.ticker || ''),
          shares: +t.shares || 0,
          price: +t.price || 0,
          auto: !!t.auto,
        })),
      };
    }
  } catch (e) {}
  return { trades: exampleTrades(market), example: true };
}

export function save(state) {
  try {
    const trades = state.trades.map(({ date, ticker, shares, price, auto }) => ({ date, ticker, shares, price, auto }));
    localStorage.setItem(KEY, JSON.stringify({ example: state.example, trades }));
  } catch (e) {}
}

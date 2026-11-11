import { createMarket } from './market.js';
import { compute } from './portfolio.js';
import { createChart } from './chart.js';
import { load, save, newId } from './store.js';
import { dateFmt, pct, signed, usd0, usd2 } from './format.js';

const $ = (id) => document.getElementById(id);
const market = createMarket();
const state = load(market);
const chart = createChart({
  svg: $('chart'),
  tip: $('tip'),
  wrap: $('chart-wrap'),
  empty: $('chart-empty'),
  days: market.days,
});

const LEDGER_NOTE =
  "New rows fill in that day's simulated close. Type over it with the price you actually paid. Weekend dates count on the next trading day.";
const longDate = (iso) => dateFmt(iso, { month: 'short', day: 'numeric', year: 'numeric' });

// ---------- rendering ----------
function rowHtml(t) {
  const opts = market.stocks.map((s) => `<option${s === t.ticker ? ' selected' : ''}>${s}</option>`).join('');
  return `<tr data-id="${t.id}">
    <td class="c-date"><input type="date" id="d-${t.id}" data-f="date" aria-label="Trade date" min="${market.days[0]}" max="${market.today}" value="${t.date}"></td>
    <td class="c-tk"><select id="k-${t.id}" data-f="ticker" aria-label="Ticker">${opts}</select></td>
    <td class="c-sh"><input type="number" id="s-${t.id}" data-f="shares" aria-label="Shares" min="0" step="any" inputmode="decimal" value="${t.shares || ''}"></td>
    <td class="c-pr"><input type="number" id="p-${t.id}" data-f="price" aria-label="Price paid per share" min="0" step="0.01" inputmode="decimal" value="${t.price || ''}"></td>
    <td class="num" data-c="cost"></td><td class="num" data-c="now"></td><td class="num" data-c="vs"></td>
    <td><button type="button" class="del" data-del aria-label="Delete this trade" title="Delete this trade">×</button></td>
  </tr>`;
}

function renderRows() {
  $('rows').innerHTML = state.trades.map(rowHtml).join('');
}

function setVs(el, v) {
  el.textContent = signed(v);
  el.className = 'num ' + (v < 0 ? 'down' : 'up');
}

// Recalculate everything and update the derived cells, tiles and chart.
// Inputs are left alone so typing never loses focus.
function refresh() {
  const { per, series } = compute(state.trades, market);
  let cost = 0, worth = 0, vs = 0, notCounted = 0;

  for (const tr of $('rows').children) {
    const p = per[tr.dataset.id];
    const cell = (f) => tr.querySelector(`[data-c="${f}"]`);
    tr.classList.toggle('bad', !p);
    if (p) {
      cell('cost').textContent = usd2.format(p.cost);
      cell('now').textContent = usd2.format(p.now);
      setVs(cell('vs'), p.vs);
      cost += p.cost;
      worth += p.now;
      vs += p.vs;
    } else {
      notCounted++;
      cell('cost').textContent = '—';
      cell('now').textContent = '—';
      cell('vs').textContent = 'not counted';
      cell('vs').className = 'num';
    }
  }

  $('ledger-note').textContent = notCounted
    ? `Rows marked "not counted" need a date from ${longDate(market.days[0])} to today, plus shares and a price above zero.`
    : LEDGER_NOTE;
  $('example-banner').hidden = !state.example || !state.trades.length;

  if (!series) {
    for (const id of ['s-inv', 's-you', 's-spy', 's-diff', 'f-cost', 'f-now', 'f-vs']) $(id).textContent = '—';
    for (const id of ['s-inv-sub', 's-you-sub', 's-spy-sub', 's-diff-sub']) {
      $(id).textContent = ' ';
      $(id).className = 's';
    }
    $('f-vs').className = 'num';
    $('verdict').textContent = 'Log a trade to start the race.';
  } else {
    const L = series.n - 1;
    const inv = series.invested[L];
    const you = series.you[L];
    const shadow = series.shadow[L];
    const d = you - shadow;
    const even = Math.abs(d) < 0.5;
    const pts = Math.abs((d / inv) * 100).toFixed(1);

    $('s-inv').textContent = usd0.format(inv);
    $('s-inv-sub').textContent = `${series.count} ${series.count === 1 ? 'buy' : 'buys'} since ${longDate(market.days[series.first])}`;
    $('s-you').textContent = usd0.format(you);
    $('s-you-sub').textContent = pct(you / inv - 1) + ' on money in';
    $('s-spy').textContent = usd0.format(shadow);
    $('s-spy-sub').textContent = pct(shadow / inv - 1) + ' on money in';
    $('s-diff').textContent = signed(d);
    $('s-diff-sub').textContent = even ? 'Level with SPY' : d > 0 ? `▲ Ahead of SPY by ${pts} pts` : `▼ Behind SPY by ${pts} pts`;
    $('s-diff-sub').className = 's ' + (even ? '' : d > 0 ? 'up' : 'down');
    $('verdict').textContent = even
      ? 'You are dead even with the S&P 500.'
      : d > 0
        ? `You are beating the S&P 500 by ${usd0.format(d)}.`
        : `The S&P 500 is beating you by ${usd0.format(-d)}.`;
    $('f-cost').textContent = usd2.format(cost);
    $('f-now').textContent = usd2.format(worth);
    setVs($('f-vs'), vs);
  }

  chart.draw(series);
}

// ---------- editing ----------
function changed() {
  state.example = false;
  save(state);
  refresh();
}

function onEdit(e) {
  const field = e.target.dataset.f;
  if (!field) return;
  const tr = e.target.closest('tr');
  const t = state.trades.find((x) => x.id === +tr.dataset.id);
  if (!t) return;

  if (field === 'shares' || field === 'price') {
    t[field] = parseFloat(e.target.value) || 0;
    if (field === 'price') t.auto = false;
  } else {
    t[field] = e.target.value;
    // keep following the simulated close until the user types their own price
    if (t.auto || !t.price) {
      const close = market.closeOn(t.ticker, t.date);
      if (close != null) {
        t.price = close;
        t.auto = true;
        tr.querySelector('[data-f="price"]').value = close;
      }
    }
  }
  changed();
}

function clearAll() {
  state.trades = [];
  renderRows();
  $('clear-confirm').hidden = true;
  $('clear').hidden = false;
  changed();
}

$('rows').addEventListener('input', onEdit);
$('rows').addEventListener('change', onEdit);
$('rows').addEventListener('click', (e) => {
  if (!e.target.closest('[data-del]')) return;
  const tr = e.target.closest('tr');
  state.trades = state.trades.filter((x) => x.id !== +tr.dataset.id);
  tr.remove();
  changed();
});
$('add').addEventListener('click', () => {
  const date = market.days[market.days.length - 1];
  const t = { id: newId(), date, ticker: 'AAPL', shares: 1, price: market.closeOn('AAPL', date), auto: true };
  state.trades.push(t);
  $('rows').insertAdjacentHTML('beforeend', rowHtml(t));
  changed();
  $('d-' + t.id).focus();
});
$('clear').addEventListener('click', () => {
  if (!state.trades.length) return;
  $('clear-confirm').hidden = false;
  $('clear').hidden = true;
});
$('clear-no').addEventListener('click', () => {
  $('clear-confirm').hidden = true;
  $('clear').hidden = false;
});
$('clear-yes').addEventListener('click', clearAll);
$('example-clear').addEventListener('click', clearAll);

renderRows();
refresh();

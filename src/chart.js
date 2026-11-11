import { axisMoney, dateFmt, niceStep, signed, usd0 } from './format.js';

// SVG line chart: your portfolio, the SPY shadow, and a dashed step line for money invested.
// createChart() wires hover, keyboard and resize once; call draw(series) whenever the data changes.
export function createChart({ svg, tip, wrap, empty, days }) {
  let series = null;
  let geo = null;
  let hoverI = null;
  const el = (id) => svg.querySelector('#' + id);

  function draw(next) {
    if (next !== undefined) {
      series = next;
      hoverI = null;
    }
    const s = series;
    svg.toggleAttribute('hidden', !s);
    empty.hidden = !!s;
    tip.hidden = true;
    if (!s) {
      geo = null;
      return;
    }

    const W = Math.max(280, wrap.clientWidth);
    const narrow = W < 520;
    const H = narrow ? 260 : 340;
    const ml = 48, mr = 66, mt = 12, mb = 26;
    const pw = W - ml - mr;
    const ph = H - mt - mb;
    const n = s.n;

    let lo = Infinity;
    let hi = -Infinity;
    for (const arr of [s.you, s.shadow, s.invested]) {
      for (const v of arr) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    if (hi - lo < 1) {
      lo -= 1;
      hi += 1;
    }
    const step = niceStep(hi - lo, narrow ? 3 : 4);
    const y0 = Math.max(0, Math.floor(lo / step) * step);
    const y1 = Math.ceil(hi / step) * step;
    const X = (i) => ml + (n === 1 ? pw / 2 : (i / (n - 1)) * pw);
    const Y = (v) => mt + ph - ((v - y0) / (y1 - y0)) * ph;

    let h = '';
    for (let v = y0; v <= y1 + step / 2; v += step) {
      h += `<line class="${v === y0 ? 'base' : 'grid'}" x1="${ml}" x2="${ml + pw}" y1="${Y(v)}" y2="${Y(v)}"/>`;
      h += `<text x="${ml - 8}" y="${Y(v) + 4}" text-anchor="end">${axisMoney(v, step)}</text>`;
    }

    // x ticks: month starts, thinned to fit; plain days for short spans
    const ticks = [];
    const maxTicks = narrow ? 4 : 7;
    if (n < 45) {
      const every = Math.max(1, Math.ceil(n / (maxTicks - 1)));
      for (let i = 0; i < n; i += every) ticks.push([i, dateFmt(days[s.first + i], { month: 'short', day: 'numeric' })]);
    } else {
      const months = [];
      for (let i = 1; i < n; i++) {
        if (days[s.first + i].slice(0, 7) !== days[s.first + i - 1].slice(0, 7)) months.push(i);
      }
      const every = Math.ceil(months.length / maxTicks);
      for (let j = 0; j < months.length; j += every) {
        const iso = days[s.first + months[j]];
        ticks.push([months[j], dateFmt(iso, { month: 'short' }) + ' ’' + iso.slice(2, 4)]);
      }
    }
    for (const [i, label] of ticks) h += `<text x="${X(i)}" y="${H - 7}" text-anchor="middle">${label}</text>`;

    const line = (arr) => arr.map((v, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1)).join('');
    let stepPath = '';
    s.invested.forEach((v, i) => {
      if (!i) stepPath += `M${X(0).toFixed(1)} ${Y(v).toFixed(1)}`;
      else stepPath += `H${X(i).toFixed(1)}` + (v !== s.invested[i - 1] ? `V${Y(v).toFixed(1)}` : '');
    });
    h += `<path class="l inv" d="${stepPath}"/><path class="l spy" d="${line(s.shadow)}"/><path class="l you" d="${line(s.you)}"/>`;

    // end points and direct labels, nudged apart so they never overlap
    const L = n - 1;
    const ends = [
      ['you', 'You', s.you[L]],
      ['spy', 'SPY', s.shadow[L]],
      ['inv', 'Invested', s.invested[L]],
    ].map(([c, name, v]) => ({ c, name, y: Y(v), ly: Y(v) }));
    ends.sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) ends[i].ly = Math.max(ends[i].ly, ends[i - 1].ly + 14);
    if (ends[ends.length - 1].ly > mt + ph) {
      for (let i = ends.length - 1; i >= 0; i--) {
        ends[i].ly = Math.min(ends[i].ly, mt + ph - (ends.length - 1 - i) * 14);
      }
    }
    for (const e of ends) {
      if (e.c !== 'inv') h += `<circle class="dot ${e.c}" cx="${X(L)}" cy="${e.y}" r="4.5"/>`;
      h += `<text class="end" x="${X(L) + 9}" y="${e.ly + 4}">${e.name}</text>`;
    }

    h += `<g id="hover" visibility="hidden"><line class="cross" id="hx" y1="${mt}" y2="${mt + ph}"/>`;
    h += `<circle class="dot inv" id="h-inv" r="4"/><circle class="dot spy" id="h-spy" r="4.5"/><circle class="dot you" id="h-you" r="4.5"/></g>`;

    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('height', H);
    svg.innerHTML = h;
    geo = { W, ml, pw, n, X, Y };
    if (hoverI != null) showHover(Math.min(hoverI, n - 1));
  }

  function showHover(i) {
    const s = series;
    if (!s || !geo) return;
    hoverI = i;
    const x = geo.X(i);
    const put = (id, v) => {
      const c = el(id);
      c.setAttribute('cx', x);
      c.setAttribute('cy', geo.Y(v));
    };
    el('hover').setAttribute('visibility', 'visible');
    el('hx').setAttribute('x1', x);
    el('hx').setAttribute('x2', x);
    put('h-you', s.you[i]);
    put('h-spy', s.shadow[i]);
    put('h-inv', s.invested[i]);

    const d = s.you[i] - s.shadow[i];
    const day = dateFmt(days[s.first + i], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    tip.innerHTML = `<div class="d">${day}</div>
      <div class="r"><span class="sw you"></span>Your portfolio<b>${usd0.format(s.you[i])}</b></div>
      <div class="r"><span class="sw spy"></span>SPY shadow<b>${usd0.format(s.shadow[i])}</b></div>
      <div class="r"><span class="sw inv"></span>Money invested<b>${usd0.format(s.invested[i])}</b></div>
      <div class="r gap">You vs. SPY<b class="${d < 0 ? 'down' : 'up'}">${signed(d)}</b></div>`;
    tip.hidden = false;
    const tw = tip.offsetWidth;
    const left = x + 14 + tw > geo.W ? x - 14 - tw : x + 14;
    tip.style.left = Math.max(0, Math.min(geo.W - tw, left)) + 'px';
  }

  function hideHover() {
    hoverI = null;
    tip.hidden = true;
    const g = el('hover');
    if (g) g.setAttribute('visibility', 'hidden');
  }

  const clampIndex = (i) => Math.max(0, Math.min(geo.n - 1, i));

  svg.addEventListener('pointermove', (e) => {
    if (!geo) return;
    const r = svg.getBoundingClientRect();
    const x = ((e.clientX - r.left) * geo.W) / r.width;
    showHover(clampIndex(Math.round(((x - geo.ml) / geo.pw) * (geo.n - 1))));
  });
  svg.addEventListener('pointerleave', hideHover);
  svg.addEventListener('blur', hideHover);
  svg.addEventListener('keydown', (e) => {
    if (!geo || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    const jump = e.shiftKey ? 20 : 1;
    const dir = e.key === 'ArrowLeft' ? -1 : 1;
    showHover(clampIndex(hoverI == null ? geo.n - 1 : hoverI + dir * jump));
  });
  if (window.ResizeObserver) {
    new ResizeObserver(() => {
      if (!geo || Math.abs(geo.W - wrap.clientWidth) > 1) draw();
    }).observe(wrap);
  }

  return { draw };
}

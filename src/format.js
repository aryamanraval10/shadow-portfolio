export const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
export const usd2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export const signed = (v, f = usd0) => (v < 0 ? '−' : '+') + f.format(Math.abs(v));
export const pct = (v) => (v < 0 ? '−' : '+') + Math.abs(v * 100).toFixed(1) + '%';

// Dates are ISO strings; format them in UTC so the day never shifts with the viewer's timezone.
export const dateFmt = (iso, opts) =>
  new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });

export const axisMoney = (v, step) =>
  v >= 1e6
    ? '$' + (v / 1e6).toFixed(step < 1e5 ? 2 : 1) + 'M'
    : v >= 1000
      ? '$' + (v / 1000).toFixed(step % 1000 ? 1 : 0) + 'k'
      : '$' + Math.round(v);

export function niceStep(range, target) {
  const raw = range / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / mag;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
}

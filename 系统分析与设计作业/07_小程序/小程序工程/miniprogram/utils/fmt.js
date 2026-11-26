function money(n) {
  const v = Number(n || 0);
  return v.toFixed(2);
}

function moneyShort(n) {
  const v = Number(n || 0);
  if (Math.abs(v) >= 10000) return (v / 10000).toFixed(1) + ' 万';
  return v.toFixed(0);
}

function dateTime(s) {
  if (!s) return '—';
  return String(s).replace('T', ' ').slice(0, 16);
}

function pct(n) {
  return (Number(n || 0)).toFixed(1) + '%';
}

module.exports = { money, moneyShort, dateTime, pct };

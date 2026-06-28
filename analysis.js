const ASSET_VERSION = '20260628-6';
const withVersion = (path) => `${path}?v=${ASSET_VERSION}`;
const STRATEGY_META = {
  ai_analyst: { name: 'AI Analyst', color: '#ff6b6b' },
  quant_learning: { name: 'Quant AI', color: '#4ecdc4' },
  etf_aggressive: { name: 'DCA Aggressive', color: '#a78bfa' },
  etf_balanced: { name: 'DCA Balanced', color: '#c4b5fd' },
  etf_conservative: { name: 'DCA Conservative', color: '#ddd6fe' },
  spy: { name: 'S&P 500', color: '#fbbf24' },
};

function fmtMoney(v) {
  if (v == null || isNaN(v)) return '-';
  return '$' + Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
}
function fmtPct(v) {
  if (v == null || isNaN(v)) return '-';
  const sign = v >= 0 ? '+' : '';
  return `${sign}${(v * 100).toFixed(2)}%`;
}
function latestBySource(rows) {
  const latest = {};
  rows.forEach(row => {
    if (!latest[row.source] || row.date > latest[row.source].date) latest[row.source] = row;
  });
  return latest;
}

async function loadData() {
  const [equity, holdings, signals] = await Promise.all([
    fetch(withVersion('data/equity_curve.json')).then(r => r.json()),
    fetch(withVersion('data/holdings.json')).then(r => r.json()),
    fetch(withVersion('data/signals.json')).then(r => r.json()),
  ]);
  return { equity, holdings, signals };
}

function renderPerformance(equity) {
  const el = document.getElementById('performanceGrid');
  const latest = latestBySource(equity);
  const rows = Object.entries(latest).sort((a, b) => b[1].total_value - a[1].total_value);
  el.innerHTML = rows.map(([source, row]) => {
    const meta = STRATEGY_META[source] || { name: source, color: '#888' };
    const color = row.return_pct >= 0 ? '#4ecdc4' : '#ffa502';
    return `<div class="card p-5">
      <div class="flex items-center gap-2 mb-4"><span class="w-3 h-3 rounded-full" style="background:${meta.color}"></span><h2 class="font-semibold">${meta.name}</h2></div>
      <div class="metric"><span>Total Value</span><strong>${fmtMoney(row.total_value)}</strong></div>
      <div class="metric"><span>Stock/ETF Value</span><strong>${fmtMoney(row.positions_value)}</strong></div>
      <div class="metric"><span>Cash</span><strong>${fmtMoney(row.cash)}</strong></div>
      <div class="metric"><span>Return</span><strong style="color:${color}">${fmtPct(row.return_pct)}</strong></div>
      <p class="text-xs text-[var(--muted)] mt-3">Latest data: ${row.date}</p>
    </div>`;
  }).join('');
}

function renderHoldings(holdings) {
  const body = document.getElementById('holdingsSummary');
  if (!holdings.length) { body.innerHTML = '<tr><td colspan="5">No holdings data.</td></tr>'; return; }
  const latestDate = [...new Set(holdings.map(h => h.date))].sort().pop();
  const latest = holdings.filter(h => h.date === latestDate).sort((a, b) => b.value - a.value).slice(0, 20);
  body.innerHTML = latest.map(h => {
    const meta = STRATEGY_META[h.source] || { name: h.source, color: '#888' };
    const color = h.return_pct >= 0 ? '#4ecdc4' : '#ffa502';
    return `<tr>
      <td>${h.date}</td>
      <td style="color:${meta.color}">${meta.name}</td>
      <td>${h.ticker}</td>
      <td>${fmtMoney(h.value)}</td>
      <td style="color:${color}">${fmtPct(h.return_pct)}</td>
    </tr>`;
  }).join('');
}

function renderSignals(signals) {
  const body = document.getElementById('signalSummary');
  if (!signals.length) { body.innerHTML = '<tr><td colspan="6">No signals yet.</td></tr>'; return; }
  const latest = [...signals].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20);
  body.innerHTML = latest.map(s => {
    const meta = STRATEGY_META[s.source] || { name: s.source, color: '#888' };
    const badge = s.action === 'buy' ? 'badge-buy' : s.action === 'sell' ? 'badge-sell' : 'badge-hold';
    return `<tr>
      <td>${s.date}</td>
      <td style="color:${meta.color}">${meta.name}</td>
      <td><span class="badge ${badge}">${s.action.toUpperCase()}</span></td>
      <td>${s.ticker}</td>
      <td>${fmtMoney(s.amount)}</td>
      <td class="reason-cell">${s.reason || ''}</td>
    </tr>`;
  }).join('');
}

document.addEventListener('DOMContentLoaded', async () => {
  try {
    const data = await loadData();
    renderPerformance(data.equity);
    renderHoldings(data.holdings);
    renderSignals(data.signals);
  } catch (err) {
    console.error(err);
    document.getElementById('performanceGrid').innerHTML = '<p class="text-[var(--muted)]">Analysis data failed to load.</p>';
  }
});

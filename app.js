// AI Trading Arena - Main JS
const ASSET_VERSION = '20260628-11';
const withVersion = (path) => `${path}?v=${ASSET_VERSION}`;
const STRATEGY_META = {
  ai_analyst:       { name: 'AI Analyst',       color: '#ff6b6b', desc: 'LLM-based market analysis & trading' },
  quant_learning:   { name: 'Quant AI',          color: '#4ecdc4', desc: 'ML multi-signal voting system' },
  etf_aggressive:   { name: 'DCA Aggressive',    color: '#a78bfa', desc: '42.5/42.5/15 VOO/VGT/SMH' },
  etf_balanced:     { name: 'DCA Balanced',      color: '#c4b5fd', desc: '50/40/10 VOO/VGT/SMH' },
  etf_conservative: { name: 'DCA Conservative',  color: '#ddd6fe', desc: '60/35/5 VOO/VGT/SMH' },
  spy:              { name: 'S&P 500',           color: '#fbbf24', desc: 'Buy-and-hold benchmark' },
};
const RANGE_DAYS = { all: null, '7': 7, '30': 30, '90': 90, '180': 180, '365': 365 };

async function loadData() {
  const results = await Promise.allSettled([
    fetch(withVersion('data/strategies.json')).then(r => r.json()),
    fetch(withVersion('data/signals.json')).then(r => r.json()),
    fetch(withVersion('data/equity_curve.json')).then(r => r.json()),
    fetch(withVersion('data/holdings.json')).then(r => r.json()),
  ]);
  const [strategies, signals, equity, holdings] = results.map(r => {
    if (r.status === 'fulfilled') return r.value;
    console.error('Fetch error:', r.reason);
    return [];
  });
  console.log('Loaded:', { strategies: strategies.length, signals: signals.length, equity: equity.length, holdings: holdings.length });
  return { strategies, signals, equity, holdings };
}

function fmtMoney(v) {
  if (v == null || isNaN(v)) return '-';
  return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function fmtPct(v) {
  if (v == null || isNaN(v)) return '-';
  const sign = v >= 0 ? '+' : '';
  return sign + (v * 100).toFixed(2) + '%';
}
function latestBySource(rows) {
  const bySource = {};
  rows.forEach(row => {
    if (!bySource[row.source] || row.date > bySource[row.source].date) bySource[row.source] = row;
  });
  return bySource;
}
function filterByRange(equityData, range) {
  if (range === 'all' || !RANGE_DAYS[range]) return equityData;
  const dates = equityData.map(d => d.date).sort();
  if (!dates.length) return equityData;
  const end = new Date(`${dates[dates.length - 1]}T00:00:00`);
  const cutoff = new Date(end);
  cutoff.setDate(cutoff.getDate() - RANGE_DAYS[range]);
  return equityData.filter(d => new Date(`${d.date}T00:00:00`) >= cutoff);
}

let equityChart = null;
let currentRange = 'all';

function renderEquityChart(equityData, range = currentRange) {
  const ctx = document.getElementById('equityChart');
  if (!ctx) { console.error('equityChart canvas not found'); return; }
  if (!equityData.length) { console.error('No equity data'); return; }
  if (typeof Chart === 'undefined') { console.error('Chart.js not loaded'); return; }

  const filtered = filterByRange(equityData, range);
  const bySource = {};
  filtered.forEach(d => { if (!bySource[d.source]) bySource[d.source] = []; bySource[d.source].push(d); });
  const allDates = [...new Set(filtered.map(d => d.date))].sort();
  const datasets = Object.entries(bySource).map(([source, rows]) => {
    const meta = STRATEGY_META[source] || { color: '#888', name: source };
    const dateMap = {};
    rows.forEach(r => { dateMap[r.date] = r.total_value; });
    return {
      label: meta.name,
      data: allDates.map(d => dateMap[d] ?? null),
      borderColor: meta.color,
      backgroundColor: meta.color + '20',
      borderWidth: 2, pointRadius: 3, pointHoverRadius: 6, tension: 0.3, spanGaps: true,
    };
  });

  if (equityChart) equityChart.destroy();
  equityChart = new Chart(ctx, {
    type: 'line',
    data: { labels: allDates, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'top', labels: { color: '#a0aec0', font: { size: 11 } } },
        tooltip: { backgroundColor: '#16213e', borderColor: '#233', borderWidth: 1,
          callbacks: { label: (c) => `${c.dataset.label}: ${fmtMoney(c.parsed.y)}` } },
      },
      scales: {
        x: { grid: { color: 'rgba(35,51,51,0.5)' }, ticks: { color: '#a0aec0', font: { size: 11 } } },
        y: { grid: { color: 'rgba(35,51,51,0.5)' }, ticks: { color: '#a0aec0', font: { size: 11 }, callback: (v) => '$' + (v/1000).toFixed(1) + 'k' } },
      },
    },
  });
}

function renderStrategyCards(equityData, signals) {
  const container = document.getElementById('strategyCards');
  if (!container) return;
  const latest = latestBySource(equityData);
  const signalCount = {};
  signals.forEach(s => { signalCount[s.source] = (signalCount[s.source] || 0) + 1; });
  const sourceKeys = Object.keys(latest).sort((a, b) => (STRATEGY_META[a]?.name || a).localeCompare(STRATEGY_META[b]?.name || b));
  if (!sourceKeys.length) { container.innerHTML = '<p style="color:#8892b0">No strategy data.</p>'; return; }
  container.innerHTML = sourceKeys.map(key => {
    const meta = STRATEGY_META[key] || { name: key, color: '#888', desc: key };
    const row = latest[key];
    const count = signalCount[key] || 0;
    const returnColor = row.return_pct >= 0 ? '#4ecdc4' : '#ffa502';
    return `
      <div class="strategy-card card p-5">
        <div class="flex items-center gap-2 mb-3">
          <span class="w-3 h-3 rounded-full inline-block" style="background:${meta.color}"></span>
          <span class="font-semibold text-sm">${meta.name}</span>
        </div>
        <p class="text-xs" style="color:#8892b0">${meta.desc}</p>
        <div style="margin-top:12px;display:grid;gap:6px">
          <div style="display:flex;justify-content:space-between;font-size:13px"><span style="color:#8892b0">Total Value</span><span>${fmtMoney(row.total_value)}</span></div>
          <div style="display:flex;justify-content:space-between;font-size:13px"><span style="color:#8892b0">Stock/ETF Value</span><span>${fmtMoney(row.positions_value)}</span></div>
          <div style="display:flex;justify-content:space-between;font-size:13px"><span style="color:#8892b0">Cash</span><span>${fmtMoney(row.cash)}</span></div>
          <div style="display:flex;justify-content:space-between;font-size:13px"><span style="color:#8892b0">Return</span><span style="color:${returnColor}">${fmtPct(row.return_pct)}</span></div>
          <div style="display:flex;justify-content:space-between;font-size:13px"><span style="color:#8892b0">Signals</span><span>${count}</span></div>
        </div>
      </div>`;
  }).join('');
}

function renderSignals(signals) {
  const container = document.getElementById('signalsList');
  if (!container) return;
  if (!signals.length) { container.innerHTML = '<p style="color:#8892b0;text-align:center;padding:20px">No signals yet.</p>'; return; }
  const sorted = [...signals].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20);
  const rows = sorted.map(s => {
    const meta = STRATEGY_META[s.source] || { name: s.source, color: '#888' };
    const badgeClass = s.action === 'buy' ? 'badge-buy' : s.action === 'sell' ? 'badge-sell' : 'badge-hold';
    return `<tr>
      <td style="color:#8892b0;white-space:nowrap">${s.date}</td>
      <td style="color:${meta.color};font-weight:500;white-space:nowrap">${meta.name}</td>
      <td><span class="badge ${badgeClass}">${s.action.toUpperCase()}</span></td>
      <td style="font-weight:600">${s.ticker}</td>
      <td>${fmtMoney(s.price)}</td>
      <td>${s.shares?.toFixed(2) || '-'}</td>
    </tr>`;
  }).join('');
  container.innerHTML = `<table>
    <thead><tr><th>Date</th><th>Strategy</th><th>Action</th><th>Ticker</th><th>Price</th><th>Shares</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

document.addEventListener('DOMContentLoaded', async function() {
  console.log('App starting...');
  const data = await loadData();
  renderEquityChart(data.equity, currentRange);
  renderStrategyCards(data.equity, data.signals);
  renderSignals(data.signals);
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentRange = btn.dataset.range;
      renderEquityChart(data.equity, currentRange);
    });
  });
  console.log('App done');
});

// AI Trading Arena - Main JS
const ASSET_VERSION = '20260628-3';
const withVersion = (path) => `${path}?v=${ASSET_VERSION}`;
const STRATEGY_META = {
  ai_analyst:       { name: 'AI Analyst',       color: '#ff6b6b', desc: 'LLM-based market analysis & trading' },
  quant_learning:   { name: 'Quant AI',          color: '#4ecdc4', desc: 'ML multi-signal voting system' },
  etf_aggressive:   { name: 'DCA Aggressive',    color: '#a78bfa', desc: '42.5/42.5/15 VOO/VGT/SMH' },
  etf_balanced:     { name: 'DCA Balanced',      color: '#c4b5fd', desc: '50/40/10 VOO/VGT/SMH' },
  etf_conservative: { name: 'DCA Conservative',  color: '#ddd6fe', desc: '60/35/5 VOO/VGT/SMH' },
  spy:              { name: 'S&P 500',           color: '#fbbf24', desc: 'Buy-and-hold benchmark' },
};

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
  if (v == null || isNaN(v)) return '—';
  return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function fmtPct(v) {
  if (v == null || isNaN(v)) return '—';
  const sign = v >= 0 ? '+' : '';
  return sign + (v * 100).toFixed(2) + '%';
}

function renderEquityChart(equityData) {
  const ctx = document.getElementById('equityChart');
  if (!ctx) { console.error('equityChart canvas not found'); return; }
  if (!equityData.length) { console.error('No equity data'); return; }
  if (typeof Chart === 'undefined') { console.error('Chart.js not loaded'); return; }
  
  const bySource = {};
  equityData.forEach(d => { if (!bySource[d.source]) bySource[d.source] = []; bySource[d.source].push(d); });
  const allDates = [...new Set(equityData.map(d => d.date))].sort();
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
  
  console.log('Rendering chart with', datasets.length, 'datasets and', allDates.length, 'dates');
  
  new Chart(ctx, {
    type: 'line',
    data: { labels: allDates, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { 
          display: true, position: 'top',
          labels: { color: '#a0aec0', font: { size: 11 } } 
        },
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
  const bySource = {};
  equityData.forEach(d => { if (!bySource[d.source]) bySource[d.source] = []; bySource[d.source].push(d); });
  const signalCount = {};
  signals.forEach(s => { if (!signalCount[s.source]) signalCount[s.source] = 0; signalCount[s.source]++; });
  const cards = Object.entries(STRATEGY_META).map(([key, meta]) => {
    const rows = bySource[key] || [];
    const latest = rows[rows.length - 1];
    const first = rows[0];
    const returnPct = latest && first ? (latest.total_value - first.total_value) / first.total_value : 0;
    const count = signalCount[key] || 0;
    return `
      <div class="strategy-card card p-5">
        <div class="flex items-center gap-2 mb-3">
          <span class="w-3 h-3 rounded-full inline-block" style="background:${meta.color}"></span>
          <span class="font-semibold text-sm">${meta.name}</span>
        </div>
        <p class="text-xs" style="color:#8892b0">${meta.desc}</p>
        <div style="margin-top:12px">
          <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px"><span style="color:#8892b0">Value</span><span>${fmtMoney(latest?.total_value)}</span></div>
          <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px"><span style="color:#8892b0">Return</span><span style="color:${returnPct >= 0 ? '#4ecdc4' : '#ffa502'}">${fmtPct(returnPct)}</span></div>
          <div style="display:flex;justify-content:space-between;font-size:13px"><span style="color:#8892b0">Signals</span><span>${count}</span></div>
        </div>
      </div>`;
  }).join('');
  container.innerHTML = cards;
}

function renderSignals(signals) {
  const container = document.getElementById('signalsList');
  if (!container) return;
  if (!signals.length) { container.innerHTML = '<p style="color:#8892b0;text-align:center;padding:20px">No signals yet.</p>'; return; }
  const sorted = [...signals].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20);
  container.innerHTML = sorted.map(s => {
    const meta = STRATEGY_META[s.source] || { name: s.source, color: '#888' };
    const badgeClass = s.action === 'buy' ? 'badge-buy' : s.action === 'sell' ? 'badge-sell' : 'badge-hold';
    return `
      <div class="signal-row" style="display:flex;align-items:center;justify-content:space-between;padding:8px;border-bottom:1px solid #233">
        <div style="display:flex;align-items:center;gap:12px">
          <span style="color:#8892b0;font-size:12px;width:80px">${s.date}</span>
          <span style="color:${meta.color};font-size:12px;font-weight:500">${meta.name}</span>
          <span class="badge ${badgeClass}">${s.action.toUpperCase()}</span>
          <span style="font-weight:500">${s.ticker}</span>
        </div>
        <div style="display:flex;gap:16px;color:#8892b0;font-size:12px">
          <span>${fmtMoney(s.price)}</span>
          <span>${s.shares?.toFixed(2) || '—'} sh</span>
        </div>
      </div>`;
  }).join('');
}

// Run after DOM is ready
document.addEventListener('DOMContentLoaded', async function() {
  console.log('App starting...');
  const data = await loadData();
  renderEquityChart(data.equity);
  renderStrategyCards(data.equity, data.signals);
  renderSignals(data.signals);
  console.log('App done');
});

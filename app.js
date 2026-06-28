// AI Trading Arena - Main JS
const STRATEGY_META = {
  ai_analyst:      { name: 'AI Analyst',      color: '#ff6b6b', desc: 'LLM-based market analysis' },
  quant_learning:  { name: 'Quant AI',         color: '#4ecdc4', desc: 'ML multi-signal voting system' },
  etf:             { name: 'DCA Portfolio',    color: '#a78bfa', desc: 'Dollar-cost averaging' },
  spy:             { name: 'S&P 500',          color: '#fbbf24', desc: 'Buy-and-hold benchmark' },
};

// Load all JSON data
async function loadData() {
  const [strategies, signals, equity, holdings] = await Promise.all([
    fetch('data/strategies.json').then(r => r.json()).catch(() => []),
    fetch('data/signals.json').then(r => r.json()).catch(() => []),
    fetch('data/equity_curve.json').then(r => r.json()).catch(() => []),
    fetch('data/holdings.json').then(r => r.json()).catch(() => []),
  ]);
  return { strategies, signals, equity, holdings };
}

// Format currency
function fmtMoney(v) {
  if (v == null || isNaN(v)) return '—';
  return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

// Format percent
function fmtPct(v) {
  if (v == null || isNaN(v)) return '—';
  const sign = v >= 0 ? '+' : '';
  return sign + (v * 100).toFixed(2) + '%';
}

// Render equity chart
function renderEquityChart(equityData) {
  const ctx = document.getElementById('equityChart');
  if (!ctx) return;

  // Group by source
  const bySource = {};
  equityData.forEach(d => {
    if (!bySource[d.source]) bySource[d.source] = [];
    bySource[d.source].push(d);
  });

  // Get all unique dates sorted
  const allDates = [...new Set(equityData.map(d => d.date))].sort();

  const datasets = Object.entries(bySource).map(([source, rows]) => {
    const meta = STRATEGY_META[source] || { color: '#888', name: source };
    const dateMap = {};
    rows.forEach(r => { dateMap[r.date] = r.total_value; });
    return {
      label: meta.name,
      data: allDates.map(d => dateMap[d] || null),
      borderColor: meta.color,
      backgroundColor: meta.color + '20',
      borderWidth: 2,
      pointRadius: 2,
      pointHoverRadius: 5,
      tension: 0.3,
      spanGaps: true,
    };
  });

  new Chart(ctx, {
    type: 'line',
    data: { labels: allDates, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#16213e',
          borderColor: '#233',
          borderWidth: 1,
          callbacks: { label: (ctx) => `${ctx.dataset.label}: ${fmtMoney(ctx.parsed.y)}` },
        },
      },
      scales: {
        x: {
          grid: { color: 'rgba(35,51,51,0.5)' },
          ticks: { color: '#8892b0', font: { size: 11 } },
        },
        y: {
          grid: { color: 'rgba(35,51,51,0.5)' },
          ticks: { color: '#8892b0', font: { size: 11 }, callback: (v) => '$' + (v/1000).toFixed(1) + 'k' },
        },
      },
    },
  });
}

// Render strategy cards
function renderStrategyCards(equityData, signals) {
  const container = document.getElementById('strategyCards');
  if (!container) return;

  const bySource = {};
  equityData.forEach(d => {
    if (!bySource[d.source]) bySource[d.source] = [];
    bySource[d.source].push(d);
  });

  const signalCount = {};
  signals.forEach(s => {
    if (!signalCount[s.source]) signalCount[s.source] = { total: 0, wins: 0 };
    signalCount[s.source].total++;
  });

  const cards = Object.entries(STRATEGY_META).map(([key, meta]) => {
    const rows = bySource[key] || [];
    const latest = rows[rows.length - 1];
    const first = rows[0];
    const returnPct = latest && first ? (latest.total_value - first.total_value) / first.total_value : 0;
    const count = signalCount[key]?.total || 0;

    return `
      <div class="strategy-card card p-5">
        <div class="flex items-center gap-2 mb-3">
          <span class="w-3 h-3 rounded-full" style="background:${meta.color}"></span>
          <span class="font-semibold">${meta.name}</span>
        </div>
        <p class="text-xs text-[var(--muted)] mb-4">${meta.desc}</p>
        <div class="space-y-2">
          <div class="flex justify-between text-sm">
            <span class="text-[var(--muted)]">Total Value</span>
            <span class="font-medium">${fmtMoney(latest?.total_value)}</span>
          </div>
          <div class="flex justify-between text-sm">
            <span class="text-[var(--muted)]">Return</span>
            <span class="font-medium" style="color:${returnPct >= 0 ? 'var(--profit)' : 'var(--loss)'}">${fmtPct(returnPct)}</span>
          </div>
          <div class="flex justify-between text-sm">
            <span class="text-[var(--muted)]">Signals</span>
            <span class="font-medium">${count}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = cards;
}

// Render signals list
function renderSignals(signals) {
  const container = document.getElementById('signalsList');
  if (!container) return;

  const sorted = [...signals].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20);

  container.innerHTML = sorted.map(s => {
    const meta = STRATEGY_META[s.source] || { name: s.source, color: '#888' };
    const badgeClass = s.action === 'buy' ? 'badge-buy' : s.action === 'sell' ? 'badge-sell' : 'badge-hold';
    return `
      <div class="signal-row flex items-center justify-between py-2 px-2">
        <div class="flex items-center gap-3">
          <span class="text-xs text-[var(--muted)] w-20">${s.date}</span>
          <span class="text-xs font-medium" style="color:${meta.color}">${meta.name}</span>
          <span class="badge ${badgeClass}">${s.action.toUpperCase()}</span>
          <span class="text-sm font-medium">${s.ticker}</span>
        </div>
        <div class="flex items-center gap-4 text-xs text-[var(--muted)]">
          <span>${fmtMoney(s.price)}</span>
          <span>${s.shares?.toFixed(2) || '—'} shares</span>
        </div>
      </div>
    `;
  }).join('');
}

// Init
(async function() {
  const data = await loadData();
  renderEquityChart(data.equity);
  renderStrategyCards(data.equity, data.signals);
  renderSignals(data.signals);
})();

// AI Trading Arena - Trading Page JS
const STRATEGY_META = {
  ai_analyst:       { name: 'AI Analyst',       color: '#ff6b6b' },
  quant_learning:   { name: 'Quant AI',          color: '#4ecdc4' },
  etf_aggressive:   { name: 'DCA Aggressive',    color: '#a78bfa' },
  etf_balanced:     { name: 'DCA Balanced',      color: '#c4b5fd' },
  etf_conservative: { name: 'DCA Conservative',  color: '#ddd6fe' },
  spy:              { name: 'S&P 500',           color: '#fbbf24' },
};

const BASE = './';

async function loadData() {
  const [signals, equity, holdings] = await Promise.all([
    fetch(BASE + 'data/signals.json').then(r => r.json()).catch(() => []),
    fetch(BASE + 'data/equity_curve.json').then(r => r.json()).catch(() => []),
    fetch(BASE + 'data/holdings.json').then(r => r.json()).catch(() => []),
  ]);
  return { signals, equity, holdings };
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

let equityChart = null;
let currentRange = 'all';

function renderEquityChart(equityData, range) {
  const ctx = document.getElementById('equityChart');
  if (!ctx || !equityData.length) return;
  
  let filtered = equityData;
  if (range !== 'all') {
    const days = parseInt(range);
    const dates = [...new Set(equityData.map(d => d.date))].sort();
    const cutoff = dates.slice(-days);
    filtered = equityData.filter(d => cutoff.includes(d.date));
  }
  
  const bySource = {};
  filtered.forEach(d => { if (!bySource[d.source]) bySource[d.source] = []; bySource[d.source].push(d); });
  const allDates = [...new Set(filtered.map(d => d.date))].sort();
  const datasets = Object.entries(bySource).map(([source, rows]) => {
    const meta = STRATEGY_META[source] || { color: '#888', name: source };
    const dateMap = {};
    rows.forEach(r => { dateMap[r.date] = r.total_value; });
    return {
      label: meta.name, data: allDates.map(d => dateMap[d] || null),
      borderColor: meta.color, backgroundColor: meta.color + '20',
      borderWidth: 2, pointRadius: 2, pointHoverRadius: 5, tension: 0.3, spanGaps: true,
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
        legend: { display: false },
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

function renderHoldings(holdings) {
  const tbody = document.getElementById('holdingsBody');
  if (!tbody) return;
  const sorted = [...holdings].sort((a, b) => b.date.localeCompare(a.date) || a.source.localeCompare(b.source));
  tbody.innerHTML = sorted.map(h => {
    const meta = STRATEGY_META[h.source] || { name: h.source, color: '#888' };
    const plColor = h.profit_loss >= 0 ? '#4ecdc4' : '#ffa502';
    return `<tr>
      <td style="color:${meta.color}">${meta.name}</td>
      <td>${h.ticker}</td>
      <td>${h.shares?.toFixed(4) || '—'}</td>
      <td>${fmtMoney(h.cost_price)}</td>
      <td>${fmtMoney(h.current_price)}</td>
      <td>${fmtMoney(h.value)}</td>
      <td style="color:${plColor}">${fmtMoney(h.profit_loss)}</td>
      <td style="color:${plColor}">${fmtPct(h.return_pct)}</td>
    </tr>`;
  }).join('');
}

function renderSignals(signals) {
  const tbody = document.getElementById('signalsBody');
  if (!tbody) return;
  const sorted = [...signals].sort((a, b) => b.date.localeCompare(a.date));
  tbody.innerHTML = sorted.map(s => {
    const meta = STRATEGY_META[s.source] || { name: s.source, color: '#888' };
    const badgeClass = s.action === 'buy' ? 'badge-buy' : s.action === 'sell' ? 'badge-sell' : 'badge-hold';
    return `<tr>
      <td>${s.date}</td>
      <td style="color:${meta.color}">${meta.name}</td>
      <td><span class="badge ${badgeClass}">${s.action.toUpperCase()}</span></td>
      <td>${s.ticker}</td>
      <td>${fmtMoney(s.price)}</td>
      <td>${s.shares?.toFixed(4) || '—'}</td>
      <td>${fmtMoney(s.amount)}</td>
      <td class="text-xs text-[#8892b0]">${(s.reason || '').substring(0, 60)}</td>
    </tr>`;
  }).join('');
}

document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentRange = btn.dataset.range;
    loadData().then(data => renderEquityChart(data.equity, currentRange));
  });
});

(async function() {
  const data = await loadData();
  renderEquityChart(data.equity, currentRange);
  renderHoldings(data.holdings);
  renderSignals(data.signals);
})();

// AI Trading Arena - Trading Page JS
const STRATEGY_META = {
  ai_analyst:     { name: 'AI Analyst',    color: '#ff6b6b' },
  quant_learning: { name: 'Quant AI',       color: '#4ecdc4' },
  etf:            { name: 'DCA Portfolio',  color: '#a78bfa' },
  spy:            { name: 'S&P 500',        color: '#fbbf24' },
};

async function loadData() {
  const [signals, equity, holdings] = await Promise.all([
    fetch('data/signals.json').then(r => r.json()).catch(() => []),
    fetch('data/equity_curve.json').then(r => r.json()).catch(() => []),
    fetch('data/holdings.json').then(r => r.json()).catch(() => []),
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
  if (!ctx) return;

  let filtered = equityData;
  if (range !== 'all') {
    const days = parseInt(range);
    const dates = [...new Set(equityData.map(d => d.date))].sort().slice(-days);
    const dateSet = new Set(dates);
    filtered = equityData.filter(d => dateSet.has(d.date));
  }

  const bySource = {};
  filtered.forEach(d => {
    if (!bySource[d.source]) bySource[d.source] = [];
    bySource[d.source].push(d);
  });

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
        legend: { display: true, labels: { color: '#8892b0', font: { size: 12 } } },
        tooltip: { backgroundColor: '#16213e', borderColor: '#233', borderWidth: 1,
          callbacks: { label: (c) => `${c.dataset.label}: ${fmtMoney(c.parsed.y)}` } },
      },
      scales: {
        x: { grid: { color: 'rgba(35,51,51,0.5)' }, ticks: { color: '#8892b0', font: { size: 11 } } },
        y: { grid: { color: 'rgba(35,51,51,0.5)' }, ticks: { color: '#8892b0', font: { size: 11 }, callback: (v) => '$' + (v/1000).toFixed(1) + 'k' } },
      },
    },
  });
}

function renderHoldings(holdings) {
  const tbody = document.getElementById('holdingsBody');
  if (!tbody) return;
  const sorted = [...holdings].sort((a, b) => b.date.localeCompare(a.date) || b.value - a.value);
  // Get latest date only
  const latestDate = sorted[0]?.date;
  const latest = sorted.filter(h => h.date === latestDate);
  tbody.innerHTML = latest.map(h => {
    const meta = STRATEGY_META[h.source] || { name: h.source, color: '#888' };
    return `<tr>
      <td style="color:${meta.color}">${meta.name}</td>
      <td class="font-medium">${h.ticker}</td>
      <td>${h.shares?.toFixed(4) || '—'}</td>
      <td>$${h.cost_price?.toFixed(2) || '—'}</td>
      <td>$${h.current_price?.toFixed(2) || '—'}</td>
      <td>${fmtMoney(h.value)}</td>
      <td style="color:${(h.profit_loss || 0) >= 0 ? 'var(--profit)' : 'var(--loss)'}">${fmtMoney(h.profit_loss)}</td>
      <td style="color:${(h.return_pct || 0) >= 0 ? 'var(--profit)' : 'var(--loss)'}">${fmtPct(h.return_pct)}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="8" class="text-center text-[var(--muted)] py-4">No holdings data</td></tr>';
}

function renderSignals(signals) {
  const tbody = document.getElementById('signalsBody');
  if (!tbody) return;
  const sorted = [...signals].sort((a, b) => b.date.localeCompare(a.date) || a.source.localeCompare(b.source));
  tbody.innerHTML = sorted.map(s => {
    const meta = STRATEGY_META[s.source] || { name: s.source, color: '#888' };
    const badgeClass = s.action === 'buy' ? 'badge-buy' : s.action === 'sell' ? 'badge-sell' : 'badge-hold';
    const reason = s.reason ? s.reason.substring(0, 60) : '—';
    return `<tr>
      <td class="text-[var(--muted)]">${s.date}</td>
      <td style="color:${meta.color}">${meta.name}</td>
      <td><span class="badge ${badgeClass}">${s.action.toUpperCase()}</span></td>
      <td class="font-medium">${s.ticker}</td>
      <td>$${s.price?.toFixed(2) || '—'}</td>
      <td>${s.shares?.toFixed(2) || '—'}</td>
      <td>${fmtMoney(s.amount)}</td>
      <td class="text-xs text-[var(--muted)]" title="${s.reason || ''}">${reason}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="8" class="text-center text-[var(--muted)] py-4">No signals yet</td></tr>';
}

// Range filter
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentRange = btn.dataset.range;
    loadData().then(data => renderEquityChart(data.equity, currentRange));
  });
});

// Init
loadData().then(data => {
  renderEquityChart(data.equity, 'all');
  renderHoldings(data.holdings);
  renderSignals(data.signals);
});

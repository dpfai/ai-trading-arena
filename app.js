// AI Trading Arena - Main JS

async function loadData() {
  const data = await loadArenaData(['strategies', 'signals', 'equity_curve', 'holdings', 'health']);
  return {
    strategies: data.strategies,
    signals: data.signals,
    equity: data.equity_curve,
    holdings: data.holdings,
    health: data.health,
  };
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
  const data = await loadData();
  renderDataHealth({ equity: data.equity, holdings: data.holdings, signals: data.signals, health: data.health });
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
});

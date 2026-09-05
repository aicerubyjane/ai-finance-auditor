let trendChartInstance = null;
let productChartInstance = null;
let currentSelectedSheet = "";

function formatRupiah(num) {
  if (num === undefined || num === null || isNaN(num)) return "Rp 0";
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0
  }).format(num);
}

async function fetchDashboardData(sheetOverride = "") {
  try {
    const target = sheetOverride || currentSelectedSheet;
    const url = target ? `/api/dashboard?sheet=${encodeURIComponent(target)}` : '/api/dashboard';
    const res = await fetch(url);
    if (!res.ok) throw new Error("Gagal mengambil data dashboard");
    const data = await res.json();
    updateUI(data);
  } catch (err) {
    console.error("Fetch dashboard error:", err);
  }
}

function updateUI(data) {
  const kpis = data.kpis || {};
  const daily = data.daily || {};
  const activeSheet = data.active_sheet || "Hari 47";
  currentSelectedSheet = activeSheet;

  // Top KPI Global Cards (Tab Dashboard Usaha 60 Hari)
  document.getElementById('kpiTotalOmzet').textContent = formatRupiah(kpis.total_omzet);
  document.getElementById('kpiSurplusKas').textContent = formatRupiah(kpis.surplus_kas);
  document.getElementById('kpiSoldBerbayar').textContent = `${kpis.sold_berbayar || 0} Akun`;
  document.getElementById('kpiAvgSold').textContent = `${kpis.sold_per_hari_aktif || 0} / Hari`;
  document.getElementById('kpiKlaimGaransi').textContent = `${kpis.klaim_garansi || 0} Akun`;
  document.getElementById('kpiRasioKlaim').textContent = kpis.rasio_klaim || "0%";
  document.getElementById('kpiTotalModal').textContent = formatRupiah(kpis.total_modal);
  document.getElementById('kpiHariAktif').textContent = `${kpis.hari_aktif || 0} Hari`;

  // Daily Section (Berdasarkan Sheet Hari yang Dipilih)
  const currentBadge = document.getElementById('currentDayBadge');
  if (currentBadge) currentBadge.textContent = activeSheet;
  
  document.getElementById('chipReady').textContent = `${daily.akun_ready || 0} Ready`;
  document.getElementById('chipSold').textContent = `${daily.sold_berbayar || 0} Sold`;
  document.getElementById('chipClaim').textContent = `${daily.klaim_garansi || 0} Klaim`;

  document.getElementById('dayOmzet').textContent = formatRupiah(daily.total_omzet);
  document.getElementById('dayModal').textContent = formatRupiah(daily.total_modal);
  document.getElementById('daySurplus').textContent = formatRupiah(daily.surplus_kas);
  document.getElementById('dayMargin').textContent = daily.margin_kas || "0%";
  document.getElementById('dayThreads').textContent = daily.dari_threads || 0;
  document.getElementById('dayReseller').textContent = daily.dari_reseller || 0;

  // Populate Dropdown Sheet Desktop & Mobile
  const selectDesktop = document.getElementById('activeDaySelect');
  if (selectDesktop && data.available_sheets && data.available_sheets.length > 0) {
    if (selectDesktop.children.length <= 1 || selectDesktop.dataset.populated !== "true") {
      selectDesktop.innerHTML = '';
      data.available_sheets.forEach(sheet => {
        const opt = document.createElement('option');
        opt.value = sheet;
        opt.textContent = sheet;
        if (sheet.trim().toLowerCase() === activeSheet.trim().toLowerCase()) {
          opt.selected = true;
        }
        selectDesktop.appendChild(opt);
      });
      selectDesktop.dataset.populated = "true";
    }
    selectDesktop.value = activeSheet;
  }

  // Render Visual Charts
  renderTrendChart(kpis.trend_harian || []);
  renderProductChart(kpis.rekap_produk || {});
  renderProductTable(kpis.rekap_produk || {});
}

function renderTrendChart(trendData) {
  const canvas = document.getElementById('trendChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  
  const labels = trendData.map(d => d.hari);
  const omzet = trendData.map(d => d.omzet);
  const modal = trendData.map(d => d.modal);
  const surplus = trendData.map(d => d.surplus);

  if (trendChartInstance) {
    trendChartInstance.destroy();
  }

  trendChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Total Omzet',
          data: omzet,
          borderColor: '#5C7E8F', // Frosted Aura primary
          backgroundColor: 'rgba(92, 126, 143, 0.08)',
          fill: true,
          tension: 0.3,
          borderWidth: 2.5,
          pointRadius: 2,
          pointHoverRadius: 5,
        },
        {
          label: 'Surplus Kas',
          data: surplus,
          borderColor: '#10B981', // Emerald Success
          backgroundColor: 'rgba(16, 185, 129, 0.04)',
          fill: true,
          borderWidth: 2,
          tension: 0.3,
          pointRadius: 2,
          pointHoverRadius: 5,
        },
        {
          label: 'Modal Terpakai',
          data: modal,
          borderColor: '#EF4444', // Danger Red
          backgroundColor: 'transparent',
          borderWidth: 2,
          tension: 0.3,
          pointRadius: 2,
          pointHoverRadius: 5,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top',
          align: 'end',
          labels: {
            boxWidth: 10,
            boxHeight: 10,
            color: '#475569',
            font: { family: 'Plus Jakarta Sans', size: 11, weight: '600' }
          }
        },
        tooltip: {
          backgroundColor: '#0F172A',
          titleColor: '#FFFFFF',
          bodyColor: '#D4DDE2',
          borderColor: '#D4DDE2',
          borderWidth: 1,
          padding: 10,
          callbacks: {
            label: function(context) {
              return ` ${context.dataset.label}: ${formatRupiah(context.raw)}`;
            }
          }
        }
      },
      scales: {
        x: {
          ticks: { color: '#64748B', font: { size: 10, weight: '500' } },
          grid: { color: '#F1F5F9' }
        },
        y: {
          ticks: {
            color: '#64748B',
            font: { size: 10, weight: '500' },
            callback: function(value) {
              return (value / 1000).toLocaleString('id-ID') + 'k';
            }
          },
          grid: { color: '#F1F5F9' }
        }
      }
    }
  });
}

function renderProductChart(rekap) {
  const canvas = document.getElementById('productChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  
  const labels = Object.keys(rekap);
  const data = labels.map(k => rekap[k].sold || 0);

  if (productChartInstance) {
    productChartInstance.destroy();
  }

  productChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: data,
        backgroundColor: ['#5C7E8F', '#A2A2A2', '#D4DDE2'], // Frosted Aura palette
        borderColor: '#FFFFFF',
        borderWidth: 3,
        hoverOffset: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            boxWidth: 10,
            boxHeight: 10,
            color: '#475569',
            font: { family: 'Plus Jakarta Sans', size: 11, weight: '600' },
            padding: 12
          }
        },
        tooltip: {
          backgroundColor: '#0F172A',
          titleColor: '#FFFFFF',
          bodyColor: '#D4DDE2',
          padding: 8
        }
      },
      cutout: '65%'
    }
  });
}

function renderProductTable(rekap) {
  const tbody = document.getElementById('productTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  for (const [prod, info] of Object.entries(rekap)) {
    const rateNum = info.sold > 0 ? ((info.klaim / info.sold) * 100) : 0;
    const rateStr = rateNum > 0 ? `${rateNum.toFixed(1)}%` : '0%';
    const tagClass = rateNum > 10 ? 'tag-claim' : 'tag-ready';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${prod}</strong></td>
      <td>${info.sold} Akun</td>
      <td><span class="val-caution">${info.klaim} Akun</span></td>
      <td><span class="val-positive">${info.ready} Ready</span></td>
      <td>${formatRupiah(info.omzet)}</td>
      <td><span class="tag-badge ${tagClass}">${rateStr}</span></td>
    `;
    tbody.appendChild(tr);
  }
}

// Event Listeners
document.getElementById('refreshBtn')?.addEventListener('click', () => {
  fetchDashboardData(currentSelectedSheet);
});

function handleSheetChange(e) {
  const newSheet = e.target.value;
  currentSelectedSheet = newSheet;

  fetch('/api/set-active-day', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sheet_name: newSheet })
  }).catch(err => console.error("Error setting active day:", err));

  fetchDashboardData(newSheet);
}

document.getElementById('activeDaySelect')?.addEventListener('change', handleSheetChange);

// Initial Fetch & Refresh Polling
fetchDashboardData();
setInterval(() => {
  fetchDashboardData(currentSelectedSheet);
}, 15000);

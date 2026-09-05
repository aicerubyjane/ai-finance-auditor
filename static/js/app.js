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
  document.getElementById('currentDayBadge').textContent = activeSheet;
  document.getElementById('chipReady').textContent = `${daily.akun_ready || 0} Ready`;
  document.getElementById('chipSold').textContent = `${daily.sold_berbayar || 0} Sold`;
  document.getElementById('chipClaim').textContent = `${daily.klaim_garansi || 0} Klaim`;

  document.getElementById('dayOmzet').textContent = formatRupiah(daily.total_omzet);
  document.getElementById('dayModal').textContent = formatRupiah(daily.total_modal);
  document.getElementById('daySurplus').textContent = formatRupiah(daily.surplus_kas);
  document.getElementById('dayMargin').textContent = daily.margin_kas || "0%";
  document.getElementById('dayThreads').textContent = daily.dari_threads || 0;
  document.getElementById('dayReseller').textContent = daily.dari_reseller || 0;

  // Populate Dropdown Sheet (Hanya jika belum diisi atau berubah)
  const select = document.getElementById('activeDaySelect');
  if (data.available_sheets && data.available_sheets.length > 0) {
    if (select.children.length <= 1 || select.dataset.populated !== "true") {
      select.innerHTML = '';
      data.available_sheets.forEach(sheet => {
        const opt = document.createElement('option');
        opt.value = sheet;
        opt.textContent = sheet;
        if (sheet === activeSheet) opt.selected = true;
        select.appendChild(opt);
      });
      select.dataset.populated = "true";
    } else {
      select.value = activeSheet;
    }
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
          label: 'Omzet',
          data: omzet,
          borderColor: '#2f81f7',
          backgroundColor: 'rgba(47, 129, 247, 0.08)',
          fill: true,
          tension: 0.2,
          borderWidth: 1.75,
          pointRadius: 2,
          pointHoverRadius: 4,
        },
        {
          label: 'Surplus Kas',
          data: surplus,
          borderColor: '#238636',
          backgroundColor: 'transparent',
          borderWidth: 1.75,
          tension: 0.2,
          pointRadius: 2,
          pointHoverRadius: 4,
        },
        {
          label: 'Modal',
          data: modal,
          borderColor: '#f85149',
          backgroundColor: 'transparent',
          borderWidth: 1.75,
          tension: 0.2,
          pointRadius: 2,
          pointHoverRadius: 4,
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
            boxWidth: 12,
            boxHeight: 12,
            color: '#8b949e',
            font: { family: 'Plus Jakarta Sans', size: 11, weight: '500' }
          }
        },
        tooltip: {
          backgroundColor: '#161b22',
          titleColor: '#f0f6fc',
          bodyColor: '#8b949e',
          borderColor: '#30363d',
          borderWidth: 1,
          padding: 10,
          callbacks: {
            label: function(context) {
              return `${context.dataset.label}: ${formatRupiah(context.raw)}`;
            }
          }
        }
      },
      scales: {
        x: {
          ticks: { color: '#6e7681', font: { size: 10 } },
          grid: { color: 'rgba(255, 255, 255, 0.04)' }
        },
        y: {
          ticks: {
            color: '#6e7681',
            font: { size: 10 },
            callback: function(value) {
              return (value / 1000).toLocaleString('id-ID') + 'k';
            }
          },
          grid: { color: 'rgba(255, 255, 255, 0.04)' }
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

  const isMobile = window.innerWidth < 768;
  productChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: data,
        backgroundColor: ['#2f81f7', '#a371f7', '#3fb950'],
        borderColor: '#161b22',
        borderWidth: 2,
        hoverOffset: 3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: {
        padding: isMobile ? 4 : 0
      },
      plugins: {
        legend: {
          position: isMobile ? 'bottom' : 'right',
          labels: {
            boxWidth: 8,
            boxHeight: 8,
            color: '#8b949e',
            font: { family: 'Plus Jakarta Sans', size: 10 },
            padding: 6
          }
        },
        tooltip: {
          backgroundColor: '#161b22',
          titleColor: '#f0f6fc',
          bodyColor: '#8b949e',
          borderColor: '#30363d',
          borderWidth: 1,
          padding: 6
        }
      },
      cutout: '60%'
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

// Ganti Sheet via Dropdown -> Langsung update tampilan seketika!
document.getElementById('activeDaySelect')?.addEventListener('change', async (e) => {
  const newSheet = e.target.value;
  currentSelectedSheet = newSheet;
  document.getElementById('currentDayBadge').textContent = newSheet;

  // Update backend setting
  fetch('/api/set-active-day', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sheet_name: newSheet })
  }).catch(err => console.error("Error setting active day:", err));

  // Ambil data hari yang dipilih secara instan
  fetchDashboardData(newSheet);
});

// Initial Fetch & Refresh Polling
fetchDashboardData();
setInterval(() => {
  fetchDashboardData(currentSelectedSheet);
}, 15000);

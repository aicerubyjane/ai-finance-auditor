let trendChartInstance = null;
let trendChartTrenInstance = null;
let productChartInstance = null;
let currentSelectedSheet = '';

const dashboardState = {
  hasData: false, lastSyncedAt: null, requestId: 0, controller: null,
  changingDay: false, loading: false, range: 30, trend: [], products: [],
  search: '', filter: 'all', sort: 'sold', direction: 'desc',
  visibleSeries: [true, true, true], trendSignature: '', productSignature: '', tableSignature: '',
  zoomRange: 30, zoomOffset: 0
};
const rupiahFormatter = new Intl.NumberFormat('id-ID', {
  style: 'currency', currency: 'IDR', maximumFractionDigits: 0
});
const numberFormatter = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 });
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const productPalette = ['#235c46', '#7a947e', '#b98c51', '#b8c5b5', '#525e54', '#d2ba94'];
const metricIds = [
  'kpiTotalOmzet', 'kpiSurplusKas', 'kpiSoldBerbayar', 'kpiAvgSold', 'kpiKlaimGaransi',
  'kpiRasioKlaim', 'kpiTotalModal', 'kpiHariAktif', 'dayOmzet', 'dayModal', 'daySurplus',
  'dayMargin', 'dayThreads', 'dayReseller'
];

function triggerHaptic(type = 'light') {
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    try {
      if (type === 'light') navigator.vibrate(8);
      else if (type === 'medium') navigator.vibrate(14);
      else if (type === 'success') navigator.vibrate([10, 35, 15]);
      else if (type === 'tuing') navigator.vibrate([8, 28, 12]);
    } catch {
      // Ignore vibration errors on unsupporting platforms
    }
  }
}
window.triggerHaptic = triggerHaptic;

function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatRupiah(value) {
  return rupiahFormatter.format(numeric(value));
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element && element.textContent !== String(value)) element.textContent = value;
}

function getRealtimeDateInfo() {
  const now = new Date();
  const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const monthsShort = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const monthsFull = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  
  const dayName = days[now.getDay()];
  const dayNum = now.getDate();
  const monthShort = monthsShort[now.getMonth()];
  const monthFull = monthsFull[now.getMonth()];
  const year = now.getFullYear();
  
  return {
    dayNum,
    monthShort,
    monthFull,
    year,
    full: `${dayName}, ${dayNum} ${monthShort} ${year}`,
    short: `${dayNum} ${monthShort}`,
    standard: `${dayNum} ${monthFull} ${year}`
  };
}

function findSheetByDate(map, realDate) {
  if (!map || typeof map !== 'object') return null;
  const padDay = String(realDate.dayNum).padStart(2, '0');
  const rawDay = String(realDate.dayNum);
  const mShort = String(realDate.monthShort).toLowerCase();
  
  const target1 = `${padDay} ${mShort}`;
  const target2 = `${rawDay} ${mShort}`;

  for (const [sheetName, dateVal] of Object.entries(map)) {
    const dLower = String(dateVal).toLowerCase();
    if (dLower.includes(target1) || dLower.includes(target2)) {
      return sheetName;
    }
  }
  return null;
}

function setHidden(id, hidden) {
  const element = document.getElementById(id);
  if (element) element.hidden = hidden;
}

function showDashboardNotice(message = '') {
  const notice = document.getElementById('dashboardNotice');
  if (notice) {
    notice.textContent = message;
    notice.hidden = !message;
  }
}

function syncTimestamp() {
  return dashboardState.lastSyncedAt?.toLocaleTimeString('id-ID', {
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).replace(/\./g, ':') || '';
}

function setSyncStatus(status, message) {
  const badge = document.getElementById('syncStatusBadge');
  if (badge) {
    badge.classList.remove('loading', 'success', 'error');
    badge.classList.add(status);
  }
  setText('syncStatusText', message);
}

function setDaySelects(value = currentSelectedSheet, disabled = dashboardState.changingDay) {
  ['activeDaySelect', 'mobileDaySelect'].forEach(id => {
    const select = document.getElementById(id);
    if (!select) return;
    if (value) select.value = value;
    select.disabled = disabled || !dashboardState.hasData;
  });
}

function setLoadingState(loading, background = false) {
  dashboardState.loading = loading;
  const refresh = document.getElementById('refreshBtn');
  if (refresh) {
    refresh.disabled = loading;
    refresh.classList.toggle('is-loading', loading && !background);
    refresh.setAttribute('aria-busy', String(loading));
  }
  const progress = document.getElementById('syncProgressBar');
  if (progress) {
    progress.style.opacity = loading && !background ? '1' : '0';
    progress.style.width = loading ? '65%' : '100%';
  }
  metricIds.forEach(id => document.getElementById(id)?.classList.toggle('shimmer-loading', loading && !dashboardState.hasData));
  if (loading && !background) {
    setSyncStatus('loading', dashboardState.hasData ? 'Memperbarui data…' : 'Mengambil data Google Sheets…');
  }
  setDaySelects();
}

function validateDashboard(data) {
  // Sheets errors currently reach this endpoint as empty objects with HTTP 200.
  if (!data || !data.kpis || !data.daily || !Object.keys(data.kpis).length || !Object.keys(data.daily).length) {
    throw new Error('Data Google Sheets belum tersedia.');
  }
}

async function fetchDashboardData(sheetOverride = '', options = {}) {
  if (dashboardState.changingDay && !options.dayChange) return false;
  if (options.background && dashboardState.loading) return false;
  const previousSheet = currentSelectedSheet;
  const target = sheetOverride || previousSheet;
  const requestId = ++dashboardState.requestId;
  dashboardState.controller?.abort();
  const controller = new AbortController();
  dashboardState.controller = controller;
  dashboardState.changingDay = Boolean(options.dayChange);
  setLoadingState(true, options.background);
  if (options.dayChange) setDaySelects(target, true);
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    let url = target ? `/api/dashboard?sheet=${encodeURIComponent(target)}` : '/api/dashboard';
    if (options.force) {
      url += (url.includes('?') ? '&force=true' : '?force=true');
    }
    const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) throw new Error('Dashboard gagal dimuat.');
    const data = await response.json();
    validateDashboard(data);
    if (requestId !== dashboardState.requestId) return false;
    if (options.dayChange) {
      // Preserve the current view until the sheet data and selected day are confirmed.
      const dayResponse = await fetch('/api/set-active-day', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheet_name: target }), signal: controller.signal
      });
      if (!dayResponse.ok || !(await dayResponse.json()).success) throw new Error('Hari aktif gagal diganti.');
    }
    if (requestId !== dashboardState.requestId) return false;
    updateUI(data);
    dashboardState.hasData = true;
    dashboardState.lastSyncedAt = new Date();
    setSyncStatus('success', `Diperbarui ${syncTimestamp()}`);
    showDashboardNotice();

    // Cache in localStorage for instant 0ms load next visit
    try {
      localStorage.setItem('cached_dashboard_data', JSON.stringify(data));
    } catch {}

    // Number pop animation
    metricIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.classList.remove('tuing-pop');
        void el.offsetWidth;
        el.classList.add('tuing-pop');
      }
    });
    return true;
  } catch (error) {
    if (requestId !== dashboardState.requestId) return false;
    setSyncStatus('error', dashboardState.hasData ? `Data terakhir ${syncTimestamp()}` : 'Belum terhubung');
    showDashboardNotice(options.dayChange
      ? `Gagal membuka ${target}. Tampilan tetap di ${previousSheet}. Coba pilih hari lagi.`
      : dashboardState.hasData
        ? 'Pembaruan terhenti. Data terakhir masih ditampilkan. Tekan Sinkronkan untuk mencoba lagi.'
        : 'Data Google Sheets belum berhasil dimuat. Periksa koneksi, lalu tekan Sinkronkan.');
    if (!dashboardState.hasData) {
      renderTableEmpty('Data produk belum dimuat. Tekan Sinkronkan untuk mencoba lagi.');
      setText('trendEmpty', 'Grafik belum dimuat. Coba perbarui data.');
      setText('productEmpty', 'Data penjualan belum dimuat.');
      setHidden('trendEmpty', false);
      setHidden('productEmpty', false);
      setText('trendEmptyTren', 'Grafik belum dimuat. Tekan Sinkronkan untuk mencoba lagi.');
      setHidden('trendEmptyTren', false);
      document.querySelector('.donut-center')?.setAttribute('hidden', '');
    }
    setDaySelects(previousSheet, false);
    return false;
  } finally {
    clearTimeout(timeout);
    if (requestId === dashboardState.requestId) {
      dashboardState.changingDay = false;
      dashboardState.controller = null;
      setLoadingState(false, options.background);
    }
  }
}

function updateUI(data) {
  const kpis = data.kpis || {};
  const daily = data.daily || {};
  dashboardState.hariTanggalMap = kpis.hari_tanggal_map || {};
  currentSelectedSheet = data.active_sheet || currentSelectedSheet;

  // Realtime date calculation and display
  const realDate = getRealtimeDateInfo();
  setText('brandLiveDateTextFull', realDate.full);
  setText('brandLiveDateTextShort', realDate.short);
  setText('localDate', realDate.full);

  // Auto-sync current sheet with today's real-world date if available and not manually changed
  if (!dashboardState.userChangedDay && !dashboardState.syncedWithToday) {
    const todaySheet = findSheetByDate(dashboardState.hariTanggalMap, realDate);
    if (todaySheet && currentSelectedSheet !== todaySheet) {
      dashboardState.syncedWithToday = true;
      currentSelectedSheet = todaySheet;
      fetchDashboardData(todaySheet, { dayChange: true });
      return;
    }
    dashboardState.syncedWithToday = true;
  }

  // Header day badge and tooltip
  setText('brandDayBadge', currentSelectedSheet || '—');
  const brandPill = document.getElementById('brandDatePill');
  if (brandPill) {
    const mappedDate = dashboardState.hariTanggalMap[currentSelectedSheet] || '';
    brandPill.title = `Tanggal Realtime: ${realDate.full} · Sheet: ${currentSelectedSheet}${mappedDate ? ` (${mappedDate})` : ''} (Klik untuk sinkronkan)`;
  }

  // Current day date in Catatan Harian card
  const sheetTanggal = daily.tanggal || (dashboardState.hariTanggalMap[currentSelectedSheet]) || '';
  const dayDateEl = document.getElementById('currentDayDate');
  if (dayDateEl) {
    if (sheetTanggal) {
      dayDateEl.textContent = sheetTanggal;
      dayDateEl.style.display = 'inline-flex';
    } else {
      dayDateEl.style.display = 'none';
    }
  }

  const textValues = {
    kpiTotalOmzet: formatRupiah(kpis.total_omzet), kpiSurplusKas: formatRupiah(kpis.surplus_kas),
    kpiSoldBerbayar: numberFormatter.format(numeric(kpis.sold_berbayar)),
    kpiAvgSold: `${numberFormatter.format(numeric(kpis.sold_per_hari_aktif))} akun / hari aktif`,
    kpiKlaimGaransi: numberFormatter.format(numeric(kpis.klaim_garansi)),
    kpiRasioKlaim: kpis.rasio_klaim || '0%', kpiTotalModal: formatRupiah(kpis.total_modal),
    kpiHariAktif: numberFormatter.format(numeric(kpis.hari_aktif)),
    currentDayBadge: currentSelectedSheet, sidebarDay: currentSelectedSheet,
    chipReady: `${numberFormatter.format(numeric(daily.akun_ready))} ready`,
    chipSold: `${numberFormatter.format(numeric(daily.sold_berbayar))} terjual`,
    chipClaim: `${numberFormatter.format(numeric(daily.klaim_garansi))} klaim`,
    dayOmzet: formatRupiah(daily.total_omzet), dayModal: formatRupiah(daily.total_modal),
    daySurplus: formatRupiah(daily.surplus_kas), dayMargin: daily.margin_kas || '0%',
    dayThreads: numberFormatter.format(numeric(daily.dari_threads)),
    dayReseller: numberFormatter.format(numeric(daily.dari_reseller))
  };
  Object.entries(textValues).forEach(([id, value]) => setText(id, value));
  ['daySurplus', 'kpiSurplusKas'].forEach(id => {
    document.getElementById(id)?.classList.toggle('is-negative', numeric(id === 'daySurplus' ? daily.surplus_kas : kpis.surplus_kas) < 0);
  });

  // Margin laba bersih badge
  const totalOmzetVal = numeric(kpis.total_omzet);
  const surplusKasVal = numeric(kpis.surplus_kas);
  const marginBadge = document.getElementById('kpiSurplusMargin');
  if (marginBadge) {
    if (totalOmzetVal > 0) {
      const marginPct = (surplusKasVal / totalOmzetVal) * 100;
      marginBadge.textContent = `Marg ${marginPct >= 0 ? '+' : ''}${marginPct.toFixed(1)}%`;
      marginBadge.classList.toggle('negative', marginPct < 0);
      marginBadge.hidden = false;
    } else {
      marginBadge.hidden = true;
    }
  }
  const sheets = Array.isArray(data.available_sheets) ? data.available_sheets : [];
  const signature = JSON.stringify(sheets);
  ['activeDaySelect', 'mobileDaySelect'].forEach(id => {
    const select = document.getElementById(id);
    if (!select) return;
    if (select.dataset.sheets !== signature) {
      const fragment = document.createDocumentFragment();
      sheets.forEach(sheet => {
        const option = document.createElement('option');
        option.value = sheet;
        const mappedDate = dashboardState.hariTanggalMap ? (dashboardState.hariTanggalMap[sheet] || '') : '';
        option.textContent = mappedDate ? `${sheet} (${mappedDate})` : sheet;
        fragment.appendChild(option);
      });
      select.replaceChildren(fragment);
      select.dataset.sheets = signature;
    }
    select.value = currentSelectedSheet;
  });
  const products = new Map(Object.entries(kpis.rekap_produk || {}).map(([name, stats]) => [name, { ...stats }]));
  for (const [name, stats] of Object.entries(daily.daily_produk || {})) {
    const existing = products.get(name);
    if (!existing || (!numeric(existing.sold) && !numeric(existing.ready))) products.set(name, { ...stats });
    else existing.ready = stats.ready;
  }
  dashboardState.products = Array.from(products, ([product, stats]) => ({
    product, sold: numeric(stats.sold), klaim: numeric(stats.klaim), ready: numeric(stats.ready), omzet: numeric(stats.omzet),
    claimRate: numeric(stats.sold) > 0 ? numeric(stats.klaim) / numeric(stats.sold) * 100 : 0
  }));
  dashboardState.trend = Array.isArray(kpis.trend_harian) ? kpis.trend_harian : [];

  // Mini summary metrics for dedicated produk view
  const totalProductsCount = dashboardState.products.length;
  const totalSoldAll = dashboardState.products.reduce((acc, p) => acc + numeric(p.sold), 0);
  const totalReadyAll = dashboardState.products.reduce((acc, p) => acc + numeric(p.ready), 0);
  const totalClaimAll = dashboardState.products.reduce((acc, p) => acc + numeric(p.klaim), 0);
  const avgClaimRate = totalSoldAll > 0 ? (totalClaimAll / totalSoldAll * 100).toFixed(1) : '0';

  setText('miniTotalProducts', `${totalProductsCount} produk`);
  setText('miniTotalSold', `${numberFormatter.format(totalSoldAll)} akun`);
  setText('miniTotalReady', `${numberFormatter.format(totalReadyAll)} stok`);
  setText('miniAvgClaim', `${avgClaimRate}%`);

  renderTrendChart();
  renderProductChart();
  renderProductTable();
}

function getProductLogo(productName) {
  const norm = String(productName || '').toLowerCase().trim();
  if (norm.includes('chatgpt') || norm.includes('gpt') || norm.includes('openai')) {
    return { src: '/assets/chatgptlogo.png', alt: 'ChatGPT' };
  }
  if (norm.includes('gemini') || norm.includes('google')) {
    return { src: '/assets/geminilogo.png', alt: 'Gemini' };
  }
  if (norm.includes('claude') || norm.includes('anthropic')) {
    return { src: '/assets/claudelogocard.jpg', alt: 'Claude' };
  }
  if (norm.includes('apple') || norm.includes('music')) {
    return { src: '/assets/apple%20music.jpg', alt: 'Apple Music' };
  }
  return null;
}

function createFallbackAvatar(productName) {
  const avatar = document.createElement('span');
  avatar.className = 'product-avatar';
  avatar.textContent = productName.split(/\s+/).map(word => Array.from(word)[0] || '').join('').slice(0, 2).toUpperCase();
  avatar.setAttribute('aria-hidden', 'true');
  return avatar;
}

function getSortedTrendRows() {
  const rows = dashboardState.trend.map((row, index) => ({
    ...row, day: numeric(String(row.hari || '').match(/\d+/)?.[0]) || index + 1
  })).sort((a, b) => a.day - b.day);
  const activeRows = rows.filter(row => ['omzet', 'modal', 'surplus', 'sold'].some(key => numeric(row[key]) !== 0));
  if (!activeRows.length) return rows;
  const latestDay = activeRows[activeRows.length - 1].day;
  return rows.filter(row => row.day <= latestDay);
}

function trendWindow() {
  const allRows = getSortedTrendRows();
  if (!allRows.length) return [];
  const windowSize = Math.max(3, Math.min(allRows.length, dashboardState.zoomRange || 30));
  const maxOffset = Math.max(0, allRows.length - windowSize);
  const offset = Math.max(0, Math.min(maxOffset, dashboardState.zoomOffset || 0));
  const endIndex = allRows.length - offset;
  const startIndex = Math.max(0, endIndex - windowSize);
  return allRows.slice(startIndex, endIndex);
}

function syncRangeButtons() {
  const activeRange = dashboardState.zoomRange || dashboardState.range || 30;
  document.querySelectorAll('[data-range]').forEach(button => {
    const r = Number(button.dataset.range);
    const active = r === activeRange;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function zoomIn() {
  const current = dashboardState.zoomRange || 30;
  const steps = [7, 14, 30, 90];
  const smaller = steps.slice().reverse().find(lvl => lvl < current);
  dashboardState.zoomRange = smaller || 7;
  dashboardState.range = dashboardState.zoomRange;
  dashboardState.zoomOffset = Math.max(0, dashboardState.zoomOffset || 0);
  updateZoomBadges();
  syncRangeButtons();
  renderTrendChart(true);
}

function zoomOut() {
  const current = dashboardState.zoomRange || 30;
  const steps = [7, 14, 30, 90];
  const larger = steps.find(lvl => lvl > current);
  dashboardState.zoomRange = larger || 90;
  dashboardState.range = dashboardState.zoomRange;
  updateZoomBadges();
  syncRangeButtons();
  renderTrendChart(true);
}

function panLeft() {
  const allRows = getSortedTrendRows();
  const windowSize = Math.max(3, Math.min(allRows.length, dashboardState.zoomRange || 30));
  const maxOffset = Math.max(0, allRows.length - windowSize);
  dashboardState.zoomOffset = Math.min(maxOffset, (dashboardState.zoomOffset || 0) + Math.max(1, Math.floor(windowSize / 3)));
  updateZoomBadges();
  renderTrendChart(true);
}

function panRight() {
  const windowSize = Math.max(3, dashboardState.zoomRange || 30);
  dashboardState.zoomOffset = Math.max(0, (dashboardState.zoomOffset || 0) - Math.max(1, Math.floor(windowSize / 3)));
  updateZoomBadges();
  renderTrendChart(true);
}

function resetZoom() {
  dashboardState.zoomRange = 30;
  dashboardState.range = 30;
  dashboardState.zoomOffset = 0;
  updateZoomBadges();
  syncRangeButtons();
  renderTrendChart(true);
}

function updateZoomBadges() {
  const rows = trendWindow();
  const allRows = getSortedTrendRows();
  const maxOffset = Math.max(0, allRows.length - rows.length);
  dashboardState.zoomOffset = Math.min(maxOffset, dashboardState.zoomOffset || 0);
  const disabled = {
    btnZoomIn: !rows.length || dashboardState.zoomRange <= 7,
    btnZoomOut: !rows.length || dashboardState.zoomRange >= 90,
    btnPanLeft: !rows.length || dashboardState.zoomOffset >= maxOffset,
    btnPanRight: !rows.length || dashboardState.zoomOffset <= 0
  };
  Object.entries(disabled).forEach(([id, value]) => {
    [id, `${id}Tren`].forEach(buttonId => {
      const button = document.getElementById(buttonId);
      if (button) button.disabled = value;
    });
  });
  if (!rows.length) {
    setText('zoomWindowBadge', 'Belum ada riwayat');
    setText('zoomWindowBadgeTren', 'Belum ada riwayat');
    return;
  }
  const startDay = rows[0].day;
  const endDay = rows[rows.length - 1].day;
  const text = `Hari ${startDay}–${endDay} · ${rows.length} hari tercatat`;
  setText('zoomWindowBadge', text);
  setText('zoomWindowBadgeTren', text);
}

function compactCurrency(value) {
  const amount = numeric(value);
  if (Math.abs(amount) >= 1000000) return `${numberFormatter.format(amount / 1000000)} jt`;
  if (Math.abs(amount) >= 1000) return `${numberFormatter.format(amount / 1000)} rb`;
  return numberFormatter.format(amount);
}

function chartTooltip() {
  return {
    backgroundColor: '#ffffff', titleColor: '#18221C', bodyColor: '#425247', borderColor: '#DCE2DE',
    borderWidth: 1, padding: 12, cornerRadius: 6, boxPadding: 5, usePointStyle: true,
    titleFont: { family: 'DM Sans, sans-serif', size: 12, weight: 700 },
    bodyFont: { family: 'DM Sans, sans-serif', size: 11.5 }
  };
}

function buildTrendChartConfig(rows, animate) {
  const datasets = [
    {
      type: 'bar',
      label: 'Modal',
      data: rows.map(r => numeric(r.modal)),
      backgroundColor: '#849677',
      hoverBackgroundColor: '#92a484',
      stack: 'keuangan',
      borderRadius: 0,
      hidden: !dashboardState.visibleSeries[0],
      barPercentage: 0.72,
      categoryPercentage: 0.85
    },
    {
      type: 'bar',
      label: 'Surplus',
      data: rows.map(r => numeric(r.surplus)),
      backgroundColor: rows.map(r => numeric(r.surplus) < 0 ? '#b95c48' : '#377455'),
      hoverBackgroundColor: rows.map(r => numeric(r.surplus) < 0 ? '#a04b3a' : '#235c46'),
      stack: 'keuangan',
      borderRadius: rows.map(r => numeric(r.surplus) < 0 
        ? { topLeft: 0, topRight: 0, bottomLeft: 4, bottomRight: 4 }
        : { topLeft: 4, topRight: 4, bottomLeft: 0, bottomRight: 0 }),
      hidden: !dashboardState.visibleSeries[1],
      barPercentage: 0.72,
      categoryPercentage: 0.85
    }
  ];

  return {
    data: {
      labels: rows.map(row => `H${row.day}`),
      datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: animate && !reducedMotion.matches ? { duration: 220 } : false,
      interaction: { mode: 'index', intersect: false },
      layout: { padding: { top: 12, right: 12, bottom: 4, left: 4 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...chartTooltip(),
          callbacks: {
            title: items => items.length ? `Hari ${items[0].label.slice(1)}` : '',
            label: context => {
              const val = numeric(context.raw);
              const label = context.dataset.label;
              if (label === 'Surplus') {
                return val < 0
                  ? ` Defisit: ${formatRupiah(val)}`
                  : ` Surplus: ${formatRupiah(val)}`;
              }
              return ` ${label}: ${formatRupiah(val)}`;
            },
            footer: items => items.length ? `Omzet: ${formatRupiah(rows[items[0].dataIndex].omzet)}` : ''
          }
        }
      },
      scales: {
        x: {
          stacked: true,
          border: { display: false },
          grid: { display: false },
          ticks: {
            color: '#647160',
            maxRotation: 0,
            maxTicksLimit: Math.min(15, rows.length),
            font: { family: 'DM Sans, sans-serif', size: 10.5, weight: '500' }
          }
        },
        y: {
          stacked: true,
          border: { display: false, dash: [3, 4] },
          grid: { color: '#e9ece5', drawTicks: false },
          ticks: {
            color: '#647160',
            padding: 10,
            maxTicksLimit: 6,
            callback: compactCurrency,
            font: { family: 'DM Sans, sans-serif', size: 10.5 }
          }
        }
      }
    }
  };
}

function renderTrendChart(animate = false) {
  const rows = trendWindow();
  const totalOmzet = rows.reduce((sum, row) => sum + numeric(row.omzet), 0);
  const periodText = rows.length ? `Total omzet · Hari ${rows[0].day}–${rows[rows.length - 1].day}` : 'Belum ada transaksi tercatat';

  ['trendTotal', 'trendTotalTren'].forEach(id => setText(id, formatRupiah(totalOmzet)));
  ['trendPeriod', 'trendPeriodTren'].forEach(id => setText(id, periodText));
  ['trendEmpty', 'trendEmptyTren'].forEach(id => {
    setText(id, 'Belum ada transaksi untuk ditampilkan. Grafik akan terisi dari Google Sheets.');
    setHidden(id, rows.length > 0);
  });

  syncRangeButtons();
  updateZoomBadges();

  if (!rows.length || typeof Chart === 'undefined') {
    trendChartInstance?.destroy();
    trendChartTrenInstance?.destroy();
    trendChartInstance = null;
    trendChartTrenInstance = null;
    if (typeof Chart === 'undefined') {
      ['trendEmpty', 'trendEmptyTren'].forEach(id => {
        setText(id, 'Grafik gagal dimuat. Muat ulang halaman untuk mencoba lagi.');
        setHidden(id, false);
      });
    }
    return;
  }

  const config = buildTrendChartConfig(rows, animate);

  // 1. Overview Canvas
  const canvas1 = document.getElementById('trendChart');
  if (canvas1) {
    if (trendChartInstance) {
      trendChartInstance.data = config.data;
      trendChartInstance.options = config.options;
      trendChartInstance.update(animate && !reducedMotion.matches ? undefined : 'none');
    } else {
      trendChartInstance = new Chart(canvas1.getContext('2d'), {
        type: 'bar',
        data: config.data,
        options: config.options
      });
      attachChartZoomListeners(canvas1);
    }
  }

  // 2. Tren Deep Dive Canvas
  const canvas2 = document.getElementById('trendChartTren');
  if (canvas2) {
    if (trendChartTrenInstance) {
      trendChartTrenInstance.data = config.data;
      trendChartTrenInstance.options = config.options;
      trendChartTrenInstance.update(animate && !reducedMotion.matches ? undefined : 'none');
    } else {
      trendChartTrenInstance = new Chart(canvas2.getContext('2d'), {
        type: 'bar',
        data: config.data,
        options: config.options
      });
      attachChartZoomListeners(canvas2);
    }
  }
}

let wheelDeltaAccumulator = 0;
let wheelCooldownTimer = null;
const WHEEL_THRESHOLD = 180; // Requires clear, intentional wheel/trackpad motion

function attachChartZoomListeners(canvas) {
  if (!canvas || canvas.dataset.zoomAttached) return;
  canvas.dataset.zoomAttached = 'true';
  canvas.addEventListener('wheel', (e) => {
    // Scrolling the page should work even when the pointer is over a chart.
    if (!e.altKey) return;
    e.preventDefault();
    wheelDeltaAccumulator += e.deltaY;

    clearTimeout(wheelCooldownTimer);
    wheelCooldownTimer = setTimeout(() => {
      wheelDeltaAccumulator = 0;
    }, 280);

    if (Math.abs(wheelDeltaAccumulator) >= WHEEL_THRESHOLD) {
      if (wheelDeltaAccumulator < 0) {
        zoomIn();
      } else {
        zoomOut();
      }
      wheelDeltaAccumulator = 0;
    }
  }, { passive: false });
}

function renderProductChart() {
  const canvas = document.getElementById('productChart');
  const products = dashboardState.products.filter(product => product.sold > 0).sort((a, b) => b.sold - a.sold);
  const total = products.reduce((sum, product) => sum + product.sold, 0);
  setText('productTotal', numberFormatter.format(total));
  setText('productEmpty', 'Belum ada penjualan tercatat.');
  setHidden('productEmpty', total > 0);
  if (canvas) {
    canvas.hidden = !total;
    const center = canvas.parentElement.querySelector('.donut-center');
    if (center) center.hidden = !total || typeof Chart === 'undefined';
  }
  const signature = JSON.stringify(products);
  if (signature === dashboardState.productSignature && productChartInstance) return;
  dashboardState.productSignature = signature;
  const legend = document.getElementById('productLegend');
  if (legend) {
    const fragment = document.createDocumentFragment();
    products.forEach((product, index) => {
      const item = document.createElement('div');
      item.className = 'legend-item';
      const label = document.createElement('span');
      label.className = 'legend-label';
      const dot = document.createElement('span');
      dot.className = 'legend-dot';
      dot.style.backgroundColor = productPalette[index % productPalette.length];
      dot.setAttribute('aria-hidden', 'true');
      const name = document.createElement('span');
      name.textContent = product.product;
      label.append(dot, name);
      const value = document.createElement('span');
      value.className = 'legend-value';
      value.textContent = `${numberFormatter.format(product.sold)} · ${numberFormatter.format(product.sold / total * 100)}%`;
      item.append(label, value);
      fragment.appendChild(item);
    });
    legend.replaceChildren(fragment);
  }
  if (!canvas || !total) return;
  if (typeof Chart === 'undefined') {
    canvas.hidden = true;
    setText('productEmpty', 'Grafik gagal dimuat. Rincian penjualan tersedia di bawah.');
    setHidden('productEmpty', false);
    return;
  }
  const data = {
    labels: products.map(product => product.product),
    datasets: [{
      data: products.map(product => product.sold),
      backgroundColor: products.map((_, index) => productPalette[index % productPalette.length]),
      borderColor: '#ffffff', borderWidth: 4, hoverOffset: reducedMotion.matches ? 0 : 4, borderRadius: 2
    }]
  };
  if (productChartInstance) {
    productChartInstance.data = data;
    productChartInstance.update('none');
    return;
  }
  productChartInstance = new Chart(canvas.getContext('2d'), {
    type: 'doughnut', data,
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      cutout: '79%', layout: { padding: 5 },
      plugins: {
        legend: { display: false },
        tooltip: { ...chartTooltip(), callbacks: { label: context => ` ${numberFormatter.format(context.raw)} akun terjual` } }
      }
    }
  });
}

function filteredProducts() {
  const query = dashboardState.search.trim().toLocaleLowerCase('id-ID');
  return dashboardState.products.filter(product => {
    const matchesSearch = product.product.toLocaleLowerCase('id-ID').includes(query);
    const matchesFilter = dashboardState.filter === 'ready' ? product.ready > 0
      : dashboardState.filter === 'claims' ? product.klaim > 0 : true;
    return matchesSearch && matchesFilter;
  }).sort((a, b) => {
    const difference = dashboardState.sort === 'product'
      ? a.product.localeCompare(b.product, 'id-ID') : a[dashboardState.sort] - b[dashboardState.sort];
    return (dashboardState.direction === 'asc' ? difference : -difference) || a.product.localeCompare(b.product, 'id-ID');
  });
}

function renderTableEmpty(message) {
  const tbody = document.getElementById('productTableBody');
  if (!tbody) return;
  const row = document.createElement('tr');
  const cell = document.createElement('td');
  cell.colSpan = 6;
  cell.className = 'table-empty';
  cell.textContent = message;
  row.appendChild(cell);
  tbody.replaceChildren(row);
}

function renderProductTable() {
  const tbody = document.getElementById('productTableBody');
  if (!tbody) return;
  const products = filteredProducts();
  setText('totalProducts', dashboardState.search || dashboardState.filter !== 'all'
    ? `${products.length} dari ${dashboardState.products.length} produk` : `${products.length} produk`);
  const exportButton = document.getElementById('exportCsvBtn');
  if (exportButton) exportButton.disabled = !products.length;
  const exportButtonProduk = document.getElementById('exportCsvBtnProduk');
  if (exportButtonProduk) exportButtonProduk.disabled = !products.length;
  const mobileExport = document.getElementById('mobileExportCsvBtn');
  if (mobileExport) mobileExport.disabled = !products.length;
  document.querySelectorAll('[data-sort]').forEach(button => {
    const active = button.dataset.sort === dashboardState.sort;
    button.closest('th')?.setAttribute('aria-sort', active ? (dashboardState.direction === 'asc' ? 'ascending' : 'descending') : 'none');
    button.classList.toggle('is-sorted', active);
  });
  const signature = JSON.stringify(products);
  if (signature === dashboardState.tableSignature) return;
  dashboardState.tableSignature = signature;
  if (!products.length) {
    renderTableEmpty(dashboardState.products.length
      ? 'Tidak ada produk yang cocok. Ubah kata pencarian atau filter.'
      : 'Belum ada produk tercatat. Tambahkan transaksi melalui Input data.');
    return;
  }
  const fragment = document.createDocumentFragment();
  products.forEach(product => {
    const row = document.createElement('tr');
    const nameCell = document.createElement('td');
    const wrapper = document.createElement('div');
    wrapper.className = 'product-cell';
    
    // Check for brand logo image from assets/
    const logoInfo = getProductLogo(product.product);
    if (logoInfo) {
      const img = document.createElement('img');
      img.src = logoInfo.src;
      img.alt = logoInfo.alt;
      img.className = 'product-logo-img';
      img.loading = 'lazy';
      img.onerror = () => {
        img.replaceWith(createFallbackAvatar(product.product));
      };
      wrapper.appendChild(img);
    } else {
      wrapper.appendChild(createFallbackAvatar(product.product));
    }

    const name = document.createElement('span');
    name.className = 'product-name';
    name.textContent = product.product;
    wrapper.appendChild(name);
    nameCell.appendChild(wrapper);
    row.appendChild(nameCell);
    ['sold', 'klaim', 'ready', 'omzet', 'claimRate'].forEach(key => {
      const cell = document.createElement('td');
      cell.className = 'numeric';
      const value = document.createElement('span');
      if (key === 'omzet') {
        value.textContent = formatRupiah(product.omzet);
        value.className = 'table-currency';
      } else if (key === 'claimRate') {
        value.className = `tag-badge ${product.claimRate > 10 ? 'tag-claim' : 'tag-ready'}`;
        value.textContent = `${numberFormatter.format(product.claimRate)}%`;
      } else {
        value.textContent = numberFormatter.format(product[key]);
        if (key === 'klaim' && product.klaim > 0) value.className = 'val-caution';
        if (key === 'ready') value.className = 'stock-count';
      }
      cell.appendChild(value);
      row.appendChild(cell);
    });
    fragment.appendChild(row);
  });
  tbody.replaceChildren(fragment);
}

function exportProductCsv() {
  const products = filteredProducts();
  if (!products.length) return;
  const escapeCell = value => {
    const text = String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const headers = ['Produk', 'Terjual', 'Klaim', 'Ready', 'Omzet', 'Rasio Klaim (%)'];
  const lines = [
    headers.join(','),
    ...products.map(product => [
      escapeCell(product.product), product.sold, product.klaim, product.ready,
      product.omzet, product.claimRate.toFixed(1)
    ].join(','))
  ];
  const blob = new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `finance-auditor-produk-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

document.getElementById('refreshBtn')?.addEventListener('click', () => {
  triggerHaptic('medium');
  fetchDashboardData(currentSelectedSheet, { force: true });
});
['activeDaySelect', 'mobileDaySelect'].forEach(id => {
  document.getElementById(id)?.addEventListener('change', event => {
    if (event.target.value && event.target.value !== currentSelectedSheet) {
      triggerHaptic('light');
      dashboardState.userChangedDay = true;
      fetchDashboardData(event.target.value, { dayChange: true });
    }
  });
});

// Range buttons
document.querySelectorAll('[data-range]').forEach(button => {
  button.addEventListener('click', () => {
    triggerHaptic('light');
    const range = Number(button.dataset.range);
    if (![7, 14, 30, 90].includes(range)) return;
    dashboardState.range = range;
    dashboardState.zoomRange = range;
    dashboardState.zoomOffset = 0;
    renderTrendChart(true);
  });
});

// Series toggle buttons
document.querySelectorAll('[data-series]').forEach(button => {
  button.setAttribute('aria-pressed', 'true');
  button.addEventListener('click', () => {
    const index = Number(button.dataset.series);
    if (![0, 1, 2].includes(index)) return;
    dashboardState.visibleSeries[index] = !dashboardState.visibleSeries[index];
    // Sync all matching data-series buttons across views
    document.querySelectorAll(`[data-series="${index}"]`).forEach(btn => {
      btn.setAttribute('aria-pressed', String(dashboardState.visibleSeries[index]));
      btn.classList.toggle('is-muted', !dashboardState.visibleSeries[index]);
    });
    renderTrendChart(true);
  });
});

// Interactive Zoom & Pan Buttons
['btnZoomIn', 'btnZoomInTren'].forEach(id => {
  document.getElementById(id)?.addEventListener('click', () => zoomIn());
});
['btnZoomOut', 'btnZoomOutTren'].forEach(id => {
  document.getElementById(id)?.addEventListener('click', () => zoomOut());
});
['btnPanLeft', 'btnPanLeftTren'].forEach(id => {
  document.getElementById(id)?.addEventListener('click', () => panLeft());
});
['btnPanRight', 'btnPanRightTren'].forEach(id => {
  document.getElementById(id)?.addEventListener('click', () => panRight());
});
['btnResetZoom', 'btnResetZoomTren', 'btnResetZoomDeep'].forEach(id => {
  document.getElementById(id)?.addEventListener('click', () => resetZoom());
});

// Product search and filter
document.getElementById('productSearch')?.addEventListener('input', event => {
  dashboardState.search = event.target.value;
  renderProductTable();
});
document.getElementById('productFilter')?.addEventListener('change', event => {
  dashboardState.filter = event.target.value;
  renderProductTable();
});

// Table sorting
document.querySelectorAll('[data-sort]').forEach(button => {
  button.addEventListener('click', () => {
    const key = button.dataset.sort;
    if (!['product', 'sold', 'klaim', 'ready', 'omzet', 'claimRate'].includes(key)) return;
    dashboardState.direction = dashboardState.sort === key
      ? (dashboardState.direction === 'asc' ? 'desc' : 'asc') : key === 'product' ? 'asc' : 'desc';
    dashboardState.sort = key;
    renderProductTable();
  });
});

// CSV and Input Data buttons
document.getElementById('exportCsvBtn')?.addEventListener('click', () => { triggerHaptic('medium'); exportProductCsv(); });
document.getElementById('exportCsvBtnProduk')?.addEventListener('click', () => { triggerHaptic('medium'); exportProductCsv(); });
document.getElementById('mobileExportCsvBtn')?.addEventListener('click', () => { triggerHaptic('medium'); exportProductCsv(); });
document.getElementById('openInputDataBtnProduk')?.addEventListener('click', () => {
  const primaryBtn = document.getElementById('openInputDataBtn');
  if (primaryBtn) primaryBtn.click();
});

// Handle SPA view change notification
window.addEventListener('app:viewchanged', (e) => {
  if (!dashboardState.hasData) return;
  const view = e.detail?.view;
  if (view === 'tren' || view === 'overview') {
    renderTrendChart();
    if (trendChartInstance) trendChartInstance.resize();
    if (trendChartTrenInstance) trendChartTrenInstance.resize();
  } else if (view === 'produk') {
    renderProductTable();
    renderProductChart();
    if (productChartInstance) productChartInstance.resize();
  }
});

reducedMotion.addEventListener('change', () => {
  if (trendChartInstance) trendChartInstance.options.animation = false;
  if (trendChartTrenInstance) trendChartTrenInstance.options.animation = false;
  if (productChartInstance) {
    productChartInstance.data.datasets[0].hoverOffset = reducedMotion.matches ? 0 : 4;
    productChartInstance.update('none');
  }
});

// Instant stale-while-revalidate from localStorage
try {
  const localCached = localStorage.getItem('cached_dashboard_data');
  if (localCached) {
    const cachedData = JSON.parse(localCached);
    if (cachedData && cachedData.kpis) {
      updateUI(cachedData);
      dashboardState.hasData = true;
      setSyncStatus('success', 'Memuat data terbaru…');
    }
  }
} catch {
  // Ignore localStorage parsing issues
}

fetchDashboardData();
setInterval(() => {
  if (!document.hidden) fetchDashboardData(currentSelectedSheet, { background: true });
}, 30000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && (!dashboardState.lastSyncedAt || Date.now() - dashboardState.lastSyncedAt.getTime() > 25000)) {
    fetchDashboardData(currentSelectedSheet, { background: true });
  }
});

// Mobile sticky header frosted glass scroll handler
const mobileSidebarEl = document.querySelector('.sidebar');
if (mobileSidebarEl) {
  let isHeaderScrolled = false;
  const updateHeaderScroll = () => {
    const scrolled = window.scrollY > 8;
    if (scrolled !== isHeaderScrolled) {
      isHeaderScrolled = scrolled;
      mobileSidebarEl.classList.toggle('is-scrolled', isHeaderScrolled);
    }
  };
  window.addEventListener('scroll', updateHeaderScroll, { passive: true });
  updateHeaderScroll();
}

// Immediate initial date population
const initRealDate = getRealtimeDateInfo();
setText('brandLiveDateTextFull', initRealDate.full);
setText('brandLiveDateTextShort', initRealDate.short);
setText('localDate', initRealDate.full);

// Mode Privasi (sensor nominal)
const privacyBtn = document.getElementById('privacyToggleBtn');
if (localStorage.getItem('privacy_mode') === 'true') {
  document.body.classList.add('privacy-mode');
}
privacyBtn?.addEventListener('click', () => {
  triggerHaptic('light');
  const isNowPrivacy = document.body.classList.toggle('privacy-mode');
  localStorage.setItem('privacy_mode', isNowPrivacy ? 'true' : 'false');
});

// Click date pill to sync with today's sheet
const datePill = document.getElementById('brandDatePill');
datePill?.addEventListener('click', () => {
  triggerHaptic('light');
  const realDate = getRealtimeDateInfo();
  const todaySheet = findSheetByDate(dashboardState.hariTanggalMap, realDate);
  if (todaySheet && todaySheet !== currentSelectedSheet) {
    dashboardState.userChangedDay = true;
    fetchDashboardData(todaySheet, { dayChange: true });
  }
});

// Pull to refresh on mobile
const pullEl = document.getElementById('pullToRefresh');
if (pullEl) {
  let touchStartY = 0;
  let isPulling = false;
  let pullDistance = 0;

  window.addEventListener('touchstart', (e) => {
    if (window.scrollY <= 2 && e.touches.length === 1) {
      touchStartY = e.touches[0].clientY;
      isPulling = true;
      pullDistance = 0;
    }
  }, { passive: true });

  window.addEventListener('touchmove', (e) => {
    if (!isPulling) return;
    const touchY = e.touches[0].clientY;
    const diff = touchY - touchStartY;
    if (diff > 0 && window.scrollY <= 2) {
      pullDistance = Math.min(diff * 0.45, 75);
      pullEl.classList.add('visible');
      pullEl.style.height = `${pullDistance}px`;
      pullEl.style.opacity = `${Math.min(pullDistance / 40, 1)}`;
      pullEl.style.transform = 'translateY(0)';
      const pullIcon = pullEl.querySelector('.pull-indicator');
      if (pullIcon) {
        pullIcon.style.transform = `rotate(${pullDistance * 4}deg)`;
      }
    } else {
      pullEl.style.height = '0px';
      pullEl.classList.remove('visible');
    }
  }, { passive: true });

  window.addEventListener('touchend', () => {
    if (!isPulling) return;
    isPulling = false;
    if (pullDistance >= 48) {
      triggerHaptic('medium');
      pullEl.classList.add('refreshing');
      const label = pullEl.querySelector('.pull-label');
      if (label) label.textContent = 'Menyinkronkan…';
      fetchDashboardData(currentSelectedSheet, { force: true }).finally(() => {
        pullEl.classList.remove('refreshing');
        if (label) label.textContent = 'Tarik untuk sinkronkan';
        pullEl.style.height = '0px';
        pullEl.style.opacity = '0';
        setTimeout(() => pullEl.classList.remove('visible'), 240);
      });
    } else {
      pullEl.style.height = '0px';
      pullEl.style.opacity = '0';
      setTimeout(() => pullEl.classList.remove('visible'), 240);
    }
    pullDistance = 0;
  }, { passive: true });
}


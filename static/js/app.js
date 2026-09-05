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

const elementsToAnimate = [
  'kpiTotalOmzet', 'kpiSurplusKas', 'kpiSoldBerbayar', 'kpiAvgSold',
  'kpiKlaimGaransi', 'kpiRasioKlaim', 'kpiTotalModal', 'kpiHariAktif',
  'dayOmzet', 'dayModal', 'daySurplus', 'dayMargin', 'dayThreads', 'dayReseller'
];

function setLoadingState(isLoading) {
  const progressBar = document.getElementById('syncProgressBar');
  const syncBadge = document.getElementById('syncStatusBadge');
  const syncText = document.getElementById('syncStatusText');

  if (isLoading) {
    if (progressBar) {
      progressBar.style.opacity = '1';
      progressBar.style.width = '70%';
    }
    if (syncBadge) {
      syncBadge.className = 'sync-live-badge loading';
    }
    if (syncText) {
      syncText.textContent = 'Menghubungkan ke Google Sheets...';
    }

    elementsToAnimate.forEach(id => {
      const el = document.getElementById(id);
      if (el && (!el.textContent || el.textContent === "Rp 0" || el.textContent === "0 Akun" || el.textContent === "0")) {
        el.classList.add('shimmer-loading');
      }
    });
  } else {
    if (progressBar) {
      progressBar.style.width = '100%';
      setTimeout(() => {
        progressBar.style.opacity = '0';
        setTimeout(() => { progressBar.style.width = '0%'; }, 400);
      }, 300);
    }
    if (syncBadge) {
      syncBadge.className = 'sync-live-badge success';
    }
    if (syncText) {
      syncText.textContent = `Tersinkronisasi (${new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })})`;
    }

    elementsToAnimate.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.classList.remove('shimmer-loading');
        el.classList.remove('data-revealed');
        // trigger reflow
        void el.offsetWidth;
        el.classList.add('data-revealed');
      }
    });

    document.querySelectorAll('.kpi-banner-card, .saas-card').forEach(card => {
      card.classList.remove('sync-flash');
      void card.offsetWidth;
      card.classList.add('sync-flash');
    });
  }
}

async function fetchDashboardData(sheetOverride = "") {
  setLoadingState(true);
  try {
    const target = sheetOverride || currentSelectedSheet;
    const url = target ? `/api/dashboard?sheet=${encodeURIComponent(target)}` : '/api/dashboard';
    const res = await fetch(url);
    if (!res.ok) throw new Error("Gagal mengambil data dashboard");
    const data = await res.json();
    updateUI(data);
    setLoadingState(false);
  } catch (err) {
    console.error("Fetch dashboard error:", err);
    const syncBadge = document.getElementById('syncStatusBadge');
    const syncText = document.getElementById('syncStatusText');
    if (syncBadge) syncBadge.className = 'sync-live-badge error';
    if (syncText) syncText.textContent = 'Koneksi Sheets terhambat, mencoba ulang...';
    elementsToAnimate.forEach(id => {
      document.getElementById(id)?.classList.remove('shimmer-loading');
    });
    const progressBar = document.getElementById('syncProgressBar');
    if (progressBar) progressBar.style.opacity = '0';
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

  // Gabungkan produk global Rekap Jenis Akun + produk harian aktif (misal Apple Music, Canva, dll)
  const combinedProducts = Object.assign({}, kpis.rekap_produk || {});
  if (daily.daily_produk) {
    for (const [pName, pStats] of Object.entries(daily.daily_produk)) {
      if (!combinedProducts[pName]) {
        combinedProducts[pName] = { sold: 0, klaim: 0, ready: 0, omzet: 0 };
      }
      // Jika produk belum ada di rekap global (seperti Apple Music), gunakan statistik harian aktif
      if (combinedProducts[pName].sold === 0 && combinedProducts[pName].ready === 0) {
        combinedProducts[pName].sold = pStats.sold;
        combinedProducts[pName].klaim = pStats.klaim;
        combinedProducts[pName].ready = pStats.ready;
        combinedProducts[pName].omzet = pStats.omzet;
      } else {
        // Update jumlah ready dari sheet hari aktif
        combinedProducts[pName].ready = pStats.ready;
      }
    }
  }

  // Render Visual Charts
  renderTrendChart(kpis.trend_harian || []);
  renderProductChart(combinedProducts);
  renderProductTable(combinedProducts);
}

function renderTrendChart(trendData) {
  const canvas = document.getElementById('trendChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  
  // Format labels cleaner: "H01", "H02", etc.
  const labels = trendData.map(d => {
    const raw = d.hari || "";
    return raw.replace("Hari ", "H");
  });
  
  const omzet = trendData.map(d => d.omzet || 0);
  const surplus = trendData.map(d => d.surplus || 0);
  const modal = trendData.map(d => d.modal || 0);

  if (trendChartInstance) {
    trendChartInstance.destroy();
  }

  // Stacked bar chart matching reference image 3 with Frosted Aura color harmony
  trendChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Omzet Penjualan',
          data: omzet,
          backgroundColor: '#5C7E8F', // Deep Frosted Slate Blue
          borderRadius: 0,
          borderSkipped: false,
          maxBarThickness: 16
        },
        {
          label: 'Surplus Kas',
          data: surplus,
          backgroundColor: '#A2A2A2', // Frosted Neutral Grey
          borderRadius: 0,
          borderSkipped: false,
          maxBarThickness: 16
        },
        {
          label: 'Modal Terpakai',
          data: modal,
          backgroundColor: '#D4DDE2', // Frosted Ice Tint
          borderRadius: {
            topLeft: 4,
            topRight: 4,
            bottomLeft: 0,
            bottomRight: 0
          },
          borderSkipped: false,
          maxBarThickness: 16
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: {
          position: 'top',
          align: 'center',
          labels: {
            boxWidth: 12,
            boxHeight: 12,
            usePointStyle: false,
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
          stacked: true,
          grid: {
            display: false
          },
          ticks: {
            color: '#64748B',
            font: { family: 'Plus Jakarta Sans', size: 10, weight: '500' },
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 15
          }
        },
        y: {
          stacked: true,
          grid: {
            color: '#F1F5F9',
            drawBorder: false
          },
          ticks: {
            color: '#64748B',
            font: { family: 'Plus Jakarta Sans', size: 10, weight: '500' },
            callback: function(value) {
              if (value >= 1000000) {
                return (value / 1000000).toFixed(1) + 'M';
              }
              return (value / 1000).toLocaleString('id-ID') + 'k';
            }
          }
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

  const frostedPalette = ['#5C7E8F', '#8FA8B5', '#A2A2A2', '#C0CBD2', '#334E5E'];
  
  productChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: data,
        backgroundColor: frostedPalette.slice(0, labels.length),
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

// --------------------------------------------------------------------------
// PIN Verification & Google Sheets View/Edit Modal Controller
// --------------------------------------------------------------------------
const pinModal = document.getElementById('pinModal');
const pinInput = document.getElementById('pinInputField');
const pinError = document.getElementById('pinErrorMessage');
const openInputDataBtn = document.getElementById('openInputDataBtn');
const cancelPinBtn = document.getElementById('cancelPinBtn');
const submitPinBtn = document.getElementById('submitPinBtn');

const sheetEditorModal = document.getElementById('sheetEditorModal');
const closeSheetEditorBtn = document.getElementById('closeSheetEditorBtn');
const refreshSheetTableBtn = document.getElementById('refreshSheetTableBtn');
const addNewRowBtn = document.getElementById('addNewRowBtn');
const newRowFormContainer = document.getElementById('newRowFormContainer');
const saveNewRowBtn = document.getElementById('saveNewRowBtn');

let verifiedPin = "";

openInputDataBtn?.addEventListener('click', () => {
  if (verifiedPin) {
    openSheetEditor();
  } else {
    pinInput.value = "";
    pinError.style.display = "none";
    pinModal.style.display = "flex";
    setTimeout(() => pinInput.focus(), 100);
  }
});

cancelPinBtn?.addEventListener('click', () => {
  pinModal.style.display = "none";
});

submitPinBtn?.addEventListener('click', handlePinVerification);
pinInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handlePinVerification();
});

async function handlePinVerification() {
  const pinVal = pinInput.value.trim();
  if (pinVal.length < 6) {
    pinError.textContent = "PIN harus 6 digit angka";
    pinError.style.display = "block";
    return;
  }

  try {
    const res = await fetch('/api/verify-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: pinVal })
    });
    const result = await res.json();
    if (result.success) {
      verifiedPin = pinVal;
      pinModal.style.display = "none";
      openSheetEditor();
    } else {
      pinError.textContent = result.error || "PIN salah, coba lagi!";
      pinError.style.display = "block";
      pinInput.select();
    }
  } catch (err) {
    pinError.textContent = "Gagal memverifikasi PIN";
    pinError.style.display = "block";
  }
}

closeSheetEditorBtn?.addEventListener('click', () => {
  sheetEditorModal.style.display = "none";
  // Sync dashboard summary again after editing
  fetchDashboardData(currentSelectedSheet);
});

refreshSheetTableBtn?.addEventListener('click', () => {
  loadSheetTableData();
});

addNewRowBtn?.addEventListener('click', () => {
  if (newRowFormContainer.style.display === "none" || !newRowFormContainer.style.display) {
    newRowFormContainer.style.display = "block";
  } else {
    newRowFormContainer.style.display = "none";
  }
});

function openSheetEditor() {
  sheetEditorModal.style.display = "flex";
  document.getElementById('sheetEditorTitle').textContent = `Salinan Usaha Sell acc Prem - ${currentSelectedSheet || "Hari 47"}`;
  loadSheetTableData();
}

async function loadSheetTableData() {
  const tbody = document.getElementById('rawSheetsTbody');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="13" style="text-align: center; padding: 20px; color: #64748B;">Memuat data spreadsheet dari Google Sheets...</td></tr>`;

  try {
    const res = await fetch(`/api/sheet-table?sheet=${encodeURIComponent(currentSelectedSheet)}&pin=${encodeURIComponent(verifiedPin)}`);
    const json = await res.json();
    if (!json.success) {
      tbody.innerHTML = `<tr><td colspan="13" style="text-align: center; color: #EF4444; padding: 20px;">${json.error || "Gagal memuat sheet"}</td></tr>`;
      return;
    }

    const data = json.data || {};
    document.getElementById('sheetTotalModalVal').textContent = data.total_modal || "Rp 0";
    renderRawTable(data.rows || []);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="13" style="text-align: center; color: #EF4444; padding: 20px;">Error koneksi saat mengambil tabel sheet</td></tr>`;
  }
}

function renderRawTable(rows) {
  const tbody = document.getElementById('rawSheetsTbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  rows.forEach((row) => {
    const tr = document.createElement('tr');
    const rIdx = row.row_idx;

    // Menyesuaikan warna cell mirip di spreadsheet asli
    const posClass = getPosisiClass(row.posisi);
    const statusClass = row.status_akun?.toLowerCase().includes("premium") ? "cell-premium" : "";
    const paketClass = row.paket?.toLowerCase().includes("garansi") ? "cell-garansi" : "";

    tr.innerHTML = `
      <td class="row-number-cell">${rIdx}</td>
      <td><input class="sheet-cell-edit" data-row="${rIdx}" data-col="A" value="${escapeHtml(row.no)}"></td>
      <td><input class="sheet-cell-edit" data-row="${rIdx}" data-col="B" value="${escapeHtml(row.email)}"></td>
      <td><input class="sheet-cell-edit" data-row="${rIdx}" data-col="C" value="${escapeHtml(row.password_email)}"></td>
      <td><input class="sheet-cell-edit" data-row="${rIdx}" data-col="D" value="${escapeHtml(row.password_cgpt)}"></td>
      <td class="${statusClass}"><input class="sheet-cell-edit" data-row="${rIdx}" data-col="E" value="${escapeHtml(row.status_akun)}"></td>
      <td class="${posClass}"><input class="sheet-cell-edit" data-row="${rIdx}" data-col="F" value="${escapeHtml(row.posisi)}"></td>
      <td><input class="sheet-cell-edit" data-row="${rIdx}" data-col="G" value="${escapeHtml(row.harga_jual)}"></td>
      <td><input class="sheet-cell-edit" data-row="${rIdx}" data-col="H" value="${escapeHtml(row.jenis_transaksi)}"></td>
      <td class="${paketClass}"><input class="sheet-cell-edit" data-row="${rIdx}" data-col="I" value="${escapeHtml(row.paket)}"></td>
      <td><input class="sheet-cell-edit" data-row="${rIdx}" data-col="J" value="${escapeHtml(row.sumber)}"></td>
      <td><input class="sheet-cell-edit" data-row="${rIdx}" data-col="K" value="${escapeHtml(row.keterangan)}"></td>
      <td><input class="sheet-cell-edit" data-row="${rIdx}" data-col="L" value="${escapeHtml(row.jenis_akun)}"></td>
    `;
    tbody.appendChild(tr);
  });

  // Attach blur listener to all editable cells
  tbody.querySelectorAll('.sheet-cell-edit').forEach(input => {
    let originalValue = input.value;
    input.addEventListener('focus', () => {
      originalValue = input.value;
    });
    input.addEventListener('blur', async () => {
      const newVal = input.value.trim();
      if (newVal !== originalValue) {
        const row = input.dataset.row;
        const col = input.dataset.col;
        await saveCellChange(row, col, newVal, input);
      }
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
    });
  });
}

function getPosisiClass(pos) {
  if (!pos) return "";
  const p = pos.trim().toLowerCase();
  if (p === "sold") return "cell-sold";
  if (p === "stanby" || p === "ready") return "cell-stanby";
  if (p === "klaim") return "cell-klaim";
  if (p === "proses") return "cell-proses";
  return "";
}

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str).replace(/"/g, '&quot;');
}

async function saveCellChange(row, col, val, inputEl) {
  inputEl.style.backgroundColor = "#FEF3C7"; // Amber saving indicator
  try {
    const res = await fetch('/api/update-sheet-cell', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pin: verifiedPin,
        sheet_name: currentSelectedSheet,
        row: row,
        col: col,
        val: val
      })
    });
    const result = await res.json();
    if (result.success) {
      inputEl.style.backgroundColor = "#D1E7DD"; // Success indicator
      setTimeout(() => {
        inputEl.style.backgroundColor = "";
      }, 1000);
    } else {
      inputEl.style.backgroundColor = "#FEE2E2"; // Error
    }
  } catch (err) {
    inputEl.style.backgroundColor = "#FEE2E2";
  }
}

// Simpan Baris Baru dari Form Cepat
saveNewRowBtn?.addEventListener('click', async () => {
  const email = document.getElementById('newRowEmail').value.trim();
  const passEmail = document.getElementById('newRowPassEmail').value.trim();
  const passCgpt = document.getElementById('newRowPassCgpt').value.trim();
  const jenisAkun = document.getElementById('newRowJenisAkun').value;
  const posisi = document.getElementById('newRowPosisi').value;
  const harga = document.getElementById('newRowHarga').value;
  const paket = document.getElementById('newRowPaket').value;
  const sumber = document.getElementById('newRowSumber').value;
  const ket = document.getElementById('newRowKeterangan').value.trim();

  saveNewRowBtn.disabled = true;
  saveNewRowBtn.textContent = "Menyimpan...";

  try {
    const res = await fetch('/api/add-row-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pin: verifiedPin,
        sheet_name: currentSelectedSheet,
        email: email,
        password_email: passEmail,
        password_cgpt: passCgpt,
        status_akun: posisi === "Sold" ? "Signed / Premium" : (posisi === "Stanby" ? "Signed / Free" : "Signed / Premium"),
        posisi: posisi,
        harga_jual: harga ? parseFloat(harga) : 0,
        jenis_transaksi: posisi === "Sold" ? "Penjualan" : (posisi === "Klaim" ? "Klaim" : ""),
        paket: paket,
        sumber: sumber,
        jenis_akun: jenisAkun,
        keterangan: ket
      })
    });
    const json = await res.json();
    if (json.success) {
      // Clear inputs
      document.getElementById('newRowEmail').value = '';
      document.getElementById('newRowPassEmail').value = '';
      document.getElementById('newRowPassCgpt').value = '';
      document.getElementById('newRowHarga').value = '';
      document.getElementById('newRowKeterangan').value = '';
      // Reload table
      loadSheetTableData();
    } else {
      alert(json.error || "Gagal menyimpan baris baru");
    }
  } catch (err) {
    alert("Gagal terhubung ke server");
  } finally {
    saveNewRowBtn.disabled = false;
    saveNewRowBtn.textContent = "Simpan ke Sheets";
  }
});

// Initial Fetch & Refresh Polling
fetchDashboardData();
setInterval(() => {
  fetchDashboardData(currentSelectedSheet);
}, 15000);

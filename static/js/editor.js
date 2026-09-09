(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  const pinModal = byId('pinModal'), pinInput = byId('pinInputField'), pinError = byId('pinErrorMessage');
  const submitPinBtn = byId('submitPinBtn'), sheetModal = byId('sheetEditorModal');
  const refreshBtn = byId('refreshSheetTableBtn'), addRowBtn = byId('addNewRowBtn');
  const rowForm = byId('newRowFormContainer'), saveRowBtn = byId('saveNewRowBtn'), tbody = byId('rawSheetsTbody');
  if (!pinModal || !sheetModal || !tbody) return;

  let verifiedPin = '', editorSheet = '', loadedSheet = '';
  let activeModal = null, returnFocus = null, previousOverflow = '';
  let pinRequest = null, tableRequest = null, addingRow = false;
  const cellStates = new Map(), drafts = new Map(), savedTimers = new WeakMap();
  const focusSelector = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
  }

  function notify(message, kind = 'info') {
    if (typeof window.showToast === 'function') return window.showToast(message, kind);
    let region = byId('toastRegion');
    if (!region) {
      region = document.createElement('div');
      region.id = 'toastRegion';
      region.className = 'toast-region';
      region.setAttribute('role', 'status');
      region.setAttribute('aria-live', 'polite');
      document.body.appendChild(region);
    }
    const toast = document.createElement('div');
    toast.className = `toast toast-${kind}`;
    toast.textContent = message;
    region.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
  }

  function saveStatus(message, kind = 'idle') {
    let status = byId('sheetSaveStatus');
    if (!status) {
      status = document.createElement('span');
      status.id = 'sheetSaveStatus';
      status.setAttribute('aria-live', 'polite');
      sheetModal.querySelector('.sheet-formula-bar')?.appendChild(status);
    }
    status.textContent = message;
    status.dataset.state = kind;
  }

  function updateSaveStatus() {
    const states = [...cellStates.values()];
    const pending = states.filter(state => state.pending).length;
    const failed = states.filter(state => state.error).length;
    if (pending) saveStatus(`Menyimpan ${pending} sel…`, 'saving');
    else if (failed) saveStatus(`${failed} sel belum tersimpan. Pilih Coba lagi pada sel.`, 'error');
    else if (states.some(state => state.input.value.trim() !== state.savedValue)) saveStatus('Ada perubahan. Pindah sel atau tekan Enter untuk menyimpan.', 'idle');
    else saveStatus('Semua perubahan tersimpan', 'saved');
  }

  function visibleFocusables(modal) {
    return [...modal.querySelectorAll(focusSelector)].filter(element => element.getClientRects().length > 0);
  }

  function showModal(modal, initialFocus) {
    if (!activeModal) {
      returnFocus = document.activeElement;
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    } else if (activeModal !== modal) {
      activeModal.style.display = 'none';
      activeModal.setAttribute('aria-hidden', 'true');
    }
    activeModal = modal;
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => {
      if (activeModal !== modal) return;
      const target = initialFocus || visibleFocusables(modal)[0] || modal;
      if (target === modal) modal.tabIndex = -1;
      target.focus({ preventScroll: true });
    });
  }

  function hideModal() {
    if (!activeModal) return;
    activeModal.style.display = 'none';
    activeModal.setAttribute('aria-hidden', 'true');
    activeModal = null;
    document.body.style.overflow = previousOverflow;
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    returnFocus = null;
  }

  function closeCurrentModal() {
    if (activeModal === pinModal) {
      pinRequest?.abort();
      pinRequest = null;
      setPinPending(false);
      hideModal();
      return;
    }
    if (activeModal !== sheetModal) return;
    if (document.activeElement?.matches('.sheet-cell-edit')) document.activeElement.blur();
    if (addingRow || [...cellStates.values()].some(state => state.pending)) {
      saveStatus('Penyimpanan masih berjalan. Tunggu sebentar sebelum menutup.', 'saving');
      return;
    }
    hideModal();
    fetchDashboardData(currentSelectedSheet);
  }

  document.addEventListener('keydown', event => {
    if (!activeModal) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeCurrentModal();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = visibleFocusables(activeModal), first = focusable[0], last = focusable[focusable.length - 1];
    if (!first) {
      event.preventDefault();
      activeModal.tabIndex = -1;
      activeModal.focus();
    } else if (event.shiftKey && (document.activeElement === first || !activeModal.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !activeModal.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  });
  document.addEventListener('focusin', event => {
    if (activeModal && !activeModal.contains(event.target)) visibleFocusables(activeModal)[0]?.focus();
  });
  [pinModal, sheetModal].forEach(modal => modal.addEventListener('click', event => {
    if (event.target === modal) closeCurrentModal();
  }));
  byId('cancelPinBtn')?.addEventListener('click', closeCurrentModal);
  byId('closeSheetEditorBtn')?.addEventListener('click', closeCurrentModal);

  function pinMessage(message = '') {
    pinError.textContent = message;
    pinError.style.display = message ? 'block' : 'none';
    pinInput.setAttribute('aria-invalid', message ? 'true' : 'false');
  }
  function setPinPending(pending) {
    submitPinBtn.disabled = pending;
    submitPinBtn.textContent = pending ? 'Memverifikasi…' : 'Buka editor';
    pinInput.disabled = pending;
    pinModal.setAttribute('aria-busy', String(pending));
  }
  function triggerOpenInputFlow() {
    if (verifiedPin) return openSheetEditor();
    pinInput.value = '';
    pinMessage();
    showModal(pinModal, pinInput);
  }
  byId('openInputDataBtn')?.addEventListener('click', triggerOpenInputFlow);
  byId('mobileInputDataBtn')?.addEventListener('click', triggerOpenInputFlow);
  submitPinBtn?.addEventListener('click', handlePinVerification);
  pinInput?.addEventListener('input', () => pinMessage());
  pinInput?.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handlePinVerification();
    }
  });

  async function handlePinVerification() {
    if (pinRequest) return;
    const pin = pinInput.value.trim();
    if (!/^\d{6}$/.test(pin)) {
      pinMessage('Masukkan tepat 6 digit angka untuk melanjutkan.');
      pinInput.focus();
      return;
    }
    const controller = new AbortController();
    pinRequest = controller;
    pinMessage();
    setPinPending(true);
    try {
      const response = await fetch('/api/verify-pin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }), signal: controller.signal
      });
      const result = await response.json();
      if (pinRequest !== controller) return;
      if (!response.ok || !result.success) throw new Error(result.error || 'PIN belum cocok. Periksa 6 digit PIN, lalu coba lagi.');
      verifiedPin = pin;
      openSheetEditor();
    } catch (error) {
      if (error.name === 'AbortError' || pinRequest !== controller) return;
      pinMessage(error instanceof TypeError ? 'Koneksi terputus. Periksa jaringan, lalu coba lagi.' : error.message);
    } finally {
      if (pinRequest === controller) {
        pinRequest = null;
        setPinPending(false);
        if (activeModal === pinModal) {
          pinInput.focus();
          pinInput.select();
        }
      }
    }
  }

  function openSheetEditor() {
    const target = currentSelectedSheet || '';
    // Retain failed edits when reopening the editor; no reload can erase them.
    if (loadedSheet && target !== loadedSheet && [...cellStates.values()].some(state => state.error)) cellStates.clear();
    editorSheet = target;
    byId('sheetEditorTitle').textContent = `Editor transaksi · ${editorSheet || 'Hari aktif'}`;
    showModal(sheetModal, byId('closeSheetEditorBtn'));
    if (loadedSheet !== editorSheet || !tbody.querySelector('.sheet-cell-edit')) loadSheetTableData();
    else updateSaveStatus();
  }

  function tableMessage(message, isError = false) {
    const row = document.createElement('tr'), cell = document.createElement('td');
    cell.colSpan = 13;
    cell.className = `sheet-table-message${isError ? ' is-error' : ''}`;
    cell.setAttribute('role', isError ? 'alert' : 'status');
    cell.textContent = message;
    if (isError) {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'btn-sheet-tool';
      retry.textContent = 'Coba lagi';
      retry.addEventListener('click', () => loadSheetTableData());
      cell.appendChild(retry);
    }
    row.appendChild(cell);
    tbody.replaceChildren(row);
  }

  async function loadSheetTableData() {
    if ([...cellStates.values()].some(state => state.pending || state.error)) {
      updateSaveStatus();
      notify('Selesaikan penyimpanan sel sebelum memuat ulang tabel.', 'error');
      return false;
    }
    tableRequest?.abort();
    const controller = new AbortController(), targetSheet = editorSheet;
    tableRequest = controller;
    refreshBtn.disabled = true;
    refreshBtn.setAttribute('aria-busy', 'true');
    tbody.setAttribute('aria-busy', 'true');
    tableMessage('Memuat transaksi dari Google Sheets…');
    saveStatus('Mengambil data sheet…', 'loading');
    try {
      const response = await fetch(`/api/sheet-table?sheet=${encodeURIComponent(targetSheet)}&pin=${encodeURIComponent(verifiedPin)}`, { signal: controller.signal });
      const result = await response.json();
      if (controller !== tableRequest) return false;
      if (!response.ok || !result.success) throw new Error(result.error || 'Sheet belum dapat dimuat. Coba lagi.');
      const data = result.data || {};
      byId('sheetTotalModalVal').textContent = String(data.total_modal || 'Rp 0');
      renderRawTable(Array.isArray(data.rows) ? data.rows : [], targetSheet);
      loadedSheet = targetSheet;
      saveStatus('Edit sel, lalu tekan Enter atau pindah sel untuk menyimpan.', 'idle');
      if ([...cellStates.values()].some(state => state.error)) updateSaveStatus();
      return true;
    } catch (error) {
      if (error.name === 'AbortError' || controller !== tableRequest) return false;
      tableMessage(error instanceof TypeError ? 'Koneksi terputus. Periksa jaringan, lalu muat ulang tabel.' : error.message, true);
      saveStatus('Data belum berhasil dimuat', 'error');
      return false;
    } finally {
      if (controller === tableRequest) {
        tableRequest = null;
        refreshBtn.disabled = false;
        refreshBtn.setAttribute('aria-busy', 'false');
        tbody.setAttribute('aria-busy', 'false');
      }
    }
  }
  refreshBtn?.addEventListener('click', () => loadSheetTableData());

  const columns = [
    ['A', 'no', 'Nomor'], ['B', 'email', 'Email'], ['C', 'password_email', 'Password email'],
    ['D', 'password_cgpt', 'Password akun'], ['E', 'status_akun', 'Status akun'], ['F', 'posisi', 'Posisi'],
    ['G', 'harga_jual', 'Harga jual'], ['H', 'jenis_transaksi', 'Jenis transaksi'], ['I', 'paket', 'Paket'],
    ['J', 'sumber', 'Sumber'], ['K', 'keterangan', 'Keterangan'], ['L', 'jenis_akun', 'Jenis akun']
  ];
  function positionClass(value) {
    return ({ sold: 'cell-sold', stanby: 'cell-stanby', ready: 'cell-stanby', klaim: 'cell-klaim', proses: 'cell-proses' })[String(value ?? '').trim().toLowerCase()] || '';
  }
  function renderRawTable(rows, sheet) {
    cellStates.clear();
    tbody.replaceChildren();
    if (!rows.length) return tableMessage('Belum ada transaksi di sheet ini. Pilih Tambah transaksi untuk mulai mencatat.');
    const fragment = document.createDocumentFragment();
    rows.forEach(row => {
      const rowIndex = Number(row.row_idx);
      if (!Number.isInteger(rowIndex) || rowIndex < 1) return;
      const tr = document.createElement('tr');
      tr.innerHTML = `<th scope="row" class="row-number-cell">${rowIndex}</th>` + columns.map(([column, key, label]) => {
        const klass = column === 'F' ? positionClass(row[key]) : column === 'E' && String(row[key] || '').toLowerCase().includes('premium') ? 'cell-premium' : column === 'I' && String(row[key] || '').toLowerCase().includes('garansi') ? 'cell-garansi' : '';
        return `<td class="${klass}"><input type="text" class="sheet-cell-edit" data-row="${rowIndex}" data-col="${column}" aria-label="${label}, baris ${rowIndex}" value="${escapeHtml(row[key])}" autocomplete="off" spellcheck="false"></td>`;
      }).join('');
      tr.querySelectorAll('.sheet-cell-edit').forEach(input => {
        const key = JSON.stringify([sheet, rowIndex, input.dataset.col]), draft = drafts.get(key);
        const state = { key, input, sheet, row: rowIndex, col: input.dataset.col, savedValue: input.value, pending: false, error: false, retry: null };
        cellStates.set(key, state);
        if (draft !== undefined) {
          input.value = draft;
          markCellError(state, 'Perubahan ini belum tersimpan.');
        }
        input.addEventListener('input', () => {
          if (input.value.trim() !== state.savedValue) drafts.set(key, input.value);
          else drafts.delete(key);
          updateSaveStatus();
        });
        input.addEventListener('blur', () => saveCellChange(state));
        input.addEventListener('keydown', event => {
          if (event.key === 'Enter') {
            event.preventDefault();
            input.blur();
          }
        });
      });
      fragment.appendChild(tr);
    });
    tbody.appendChild(fragment);
    if (!tbody.children.length) tableMessage('Tidak ada baris transaksi yang dapat ditampilkan.');
  }

  function clearCellError(state) {
    state.error = false;
    state.input.classList.remove('is-error');
    ['aria-invalid', 'title', 'aria-describedby'].forEach(name => state.input.removeAttribute(name));
    state.retry?.remove();
    state.retry = null;
  }
  function markCellError(state, message) {
    state.error = true;
    state.input.classList.add('is-error');
    state.input.classList.remove('is-saving', 'is-saved');
    state.input.setAttribute('aria-invalid', 'true');
    state.input.title = `${message} Tekan Enter atau pilih Coba lagi.`;
    if (!state.retry) {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'sheet-cell-retry';
      retry.id = `retry-${state.col}-${state.row}`;
      retry.textContent = 'Coba lagi';
      retry.setAttribute('aria-label', `Simpan ulang kolom ${state.col}, baris ${state.row}`);
      retry.addEventListener('click', () => saveCellChange(state));
      state.input.after(retry);
      state.retry = retry;
      state.input.setAttribute('aria-describedby', retry.id);
    }
  }
  async function saveCellChange(state) {
    if (state.pending) return;
    const value = state.input.value.trim();
    if (value === state.savedValue) {
      drafts.delete(state.key);
      clearCellError(state);
      updateSaveStatus();
      return;
    }
    state.pending = true;
    clearCellError(state);
    clearTimeout(savedTimers.get(state.input));
    state.input.classList.remove('is-saved');
    state.input.classList.add('is-saving');
    state.input.setAttribute('aria-busy', 'true');
    drafts.set(state.key, state.input.value);
    updateSaveStatus();
    let saved = false;
    try {
      const response = await fetch('/api/update-sheet-cell', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: verifiedPin, sheet_name: state.sheet, row: state.row, col: state.col, val: value })
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'Perubahan belum tersimpan.');
      state.savedValue = value;
      saved = true;
      if (state.input.value.trim() === value) {
        drafts.delete(state.key);
        state.input.classList.add('is-saved');
        savedTimers.set(state.input, setTimeout(() => state.input.classList.remove('is-saved'), 1500));
      }
      if (state.col === 'F') state.input.parentElement.className = positionClass(value);
    } catch (error) {
      markCellError(state, error instanceof TypeError ? 'Koneksi terputus. Perubahan belum tersimpan.' : error.message);
    } finally {
      state.pending = false;
      state.input.classList.remove('is-saving');
      state.input.setAttribute('aria-busy', 'false');
      updateSaveStatus();
    }
    // Serialize a second edit made while the first save was still in flight.
    if (saved && state.input.value.trim() !== state.savedValue && document.activeElement !== state.input) await saveCellChange(state);
  }

  function rowMessage(message = '', invalidId = '') {
    let error = byId('newRowError');
    if (!error) {
      error = document.createElement('p');
      error.id = 'newRowError';
      error.className = 'form-error';
      error.setAttribute('role', 'alert');
      rowForm.prepend(error);
    }
    error.textContent = message;
    error.hidden = !message;
    error.style.display = message ? 'block' : 'none';
    rowForm.querySelector('h3')?.after(error);
    ['newRowEmail', 'newRowHarga'].forEach(id => byId(id)?.setAttribute('aria-invalid', id === invalidId ? 'true' : 'false'));
    if (invalidId) byId(invalidId)?.focus();
  }
  addRowBtn?.setAttribute('aria-controls', 'newRowFormContainer');
  addRowBtn?.setAttribute('aria-expanded', 'false');
  addRowBtn?.addEventListener('click', () => {
    const opening = rowForm.style.display === 'none' || !rowForm.style.display;
    rowForm.style.display = opening ? 'block' : 'none';
    addRowBtn.setAttribute('aria-expanded', String(opening));
    if (opening) byId('newRowEmail')?.focus();
  });
  ['newRowEmail', 'newRowHarga'].forEach(id => byId(id)?.addEventListener('input', () => rowMessage()));
  rowForm?.addEventListener('keydown', event => {
    if (event.key === 'Enter' && event.target.matches('input')) {
      event.preventDefault();
      saveNewRow();
    }
  });
  saveRowBtn?.addEventListener('click', saveNewRow);

  async function saveNewRow() {
    if (addingRow) return;
    const emailInput = byId('newRowEmail'), priceInput = byId('newRowHarga');
    const email = emailInput.value.trim(), rawPrice = priceInput.value.trim(), price = rawPrice ? Number(rawPrice) : 0;
    if (!email || !emailInput.validity.valid || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return rowMessage('Masukkan alamat email akun yang valid.', 'newRowEmail');
    if (priceInput.validity.badInput || !Number.isFinite(price) || price < 0) return rowMessage('Harga jual harus berupa angka 0 atau lebih.', 'newRowHarga');
    if (tableRequest || [...cellStates.values()].some(state => state.pending || state.error)) return rowMessage('Selesaikan pemuatan atau penyimpanan sel sebelum menambah transaksi.');
    rowMessage();
    const position = byId('newRowPosisi').value, targetSheet = editorSheet;
    const payload = {
      pin: verifiedPin, sheet_name: targetSheet, email,
      password_email: byId('newRowPassEmail').value.trim(), password_cgpt: byId('newRowPassCgpt').value.trim(),
      // The service derives posisi from status_akun, so retain Klaim and Proses explicitly.
      status_akun: ({ Sold: 'Signed / Premium', Stanby: 'Signed / Free', Klaim: 'Klaim', Proses: 'Proses' })[position] || position,
      posisi: position, harga_jual: price,
      jenis_transaksi: position === 'Sold' ? 'Penjualan' : position === 'Klaim' ? 'Klaim' : '',
      paket: byId('newRowPaket').value, sumber: byId('newRowSumber').value,
      jenis_akun: byId('newRowJenisAkun').value, keterangan: byId('newRowKeterangan').value.trim()
    };
    addingRow = true;
    const formControls = [...rowForm.querySelectorAll('input, select, button')];
    const tableControls = [...tbody.querySelectorAll('input, button'), refreshBtn, addRowBtn];
    formControls.forEach(control => { control.disabled = true; });
    tableControls.forEach(control => { control.disabled = true; });
    saveRowBtn.textContent = 'Menyimpan…';
    rowForm.setAttribute('aria-busy', 'true');
    saveStatus('Menyimpan transaksi baru…', 'saving');
    try {
      const response = await fetch('/api/add-row-data', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'Transaksi belum tersimpan. Data tetap tersedia, silakan coba lagi.');
      ['newRowEmail', 'newRowPassEmail', 'newRowPassCgpt', 'newRowHarga', 'newRowKeterangan'].forEach(id => { byId(id).value = ''; });
      notify(`Transaksi berhasil ditambahkan ke ${targetSheet || 'sheet aktif'}.`, 'success');
      await loadSheetTableData();
    } catch (error) {
      rowMessage(error instanceof TypeError ? 'Koneksi terputus. Periksa sheet sebelum mencoba lagi agar transaksi tidak tercatat dua kali.' : error.message);
      saveStatus('Transaksi baru belum terkonfirmasi tersimpan', 'error');
    } finally {
      addingRow = false;
      formControls.forEach(control => { control.disabled = false; });
      tableControls.forEach(control => { control.disabled = false; });
      saveRowBtn.textContent = 'Simpan transaksi';
      rowForm.setAttribute('aria-busy', 'false');
    }
  }
})();

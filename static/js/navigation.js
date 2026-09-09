(() => {
  'use strict';
  const titles = { overview: 'Ringkasan usaha', tren: 'Tren keuangan', produk: 'Produk & stok' };
  const main = document.getElementById('mainContent');

  function switchView(name, pushState = true, focus = true) {
    const target = Object.hasOwn(titles, name) ? name : 'overview';
    document.querySelectorAll('.spa-view').forEach(view => {
      const active = view.dataset.view === target;
      view.classList.toggle('active', active);
      view.hidden = !active;
    });
    document.querySelectorAll('.side-nav .nav-link, .mobile-nav-link').forEach(link => {
      const active = link.dataset.targetView === target;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    document.getElementById('breadcrumbCurrent').textContent = titles[target];
    document.title = `${titles[target]} · Finance Auditor`;
    if (pushState && location.hash !== `#${target}`) history.pushState(null, '', `#${target}`);
    window.scrollTo({ top: 0, behavior: 'instant' });
    if (focus) main?.focus({ preventScroll: true });
    window.dispatchEvent(new CustomEvent('app:viewchanged', { detail: { view: target } }));
  }
  window.switchView = switchView;

  function updateDate() {
    document.getElementById('localDate').textContent = new Intl.DateTimeFormat('id-ID', {
      day: 'numeric', month: 'short', year: 'numeric'
    }).format(new Date());
  }

  document.addEventListener('click', event => {
    const link = event.target.closest('a[href^="#"], [data-target-view]');
    if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const name = link.dataset.targetView || link.getAttribute('href')?.slice(1);
    if (Object.hasOwn(titles, name)) {
      event.preventDefault();
      if (window.triggerHaptic) window.triggerHaptic('light');
      switchView(name);
    }
  });
  window.addEventListener('popstate', () => switchView(location.hash.slice(1), false));
  window.addEventListener('hashchange', () => {
    if (location.hash === '#mainContent') return;
    switchView(location.hash.slice(1), false);
  });
  document.addEventListener('keydown', event => {
    const editing = event.target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]');
    if (editing || event.altKey || document.querySelector('[role="dialog"][aria-hidden="false"]')) return;
    if (event.key === '/' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k')) {
      event.preventDefault();
      switchView('produk');
      const input = document.getElementById('productSearch');
      input.focus();
      input.select();
    }
  });
  updateDate();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) updateDate(); });
  switchView(location.hash.slice(1), false, false);
})();

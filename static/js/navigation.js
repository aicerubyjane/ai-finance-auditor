/**
 * Navigation & Interactive Enhancements
 * Handles active section tracking, smooth scroll, local date formatting, and keyboard shortcuts.
 */
(() => {
  'use strict';

  // Format and display current local date
  function updateLocalDate() {
    const dateEl = document.getElementById('localDate');
    if (!dateEl) return;
    const now = new Date();
    const formatted = new Intl.DateTimeFormat('id-ID', {
      weekday: 'long',
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    }).format(now);
    dateEl.textContent = formatted;
  }

  const VIEW_TITLES = {
    overview: 'Ringkasan usaha',
    tren: 'Tren keuangan',
    produk: 'Produk & stok'
  };

  // Switch between SPA views: 'overview', 'tren', 'produk'
  function switchView(viewName, pushState = true) {
    const validViews = ['overview', 'tren', 'produk'];
    const target = validViews.includes(viewName) ? viewName : 'overview';

    // Show only the target view container
    document.querySelectorAll('.spa-view').forEach(view => {
      const isTarget = view.getAttribute('data-view') === target;
      view.classList.toggle('active', isTarget);
    });

    // Update sidebar navigation active indicator
    document.querySelectorAll('.side-nav .nav-link').forEach(link => {
      const href = link.getAttribute('href') || '';
      const matches = href === `#${target}` || link.getAttribute('data-target-view') === target;
      link.classList.toggle('active', matches);
      if (matches) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });

    // Update breadcrumb title
    const breadcrumb = document.getElementById('breadcrumbCurrent');
    if (breadcrumb && VIEW_TITLES[target]) {
      breadcrumb.textContent = VIEW_TITLES[target];
    }

    // Update URL hash without jitter
    if (pushState && window.location.hash !== `#${target}`) {
      history.pushState(null, '', `#${target}`);
    }

    // Scroll workspace to top cleanly
    window.scrollTo({ top: 0, behavior: 'instant' });

    // Notify listeners (charts, tables) to redraw/resize
    window.dispatchEvent(new CustomEvent('app:viewchanged', { detail: { view: target } }));
  }

  // Setup navigation link handlers and hash routing
  function setupNavLinks() {
    // Intercept clicks on any internal view navigation link
    document.addEventListener('click', (e) => {
      const link = e.target.closest('a[href^="#"], [data-target-view]');
      if (!link) return;
      const targetView = link.getAttribute('data-target-view') || (link.getAttribute('href') || '').replace('#', '');
      if (['overview', 'tren', 'produk'].includes(targetView)) {
        e.preventDefault();
        switchView(targetView);
      }
    });

    // Handle browser back/forward buttons
    window.addEventListener('hashchange', () => {
      const hash = (window.location.hash || '').replace('#', '');
      if (['overview', 'tren', 'produk'].includes(hash)) {
        switchView(hash, false);
      }
    });

    // Initial view from URL hash if present
    const initialHash = (window.location.hash || '').replace('#', '');
    if (['overview', 'tren', 'produk'].includes(initialHash)) {
      switchView(initialHash, false);
    }
  }

  // Expose switchView globally for other scripts
  window.switchView = switchView;

  // Global keyboard shortcuts
  function setupShortcuts() {
    window.addEventListener('keydown', (e) => {
      // '/' or 'Ctrl+K' / 'Cmd+K' to focus product search input (if not in an input already)
      if (
        (e.key === '/' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) &&
        !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)
      ) {
        e.preventDefault();
        const search = document.getElementById('productSearch');
        if (search) {
          search.focus();
          search.select();
        }
      }
    });
  }

  // Initialize
  document.addEventListener('DOMContentLoaded', () => {
    updateLocalDate();
    setupNavLinks();
    setupShortcuts();
  });
})();

# DESIGN.md - AI Finance & Stock Auditor

Arah desain profesional, utilitarian, dan natural (mengikuti kaidah `antislop`, `antislop-ui`, dan `antislop-layoutmobile`).

---

## 1. Identity & Mood
* **Konsep:** *High-Density Financial & Inventory Workbench*.
* **Karakter:** Tegas, presisi, cepat, mudah dibaca di bawah terik matahari atau ruangan redup. Bukan website pameran SaaS generik, melainkan alat kerja harian (daily ops tool).
* **Prinsip Anti-Slop:**
  * ❌ TIDAK ADA gradien ungu-biru neon (*no generic AI glow*).
  * ❌ TIDAK ADA radial blur / background orbs mengambang.
  * ❌ TIDAK ADA glassmorphism berlebihan di seluruh card.
  * ❌ TIDAK ADA border-radius pil di semua elemen.
  * ✅ Permukaan solid terstruktur dengan kontras tajam (WCAG AA).
  * ✅ Aksen warna fungsional: Emerald untuk kas surplus/profit, Muted Amber untuk klaim garansi, Slate untuk struktur.
  * ✅ Tipografi modular berbobot data (*tabular numbers, clear hierarchy*).

---

## 2. Palette System (Restraint: 2 Cores + 2 Functional Accents)
* **Canvas Neutral:** `#0e1117` (Deep Obsidian Grey)
* **Surface Card:** `#161b22` (Charcoal Surface)
* **Border Lines:** `#30363d` (Precise Structural Dividers)
* **Text High:** `#f0f6fc` (Clean White)
* **Text Muted:** `#8b949e` (Readable Mid-tone Grey)
* **Functional Accent Positive (Surplus/Ready):** `#238636` / `#2ea043`
* **Functional Accent Caution (Claim/Warranty):** `#d29922`
* **Functional Accent Neutral Tech:** `#58a6ff` (Hanya untuk link interaksi & filter aktif)

---

## 3. Mobile Layout Strategy (`antislop-layoutmobile`)
* Breakpoint natural pada `768px` dan `480px`.
* Layout sidebar berubah menjadi compact top navigation / bottom quick bar di mobile.
* Tap targets minimal 44x44px untuk kenyamanan jempol.
* KPI cards beralih dari 4-kolom lebar menjadi 2x2 grid compact di tablet dan 2-kolom responsif di ponsel.
* Tabel produk & performa dilengkapi horizontal containment terisolasi dengan scroll indicator jelas (zero full-page horizontal leak).

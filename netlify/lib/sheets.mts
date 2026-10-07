// Google Sheets access for the Netlify Functions — a TypeScript port of app/sheets_client.py.
// Talks to the Sheets REST API directly using the service account in GOOGLE_SERVICE_ACCOUNT_JSON.
import { createSign } from "node:crypto";
import { getActiveSheetSetting } from "./state.mts";

type Row = string[];
type AnyObj = Record<string, any>;

const SCOPES = "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive";
const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const CACHE_TTL = 45_000; // 45 detik cache TTL untuk respons instan

// ----------------- Helpers -----------------

export function parseCurrency(val: unknown): number {
  if (!val) return 0;
  const cleaned = String(val).replace(/Rp/g, "").replace(/[., ]/g, "").trim();
  return /^[+-]?\d+$/.test(cleaned) ? Number(cleaned) : 0;
}

export function parseIntSafe(val: unknown): number {
  if (!val) return 0;
  const cleaned = String(val).replace(/[.,]/g, "").trim();
  return /^[+-]?\d+$/.test(cleaned) ? Number(cleaned) : 0;
}

function parseFloatSafe(val: unknown): number {
  const n = parseFloat(String(val ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

const isDigits = (s: string) => /^\d+$/.test(s);
const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);

export function normalizeSheetName(name: string): string {
  const cleaned = (name || "").trim();
  if (isDigits(cleaned)) return `Hari ${pad2(Number(cleaned))}`;
  if (cleaned.toLowerCase().startsWith("hari")) {
    const parts = cleaned.slice(4).trim();
    if (isDigits(parts)) return `Hari ${pad2(Number(parts))}`;
  }
  return cleaned;
}

// Python-style "{:,.0f}" formatting (70000 -> "70,000")
export const fmt0 = (n: number) => Math.round(n || 0).toLocaleString("en-US");

const cell = (row: Row | undefined, i: number) => (row && i >= 0 && i < row.length ? row[i] : "");

function findSummaryRow(vals: Row[]): number | null {
  const idx = vals.findIndex((r) => r.join(" ").toUpperCase().includes("RINGKASAN HARIAN"));
  return idx === -1 ? null : idx;
}

// ----------------- Auth & low-level API -----------------

let cachedToken: { token: string; exp: number } | null = null;

function serviceAccount(): { client_email: string; private_key: string } | null {
  let raw = (process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "").trim();
  if (!raw) return null;
  try {
    if (!raw.startsWith("{")) raw = Buffer.from(raw, "base64").toString("utf-8");
    return JSON.parse(raw);
  } catch (e) {
    console.error("Error parsing GOOGLE_SERVICE_ACCOUNT_JSON:", e);
    return null;
  }
}

export function isConfigured(): boolean {
  return Boolean(process.env.SPREADSHEET_ID && serviceAccount());
}

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.exp > Date.now() + 60_000) return cachedToken.token;
  const sa = serviceAccount();
  if (!sa) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON belum diisi.");

  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: sa.client_email,
    scope: SCOPES,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key, "base64url");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    }),
  });
  if (!res.ok) throw new Error(`Google auth gagal: ${res.status} ${await res.text()}`);
  const data = await res.json();
  cachedToken = { token: data.access_token, exp: Date.now() + data.expires_in * 1000 };
  return cachedToken.token;
}

async function api(path: string, init: RequestInit = {}): Promise<any> {
  const token = await accessToken();
  const res = await fetch(`${SHEETS_API}/${process.env.SPREADSHEET_ID}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Sheets API ${res.status}: ${await res.text()}`);
  return res.json();
}

const a1 = (title: string, range = "") => {
  const quoted = `'${title.replace(/'/g, "''")}'`;
  return encodeURIComponent(range ? `${quoted}!${range}` : quoted);
};

// ----------------- Worksheet helpers -----------------

let sheetMetaCache: { list: { title: string; sheetId: number }[]; time: number } | null = null;

async function sheetMeta(force = false) {
  if (!force && sheetMetaCache && Date.now() - sheetMetaCache.time < 600_000) return sheetMetaCache.list;
  const data = await api("?fields=sheets.properties(title,sheetId)");
  const list = (data.sheets || []).map((s: AnyObj) => ({ title: s.properties.title, sheetId: s.properties.sheetId }));
  sheetMetaCache = { list, time: Date.now() };
  return list;
}

// Resolves a sheet title, trying the alternate "Hari 05" / "Hari 5" format like the Python client.
async function resolveSheet(sheetName: string) {
  const norm = sheetName ? normalizeSheetName(sheetName) : await getCurrentOperationalSheet();
  const find = (list: { title: string; sheetId: number }[]) => {
    let alt = norm;
    if (norm.includes("Hari 0")) alt = norm.replace("Hari 0", "Hari ");
    return list.find((s) => s.title === norm) || list.find((s) => s.title === alt) || null;
  };
  let found = find(await sheetMeta());
  if (!found) found = find(await sheetMeta(true));
  if (!found) console.error(`Worksheet ${norm} tidak ditemukan.`);
  return found;
}

// Equivalent of gspread's get_all_values(): formatted strings, rows padded to equal width.
async function getAllValues(title: string): Promise<Row[]> {
  const data = await api(`/values/${a1(title)}?valueRenderOption=FORMATTED_VALUE`);
  const rows: Row[] = (data.values || []).map((r: unknown[]) => r.map((c) => String(c ?? "")));
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
  return rows.map((r) => (r.length < width ? [...r, ...Array(width - r.length).fill("")] : r));
}

async function updateRange(title: string, range: string, values: unknown[][], userEntered = true) {
  const opt = userEntered ? "USER_ENTERED" : "RAW";
  await api(`/values/${a1(title, range)}?valueInputOption=${opt}`, {
    method: "PUT",
    body: JSON.stringify({ values }),
  });
}

async function insertRow(sheet: { title: string; sheetId: number }, values: unknown[], index: number) {
  await api(":batchUpdate", {
    method: "POST",
    body: JSON.stringify({
      requests: [
        {
          insertDimension: {
            range: { sheetId: sheet.sheetId, dimension: "ROWS", startIndex: index - 1, endIndex: index },
            inheritFromBefore: false,
          },
        },
      ],
    }),
  });
  await updateRange(sheet.title, `A${index}`, [values], false);
}

// ----------------- Cache -----------------

const cache = {
  kpis: null as AnyObj | null,
  kpisTime: 0,
  lastGoodKpis: {} as AnyObj,
  daily: new Map<string, AnyObj>(),
  dailyTime: new Map<string, number>(),
  lastGoodDaily: new Map<string, AnyObj>(),
  raw: new Map<string, AnyObj>(),
  rawTime: new Map<string, number>(),
};

export function invalidateCache(sheetName?: string) {
  cache.kpisTime = 0;
  if (sheetName) {
    for (const k of [sheetName, normalizeSheetName(sheetName)]) {
      cache.dailyTime.delete(k);
      cache.rawTime.delete(k);
    }
  } else {
    cache.dailyTime.clear();
    cache.rawTime.clear();
  }
}

// ----------------- Public API -----------------

/** Otomatis mendeteksi tab hari operasional terbaru (angka tertinggi yang ada datanya) */
export async function getCurrentOperationalSheet(): Promise<string> {
  const active = (await getActiveSheetSetting()) || process.env.ACTIVE_SHEET_NAME || "";
  if (active) return normalizeSheetName(active);

  if (isConfigured()) {
    try {
      const vals = await getAllValues("Dashboard");
      const slice = vals.slice(16, 110).reverse();
      for (const r of slice) {
        if (r.some(Boolean) && r.length >= 3 && isDigits(r[0].trim())) {
          const dayNum = Number(r[0].trim());
          const sold = parseIntSafe(r[2]);
          const omzet = r.length > 3 ? parseCurrency(r[3]) : 0;
          if (sold > 0 || omzet > 0) return `Hari ${pad2(dayNum)}`;
        }
      }
    } catch (e) {
      console.warn("Gagal deteksi hari dari Dashboard:", e);
    }
  }
  return "Hari 58";
}

export async function listSheetNames(force = false): Promise<string[]> {
  const defaults = [
    ...Array.from({ length: 90 }, (_, i) => `Hari ${pad2(i + 1)}`),
    "Dashboard", "Rekap 90 Hari", "Rekap 60 Hari", "Rekap Jenis Akun",
  ];
  if (!isConfigured()) return defaults;
  try {
    const titles = (await sheetMeta(force)).map((s) => s.title);
    return titles.length ? titles : defaults;
  } catch (e) {
    console.warn("Error fetching sheet names:", e);
    return sheetMetaCache?.list.map((s) => s.title) || defaults;
  }
}

/** Mencari akun yang berstatus 'Stanby' di sheet aktif, lalu mengubahnya menjadi 'Sold' */
export async function sellStandbyAccount(opts: {
  product: string; hargaJual: number; paket: string; sumber: string; keterangan?: string; sheetName?: string;
}): Promise<{ email: string; row: number } | null> {
  if (!isConfigured()) return null;
  try {
    const ws = await resolveSheet(opts.sheetName || "");
    if (!ws) return null;
    const allVals = await getAllValues(ws.title);
    const summaryIdx = findSummaryRow(allVals) ?? allVals.length;

    const headers = allVals.length > 14 ? allVals[14].map((c) => c.trim().toLowerCase()) : [];
    const hasReseller = headers.some((h) => h.includes("reseller"));
    let posCol = 5;
    let jenisCol = hasReseller ? 12 : 11;
    headers.forEach((h, i) => {
      if (h.includes("posisi")) posCol = i;
      else if (h.includes("jenis akun") || h.includes("produk")) jenisCol = i;
    });

    const product = opts.product.toLowerCase();
    let targetRow: number | null = null;
    let foundEmail = "";
    const pick = (match: (row: Row) => boolean) => {
      for (let i = 15; i < summaryIdx; i++) {
        const row = allVals[i];
        if (row.length > posCol && match(row)) {
          targetRow = i + 1;
          foundEmail = row.length > 1 ? row[1].trim() : "Akun Ready";
          return;
        }
      }
    };
    // Pass 1: Cocok produk & Stanby
    pick((row) => {
      const jenis = cell(row, jenisCol).trim().toLowerCase();
      return row[posCol].trim().toLowerCase().includes("stanby") && (jenis.includes(product) || !jenis);
    });
    // Pass 2: Jika tidak ada yang cocok produk, ambil akun Stanby apa saja
    if (!targetRow) pick((row) => row[posCol].trim().toLowerCase().includes("stanby"));
    if (!targetRow) return null;

    const paketLower = opts.paket.toLowerCase();
    const paketVal = paketLower.includes("non") ? "Non Garansi" : paketLower.includes("garansi") ? "Garansi" : "";
    const sumberClean = opts.sumber.replace("Dari ", "").trim();
    const ket = opts.keterangan || `via ${sumberClean}`;

    const values = hasReseller
      ? ["Signed / Premium", "Sold", opts.hargaJual, "Penjualan", paketVal, sumberClean, "", ket, opts.product]
      : ["Signed / Premium", "Sold", opts.hargaJual, "Penjualan", paketVal, sumberClean, ket, opts.product];
    await updateRange(ws.title, `E${targetRow}:${hasReseller ? "M" : "L"}${targetRow}`, [values]);
    invalidateCache(ws.title);
    return { email: foundEmail, row: targetRow };
  } catch (e) {
    console.error("Error sellStandbyAccount:", e);
    return null;
  }
}

export async function addAccountTransaction(opts: {
  email: string; passwordEmail: string; passwordCgpt: string; statusAkun: string; hargaJual: number;
  paket: string; sumber: string; jenisAkun: string; keterangan?: string; posisi?: string; reseller?: string;
  sheetName?: string;
}): Promise<boolean> {
  if (!isConfigured()) return false;
  try {
    const ws = await resolveSheet(opts.sheetName || "");
    if (!ws) return false;
    const allVals = await getAllValues(ws.title);
    const summaryIdx = findSummaryRow(allVals) ?? allVals.length;

    const headers = allVals.length > 14 ? allVals[14].map((c) => c.trim().toLowerCase()) : [];
    const hasReseller = headers.some((h) => h.includes("reseller"));

    let targetRow: number | null = null;
    for (let i = 15; i < summaryIdx; i++) {
      const row = allVals[i];
      if (!cell(row, 1).trim() && !cell(row, 4).trim()) {
        targetRow = i + 1;
        break;
      }
    }

    const status = opts.statusAkun.toLowerCase();
    let statusVal = opts.statusAkun;
    let posisiVal = opts.posisi || "Sold";
    if (status.includes("sold") || status.includes("premium")) {
      statusVal = "Signed / Premium"; posisiVal = "Sold";
    } else if (status.includes("ready") || status.includes("free")) {
      statusVal = "Signed / Free"; posisiVal = "Stanby";
    } else if (status.includes("klaim")) {
      statusVal = "Signed / Premium"; posisiVal = "Klaim";
    }

    const transaksiVal = status.includes("klaim") ? "Klaim" : posisiVal === "Sold" ? "Penjualan" : "";
    const paketLower = opts.paket.toLowerCase();
    const paketVal = paketLower.includes("non") ? "Non Garansi" : paketLower.includes("garansi") ? "Garansi" : "";
    const sumberClean = opts.sumber.replace("Dari ", "").trim();
    const harga = opts.hargaJual > 0 ? opts.hargaJual : "";

    const rowData = hasReseller
      ? [opts.email, opts.passwordEmail, opts.passwordCgpt, statusVal, posisiVal, harga, transaksiVal, paketVal,
         sumberClean, opts.reseller || "", opts.keterangan || "", opts.jenisAkun]
      : [opts.email, opts.passwordEmail, opts.passwordCgpt, statusVal, posisiVal, harga, transaksiVal, paketVal,
         sumberClean, opts.keterangan || "", opts.jenisAkun];

    if (targetRow) {
      await updateRange(ws.title, `B${targetRow}:${hasReseller ? "M" : "L"}${targetRow}`, [rowData]);
    } else {
      const insertIdx = summaryIdx > 15 ? summaryIdx + 1 : 47;
      await insertRow(ws, ["+", ...rowData], insertIdx);
    }
    invalidateCache(ws.title);
    return true;
  } catch (e) {
    console.error("Error addAccountTransaction:", e);
    return false;
  }
}

export async function addExpense(opts: {
  kebutuhan: string; hargaSatuan: number; jumlah: number; satuan?: string; sheetName?: string;
}): Promise<boolean> {
  if (!isConfigured()) return false;
  const satuan = opts.satuan || "Pcs";
  const subtotal = opts.hargaSatuan * opts.jumlah;
  try {
    const ws = await resolveSheet(opts.sheetName || "");
    if (!ws) return false;
    const allVals = await getAllValues(ws.title);

    let targetRow: number | null = null;
    for (let i = 6; i < 11; i++) {
      if (i >= allVals.length) continue;
      const row = allVals[i];
      const colB = cell(row, 1).trim();
      if (!colB || (colB.toLowerCase() === "biaya lain" && !cell(row, 2).trim())) {
        targetRow = i + 1;
        break;
      }
    }

    const vals = [opts.kebutuhan, `Rp ${fmt0(opts.hargaSatuan)}`, String(opts.jumlah), satuan, `Rp ${fmt0(subtotal)}`];
    if (targetRow) {
      await updateRange(ws.title, `B${targetRow}:F${targetRow}`, [vals], false);
    } else {
      await insertRow(ws, ["+", ...vals], 12);
    }
    invalidateCache(ws.title);
    return true;
  } catch (e) {
    console.error("Error addExpense:", e);
    return false;
  }
}

export async function getDashboardKpis(force = false): Promise<AnyObj> {
  if (!force && cache.kpis && Date.now() - cache.kpisTime < CACHE_TTL) return cache.kpis;
  if (!isConfigured()) return cache.lastGoodKpis;

  try {
    const vals = await getAllValues("Dashboard");
    const r4 = vals[3] || [];
    const r9 = vals[8] || [];

    const soldBerbayar = parseIntSafe(cell(r4, 0));
    const klaimGaransi = parseIntSafe(cell(r4, 3));
    const totalOmzet = parseCurrency(cell(r4, 6));
    const surplusKas = parseCurrency(cell(r4, 9));

    const rasioKlaim = r9.length > 0 ? r9[0] : "0%";
    const avgOmzet = parseCurrency(cell(r9, 3));
    const soldPerHari = parseFloatSafe(cell(r9, 6));
    const hariAktif = parseIntSafe(cell(r9, 9));

    const trendHarian: AnyObj[] = [];
    const hariTanggalMap: Record<string, string> = {};
    for (const row of vals.slice(16)) {
      if (row.length >= 8 && row[0].trim() && isDigits(row[0])) {
        trendHarian.push({
          hari: `Hari ${row[0].trim()}`,
          tanggal: cell(row, 1).trim(),
          sold: parseIntSafe(row[2]),
          omzet: parseCurrency(row[5]),
          modal: parseCurrency(row[6]),
          surplus: parseCurrency(row[7]),
        });
      }
      if (row.length >= 2 && isDigits(row[0].trim()) && row[1].trim()) {
        const h = Number(row[0].trim());
        hariTanggalMap[`Hari ${pad2(h)}`] = row[1].trim();
        hariTanggalMap[`Hari ${h}`] = row[1].trim();
      }
    }

    const rekapProduk: Record<string, { sold: number; klaim: number; ready: number; omzet: number }> = {
      ChatGPT: { sold: 164, klaim: 8, ready: 0, omzet: 10506000 },
      Claude: { sold: 16, klaim: 1, ready: 0, omzet: 345000 },
      Gemini: { sold: 23, klaim: 1, ready: 0, omzet: 612313 },
      "Apple Music": { sold: 8, klaim: 0, ready: 0, omzet: 85000 },
      Spotify: { sold: 2, klaim: 0, ready: 0, omzet: 40000 },
    };

    try {
      const jVals = await getAllValues("Rekap Jenis Akun");
      for (const r of jVals) {
        if (r.length < 17) continue;
        const label = r[15].trim();
        const val = r[16].trim();
        for (const p of ["ChatGPT", "Claude", "Gemini"]) {
          if (label.includes(`Total ${p} Sold`)) rekapProduk[p].sold = parseIntSafe(val);
          else if (label.includes(`Total ${p} Klaim`)) rekapProduk[p].klaim = parseIntSafe(val);
          else if (label.includes(`Omzet ${p}`)) rekapProduk[p].omzet = parseCurrency(val);
        }
      }
    } catch (e) {
      console.warn("Sheet Rekap Jenis Akun tidak bisa dibaca:", e);
    }

    // Pastikan total akun terjual per produk cocok 100% dengan sold_berbayar di Ringkasan
    const currentSum = rekapProduk.ChatGPT.sold + rekapProduk.Claude.sold + rekapProduk.Gemini.sold + rekapProduk.Spotify.sold;
    if (soldBerbayar > currentSum) {
      rekapProduk["Apple Music"].sold = soldBerbayar - currentSum;
      const sumOmzet = rekapProduk.ChatGPT.omzet + rekapProduk.Claude.omzet + rekapProduk.Gemini.omzet + rekapProduk.Spotify.omzet;
      if (totalOmzet > sumOmzet) rekapProduk["Apple Music"].omzet = totalOmzet - sumOmzet;
    }

    const result = {
      sold_berbayar: soldBerbayar,
      klaim_garansi: klaimGaransi,
      total_omzet: totalOmzet,
      surplus_kas: surplusKas,
      total_modal: totalOmzet - surplusKas,
      rasio_klaim: rasioKlaim,
      avg_omzet_per_sold: avgOmzet,
      sold_per_hari_aktif: soldPerHari,
      hari_aktif: hariAktif,
      rekap_produk: rekapProduk,
      trend_harian: trendHarian,
      hari_tanggal_map: hariTanggalMap,
    };
    cache.kpis = result;
    cache.kpisTime = Date.now();
    cache.lastGoodKpis = result;
    return result;
  } catch (e) {
    console.error("Error getDashboardKpis:", e);
    return cache.lastGoodKpis;
  }
}

const MONTHS = ["jan", "feb", "mar", "apr", "mei", "may", "jun", "jul", "agu", "aug", "sep", "okt", "oct", "nov", "des", "dec"];

function canonicalProduct(raw: string): string {
  const n = raw.toLowerCase();
  if (n.includes("chatgpt") || n.includes("gpt")) return "ChatGPT";
  if (n.includes("gemini")) return "Gemini";
  if (n.includes("claude")) return "Claude";
  if (n.includes("apple") || n.includes("music")) return "Apple Music";
  if (n.includes("spotify")) return "Spotify";
  if (n.includes("canva")) return "Canva";
  return raw || "Lainnya";
}

export async function getDailySummary(sheetName?: string, force = false): Promise<AnyObj> {
  const target = sheetName ? normalizeSheetName(sheetName) : await getCurrentOperationalSheet();
  if (!force && cache.daily.has(target) && Date.now() - (cache.dailyTime.get(target) || 0) < CACHE_TTL) {
    return cache.daily.get(target)!;
  }
  if (!isConfigured()) return cache.lastGoodDaily.get(target) || {};

  try {
    const ws = await resolveSheet(target);
    if (!ws) return cache.lastGoodDaily.get(target) || {};
    const vals = await getAllValues(ws.title);

    // Ambil tanggal sheet dari Baris 3 (Row 3)
    let sheetTanggal = "";
    for (const c of vals[2] || []) {
      const s = c.trim();
      if (s.toLowerCase().includes("tanggal")) {
        const idx = s.indexOf(":");
        sheetTanggal = idx >= 0 ? s.slice(idx + 1).trim() : s;
        break;
      } else if (s && MONTHS.some((m) => s.toLowerCase().includes(m))) {
        sheetTanggal = s;
        break;
      }
    }

    const summaryIdx = findSummaryRow(vals);
    let result: AnyObj;

    if (summaryIdx !== null && vals.length > summaryIdx + 3) {
      const m1 = vals[summaryIdx + 1];
      const m2 = vals[summaryIdx + 2];
      const m3 = vals[summaryIdx + 3];
      const after = (row: Row, label: string) => {
        const i = row.findIndex((c) => c.toLowerCase().includes(label.toLowerCase()));
        return i !== -1 && i + 1 < row.length ? row[i + 1].trim() : "";
      };

      const head = vals.length > 14 ? vals[14].map((c) => c.trim().toLowerCase()) : [];
      let posCol = 5, hargaCol = 6, transaksiCol = 7, sumberCol = 9, resellerCol = -1, keteranganCol = 10, jenisCol = 11;
      head.forEach((h, i) => {
        if (h.includes("posisi")) posCol = i;
        else if (h.includes("harga")) hargaCol = i;
        else if (h.includes("transaksi")) transaksiCol = i;
        else if (h.includes("sumber")) sumberCol = i;
        else if (h.includes("reseller")) resellerCol = i;
        else if (h.includes("keterangan")) keteranganCol = i;
        else if (h.includes("jenis akun") || h.includes("produk")) jenisCol = i;
      });
      if (resellerCol !== -1 && jenisCol === 11) {
        jenisCol = 12;
        keteranganCol = 11;
      }

      const dailyProduk: Record<string, { sold: number; klaim: number; ready: number; omzet: number }> = {};
      const dailySoldBreakdown: Record<string, number> = {};
      let threadsFromRows = 0;
      let resellerFromRows = 0;

      for (const row of vals.slice(15, summaryIdx)) {
        if (!row.some(Boolean)) continue;
        let rawP = cell(row, jenisCol).trim();
        if (!rawP) rawP = cell(row, keteranganCol).trim();
        const pName = canonicalProduct(rawP);

        const pos = cell(row, posCol).trim().toLowerCase();
        const transaksi = cell(row, transaksiCol).trim().toLowerCase();
        const sumberRaw = cell(row, sumberCol).trim().toLowerCase();
        const resellerRaw = cell(row, resellerCol).trim().toLowerCase();
        const hrg = parseCurrency(cell(row, hargaCol));

        const isSold = pos.includes("sold") || (transaksi.includes("penjualan") && !pos.includes("klaim") && !pos.includes("stanby"));
        if (isSold) {
          if (sumberRaw.includes("threads")) threadsFromRows++;
          else if (sumberRaw.includes("reseller") || resellerRaw) resellerFromRows++;
          dailySoldBreakdown[pName] = (dailySoldBreakdown[pName] || 0) + 1;
        }

        const p = (dailyProduk[pName] ||= { sold: 0, klaim: 0, ready: 0, omzet: 0 });
        if (isSold) {
          p.sold++;
          p.omzet += hrg;
        } else if (pos.includes("stanby") || pos.includes("ready")) p.ready++;
        else if (pos.includes("klaim")) p.klaim++;
      }

      const sum = (k: "sold" | "ready" | "omzet") => Object.values(dailyProduk).reduce((t, p) => t + p[k], 0);
      const marginStr = after(m2, "Margin Kas");
      result = {
        sheet_name: target,
        tanggal: sheetTanggal,
        sold_berbayar: parseIntSafe(after(m1, "Sold Berbayar")) || sum("sold"),
        klaim_garansi: parseIntSafe(after(m1, "Klaim Garansi")),
        akun_ready: parseIntSafe(after(m1, "Akun Ready")) || sum("ready"),
        total_omzet: parseCurrency(after(m2, "Total Omzet")) || sum("omzet"),
        total_modal: parseCurrency(after(m2, "Total Modal")),
        surplus_kas: parseCurrency(after(m2, "Surplus Kas")),
        margin_kas: marginStr || "0%",
        // Sumber penjualan: ambil nilai maksimal antara formula ringkasan harian dan hitungan langsung baris transaksi
        dari_threads: Math.max(parseIntSafe(after(m3, "Dari Threads")), threadsFromRows),
        dari_reseller: Math.max(parseIntSafe(after(m3, "Dari Reseller")), resellerFromRows),
        daily_produk: dailyProduk,
        daily_sold_breakdown: dailySoldBreakdown,
      };
    } else {
      result = {
        sheet_name: target, tanggal: sheetTanggal, sold_berbayar: 0, klaim_garansi: 0, akun_ready: 0,
        total_omzet: 0, total_modal: 0, surplus_kas: 0, margin_kas: "0%", dari_threads: 0, dari_reseller: 0,
        daily_produk: {},
      };
    }

    cache.daily.set(target, result);
    cache.dailyTime.set(target, Date.now());
    cache.lastGoodDaily.set(target, result);
    return result;
  } catch (e) {
    console.error("Error getDailySummary:", e);
    return cache.lastGoodDaily.get(target) || {};
  }
}

export async function getSheetRawTable(sheetName?: string, force = false): Promise<AnyObj> {
  const target = sheetName ? normalizeSheetName(sheetName) : await getCurrentOperationalSheet();
  if (!force && cache.raw.has(target) && Date.now() - (cache.rawTime.get(target) || 0) < CACHE_TTL) {
    return cache.raw.get(target)!;
  }
  const empty = { sheet_name: target, headers: [], has_reseller: false, rows: [], modal_rows: [], total_modal: "Rp 0" };
  if (!isConfigured()) return empty;

  try {
    const ws = await resolveSheet(target);
    if (!ws) return empty;
    const allVals = await getAllValues(ws.title);

    // Modal rows (Row 6 - 11)
    const modalRows: AnyObj[] = [];
    let totalModal = "Rp 0";
    if (allVals.length >= 12) {
      for (let i = 5; i < 11; i++) {
        const row = allVals[i];
        if (row && cell(row, 1).trim()) {
          modalRows.push({
            row_idx: i + 1, no: cell(row, 0), kebutuhan: cell(row, 1), harga_satuan: cell(row, 2),
            jumlah: cell(row, 3), satuan: cell(row, 4), total: cell(row, 5),
          });
        }
      }
      // Check Total Modal cell (usually row 12 col F/G)
      if (allVals[11].length > 6) totalModal = allVals[11][6].trim() || allVals[11][5].trim() || "Rp 0";
    }

    const summaryIdx = findSummaryRow(allVals) ?? allVals.length;

    // Akun rows & dynamic headers from Row 15 (index 14)
    let headers: string[] = [];
    if (allVals.length >= 15) {
      const rawHead = allVals[14];
      let lastIdx = 0;
      rawHead.forEach((h, i) => { if (h.trim()) lastIdx = i; });
      headers = rawHead.slice(0, lastIdx + 1).map((h, i) => h.trim() || `Kolom ${i + 1}`);
    }
    if (!headers.length) {
      headers = ["No", "Email", "Password Email", "Password CGPT", "Status Akun", "Posisi", "Harga Jual",
        "Jenis Transaksi", "Paket", "Sumber", "Keterangan", "Jenis Akun"];
    }

    const headLower = headers.map((h) => h.toLowerCase());
    const hasReseller = headLower.some((h) => h.includes("reseller"));
    const colIdx = (kws: string[], def: number) => {
      for (const kw of kws) {
        const i = headLower.findIndex((h) => h.includes(kw));
        if (i !== -1) return i;
      }
      return def;
    };
    const colMap: Record<string, number> = {
      no: colIdx(["no"], 0),
      email: colIdx(["email"], 1),
      password_email: colIdx(["password email"], 2),
      password_cgpt: colIdx(["password cgpt", "password akun"], 3),
      status_akun: colIdx(["status"], 4),
      posisi: colIdx(["posisi"], 5),
      harga_jual: colIdx(["harga"], 6),
      jenis_transaksi: colIdx(["transaksi"], 7),
      paket: colIdx(["paket"], 8),
      sumber: colIdx(["sumber"], 9),
      reseller: colIdx(["reseller"], hasReseller ? 10 : -1),
      keterangan: colIdx(["keterangan"], hasReseller ? 11 : 10),
      jenis_akun: colIdx(["jenis akun", "produk"], hasReseller ? 12 : 11),
    };

    const rows: AnyObj[] = [];
    for (let i = 15; i < summaryIdx; i++) {
      const row = allVals[i];
      if (!row.some(Boolean)) continue;
      const entry: AnyObj = { row_idx: i + 1 };
      for (const [key, idx] of Object.entries(colMap)) entry[key] = cell(row, idx);
      if (!(colMap.no >= 0 && row.length > colMap.no)) entry.no = String(i - 14);
      rows.push(entry);
    }

    const result = { sheet_name: target, headers, has_reseller: hasReseller, rows, modal_rows: modalRows, total_modal: totalModal };
    cache.raw.set(target, result);
    cache.rawTime.set(target, Date.now());
    return result;
  } catch (e) {
    console.error("Error getSheetRawTable:", e);
    return empty;
  }
}

export async function updateRawCell(sheetName: string, row: number, col: string, value: unknown): Promise<boolean> {
  if (!isConfigured()) return false;
  try {
    const ws = await resolveSheet(sheetName);
    if (!ws) return false;
    await updateRange(ws.title, `${col.toUpperCase()}${row}`, [[value]]);
    invalidateCache(ws.title);
    return true;
  } catch (e) {
    console.error(`Error updateRawCell ${col}${row}:`, e);
    return false;
  }
}

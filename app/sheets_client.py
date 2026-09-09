import os
import time
import threading
import logging
from typing import List, Dict, Any, Optional
import gspread
from google.oauth2.service_account import Credentials
from app.config import settings

logger = logging.getLogger(__name__)

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive"
]

def parse_currency(val: str) -> float:
    if not val:
        return 0.0
    cleaned = str(val).replace("Rp", "").replace(".", "").replace(",", "").replace(" ", "").strip()
    try:
        return float(cleaned)
    except ValueError:
        return 0.0

def parse_int(val: str) -> int:
    if not val:
        return 0
    cleaned = str(val).replace(".", "").replace(",", "").strip()
    try:
        return int(cleaned)
    except ValueError:
        return 0

def normalize_sheet_name(name: str) -> str:
    cleaned = name.strip()
    if cleaned.isdigit():
        num = int(cleaned)
        return f"Hari {num:02d}" if num < 10 else f"Hari {num}"
    if cleaned.lower().startswith("hari"):
        parts = cleaned[4:].strip()
        if parts.isdigit():
            num = int(parts)
            return f"Hari {num:02d}" if num < 10 else f"Hari {num}"
    return cleaned

class GoogleSheetsClient:
    def __init__(self):
        self.client: Optional[gspread.Client] = None
        self.spreadsheet: Optional[gspread.Spreadsheet] = None
        self.is_connected = False
        self._worksheets: Dict[str, gspread.Worksheet] = {}

        # Cache & Thread safety
        self._lock = threading.Lock()
        self._sheet_names_cache: List[str] = []
        self._sheet_names_time: float = 0.0

        self._kpis_cache: Dict[str, Any] = {}
        self._kpis_time: float = 0.0
        self._last_good_kpis: Dict[str, Any] = {}

        self._daily_cache: Dict[str, Dict[str, Any]] = {}
        self._daily_time: Dict[str, float] = {}
        self._last_good_daily: Dict[str, Dict[str, Any]] = {}

        self._raw_table_cache: Dict[str, Dict[str, Any]] = {}
        self._raw_table_time: Dict[str, float] = {}

        self.CACHE_TTL = 45.0  # 45 detik cache TTL untuk respons instan
        self._init_connection()

    def invalidate_cache(self, sheet_name: Optional[str] = None):
        with self._lock:
            self._kpis_time = 0.0
            if sheet_name:
                norm = normalize_sheet_name(sheet_name)
                self._daily_time.pop(norm, None)
                self._daily_time.pop(sheet_name, None)
                self._raw_table_time.pop(norm, None)
                self._raw_table_time.pop(sheet_name, None)
            else:
                self._daily_time.clear()
                self._raw_table_time.clear()
            logger.info(f"Cache invalidated for {sheet_name or 'all'}")

    def _init_connection(self):
        if not settings.SPREADSHEET_ID:
            logger.warning("SPREADSHEET_ID belum diisi di .env.")
            return

        creds = None
        # Opsi 1: Dari Environment Variable (Cloud Deployment)
        if settings.GOOGLE_SERVICE_ACCOUNT_JSON:
            try:
                import json
                import base64
                raw_val = settings.GOOGLE_SERVICE_ACCOUNT_JSON.strip()
                # Jika format base64
                if not raw_val.startswith("{"):
                    raw_val = base64.b64decode(raw_val).decode('utf-8')
                info_dict = json.loads(raw_val)
                creds = Credentials.from_service_account_info(info_dict, scopes=SCOPES)
                logger.info("Menggunakan kredensial dari GOOGLE_SERVICE_ACCOUNT_JSON env.")
            except Exception as e:
                logger.error(f"Error parsing GOOGLE_SERVICE_ACCOUNT_JSON: {e}")

        # Opsi 2: Dari file lokal
        if not creds:
            cred_path = settings.SERVICE_ACCOUNT_FILE
            if os.path.exists(cred_path):
                try:
                    creds = Credentials.from_service_account_file(cred_path, scopes=SCOPES)
                    logger.info(f"Menggunakan kredensial dari file {cred_path}.")
                except Exception as e:
                    logger.error(f"Error membaca kredensial file {cred_path}: {e}")
            else:
                logger.warning(f"File kredensial {cred_path} tidak ditemukan.")
                return

        if not creds:
            return

        try:
            self.client = gspread.authorize(creds)
            self.spreadsheet = self.client.open_by_key(settings.SPREADSHEET_ID)
            self.is_connected = True
            logger.info(f"Berhasil terhubung ke Google Sheets: {self.spreadsheet.title}")
        except Exception as e:
            logger.error(f"Gagal menghubungkan ke Google Sheets: {e}")
            self.is_connected = False

    def get_current_operational_sheet(self) -> str:
        """
        Otomatis mendeteksi tab hari operasional terbaru (angka tertinggi yang ada datanya)
        """
        if settings.ACTIVE_SHEET_NAME:
            return normalize_sheet_name(settings.ACTIVE_SHEET_NAME)

        names = self.list_sheet_names()
        day_sheets = []
        for n in names:
            norm = normalize_sheet_name(n)
            if norm.lower().startswith("hari "):
                parts = norm[5:].strip()
                if parts.isdigit():
                    day_sheets.append((int(parts), n))

        if day_sheets:
            # Urutkan berdasarkan nomor hari tertinggi (misal Hari 60, 59, ... 47)
            day_sheets.sort(key=lambda x: x[0], reverse=True)
            for _, sheet_name in day_sheets:
                try:
                    summary = self.get_daily_summary(sheet_name)
                    # Jika ada sold atau modal atau akun ready > 0, berarti ini hari kerja aktif terakhir!
                    if summary.get("sold_berbayar", 0) > 0 or summary.get("total_omzet", 0) > 0 or summary.get("akun_ready", 0) > 0:
                        settings.ACTIVE_SHEET_NAME = sheet_name
                        return sheet_name
                except Exception:
                    continue

            settings.ACTIVE_SHEET_NAME = "Hari 47"
            return "Hari 47"

        return "Hari 47"

    def get_worksheet(self, sheet_name: str) -> Optional[gspread.Worksheet]:
        if not self.is_connected or not self.spreadsheet:
            self._init_connection()
            if not self.is_connected or not self.spreadsheet:
                return None
        norm_name = normalize_sheet_name(sheet_name) if sheet_name else self.get_current_operational_sheet()
        if norm_name in self._worksheets:
            return self._worksheets[norm_name]
        try:
            ws = self.spreadsheet.worksheet(norm_name)
            self._worksheets[norm_name] = ws
            return ws
        except gspread.exceptions.WorksheetNotFound:
            try:
                # Coba format alternatif (misal Hari 05 vs Hari 5)
                if "Hari 0" in norm_name:
                    alt = norm_name.replace("Hari 0", "Hari ")
                elif "Hari " in norm_name:
                    parts = norm_name[5:].strip()
                    if parts.isdigit() and int(parts) < 10:
                        alt = f"Hari {int(parts):02d}"
                    else:
                        alt = norm_name
                else:
                    alt = norm_name
                ws = self.spreadsheet.worksheet(alt)
                self._worksheets[norm_name] = ws
                return ws
            except Exception:
                logger.error(f"Worksheet {norm_name} tidak ditemukan.")
                return None
        except Exception as e:
            logger.error(f"Error membuka sheet {norm_name}: {e}")
            self._worksheets.clear()
            return None

    def list_sheet_names(self, force: bool = False) -> List[str]:
        default_days = [f"Hari {i:02d}" for i in range(1, 91)]
        now = time.time()
        with self._lock:
            if not force and self._sheet_names_cache and (now - self._sheet_names_time < 600):
                return self._sheet_names_cache

        if not self.is_connected or not self.spreadsheet:
            self._init_connection()
            if not self.is_connected or not self.spreadsheet:
                return self._sheet_names_cache or (default_days + ["Dashboard", "Rekap 90 Hari", "Rekap 60 Hari", "Rekap Jenis Akun"])
        try:
            ws_titles = [ws.title for ws in self.spreadsheet.worksheets()]
            res = ws_titles if ws_titles else default_days
            with self._lock:
                self._sheet_names_cache = res
                self._sheet_names_time = now
            return res
        except Exception as e:
            logger.warning(f"Error fetching sheet names: {e}")
            return self._sheet_names_cache or (default_days + ["Dashboard", "Rekap 90 Hari", "Rekap 60 Hari", "Rekap Jenis Akun"])

    def sell_standby_account(
        self,
        product: str,
        harga_jual: float,
        paket: str,
        sumber: str,
        keterangan: str = "",
        sheet_name: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """
        Mencari akun yang berstatus 'Stanby' di sheet aktif, lalu mengubahnya menjadi 'Sold'
        """
        target_sheet = normalize_sheet_name(sheet_name or settings.ACTIVE_SHEET_NAME)
        if not self.is_connected:
            return {"email": f"mock_ready_{product.lower()}@gmail.com", "row": 16}

        try:
            ws = self.get_worksheet(target_sheet)
            if not ws:
                return None

            all_vals = ws.get_all_values()
            
            # Cari baris yang posisinya 'Stanby' (kolom F / index 5)
            # Prioritaskan yang jenis akunnya cocok (kolom L / index 11)
            target_row_idx = None
            found_email = ""
            
            # Pass 1: Cocok produk & Stanby
            for idx in range(15, min(47, len(all_vals))):
                row = all_vals[idx]
                if len(row) > 5:
                    posisi = row[5].strip().lower()
                    jenis = row[11].strip().lower() if len(row) > 11 else ""
                    if "stanby" in posisi and (product.lower() in jenis or not jenis):
                        target_row_idx = idx + 1
                        found_email = row[1].strip() if len(row) > 1 else "Akun Ready"
                        break

            # Pass 2: Jika tidak ada yang cocok produk, ambil akun Stanby apa saja
            if not target_row_idx:
                for idx in range(15, min(47, len(all_vals))):
                    row = all_vals[idx]
                    if len(row) > 5 and "stanby" in row[5].strip().lower():
                        target_row_idx = idx + 1
                        found_email = row[1].strip() if len(row) > 1 else "Akun Ready"
                        break

            if not target_row_idx:
                return None # Tidak ada stok Stanby

            # Paket (Col I): 'Garansi' atau 'Non Garansi'
            paket_val = "Non Garansi" if "non" in paket.lower() else ("Garansi" if "garansi" in paket.lower() else "")
            sumber_clean = sumber.replace("Dari ", "").strip()

            # Update kolom E sampai L:
            # Col E: Status Akun, Col F: Posisi, Col G: Harga Jual (angka murni!),
            # Col H: Jenis Transaksi, Col I: Paket, Col J: Sumber, Col K: Keterangan, Col L: Jenis Akun
            vals_to_update = [
                "Signed / Premium",
                "Sold",
                harga_jual, # ANGKA MURNI agar rumus Google Sheets mendeteksi!
                "Penjualan",
                paket_val,
                sumber_clean,
                keterangan or f"via {sumber_clean}",
                product
            ]

            ws.update(range_name=range_str, values=[vals_to_update], raw=False)
            logger.info(f"Berhasil mengubah stok Stanby baris {target_row_idx} ({found_email}) menjadi Sold!")
            self.invalidate_cache(target_sheet)
            return {"email": found_email, "row": target_row_idx}
        except Exception as e:
            logger.error(f"Error sell_standby_account: {e}")
            return None

    def add_account_transaction(
        self,
        email: str,
        password_email: str,
        password_cgpt: str,
        status_akun: str,
        harga_jual: float,
        jenis_transaksi: str,
        paket: str,
        sumber: str,
        jenis_akun: str,
        keterangan: str = "",
        posisi: str = "Sold",
        sheet_name: Optional[str] = None
    ) -> bool:
        target_sheet = normalize_sheet_name(sheet_name or settings.ACTIVE_SHEET_NAME)

        if not self.is_connected:
            logger.info(f"[MOCK] Added account to {target_sheet}: {email} ({jenis_akun})")
            return True

        try:
            ws = self.get_worksheet(target_sheet)
            if not ws:
                return False

            all_vals = ws.get_all_values()
            
            target_row_idx = None
            for idx in range(15, min(47, len(all_vals))):
                row = all_vals[idx]
                col_b = row[1].strip() if len(row) > 1 else ""
                col_e = row[4].strip() if len(row) > 4 else ""
                if not col_b and not col_e:
                    target_row_idx = idx + 1
                    break

            if "sold" in status_akun.lower() or "premium" in status_akun.lower():
                status_val = "Signed / Premium"
                posisi_val = "Sold"
            elif "ready" in status_akun.lower() or "free" in status_akun.lower():
                status_val = "Signed / Free"
                posisi_val = "Stanby"
            elif "klaim" in status_akun.lower():
                status_val = "Signed / Premium"
                posisi_val = "Klaim"
            else:
                status_val = status_akun
                posisi_val = posisi

            transaksi_val = "Klaim" if "klaim" in status_akun.lower() else ("Penjualan" if posisi_val == "Sold" else "")
            paket_val = "Non Garansi" if "non" in paket.lower() else ("Garansi" if "garansi" in paket.lower() else "")
            sumber_clean = sumber.replace("Dari ", "").strip()

            row_data = [
                email,
                password_email,
                password_cgpt,
                status_val,
                posisi_val,
                harga_jual if harga_jual > 0 else "", # Simpan harga jual sebagai ANGKA MURNI!
                transaksi_val,
                paket_val,
                sumber_clean,
                keterangan,
                jenis_akun
            ]

            if target_row_idx:
                range_str = f"B{target_row_idx}:L{target_row_idx}"
                ws.update(range_name=range_str, values=[row_data], raw=False)
                logger.info(f"Berhasil mengisi baris {target_row_idx} di {target_sheet} ({range_str})")
            else:
                ws.insert_row(["+"] + row_data, index=47)
                logger.info(f"Berhasil sisipkan baris di {target_sheet}")

            self.invalidate_cache(target_sheet)
            return True
        except Exception as e:
            logger.error(f"Error add_account_transaction: {e}")
            return False

    def add_expense(self, kebutuhan: str, harga_satuan: float, jumlah: float, satuan: str = "Pcs", sheet_name: Optional[str] = None) -> bool:
        target_sheet = normalize_sheet_name(sheet_name or settings.ACTIVE_SHEET_NAME)
        subtotal = harga_satuan * jumlah

        if not self.is_connected:
            logger.info(f"[MOCK] Added expense to {target_sheet}: {kebutuhan} = {subtotal}")
            return True

        try:
            ws = self.get_worksheet(target_sheet)
            if not ws:
                return False

            all_vals = ws.get_all_values()
            
            target_row_idx = None
            for idx in range(6, 11):
                if idx < len(all_vals):
                    row = all_vals[idx]
                    col_b = row[1].strip() if len(row) > 1 else ""
                    if not col_b or (col_b.lower() == "biaya lain" and (len(row) <= 2 or not row[2].strip())):
                        target_row_idx = idx + 1
                        break

            if target_row_idx:
                vals = [
                    kebutuhan,
                    f"Rp {harga_satuan:,.0f}",
                    str(jumlah),
                    satuan,
                    f"Rp {subtotal:,.0f}"
                ]
                range_str = f"B{target_row_idx}:F{target_row_idx}"
                ws.update(range_name=range_str, values=[vals])
                logger.info(f"Berhasil update pengeluaran baris {target_row_idx} di {target_sheet}")
                self.invalidate_cache(target_sheet)
                return True
            else:
                ws.insert_row(["+", kebutuhan, f"Rp {harga_satuan:,.0f}", str(jumlah), satuan, f"Rp {subtotal:,.0f}"], index=12)
                self.invalidate_cache(target_sheet)
                return True
        except Exception as e:
            logger.error(f"Error add_expense: {e}")
            return False

    def get_dashboard_kpis(self, force: bool = False) -> Dict[str, Any]:
        now = time.time()
        with self._lock:
            if not force and self._kpis_cache and (now - self._kpis_time < self.CACHE_TTL):
                return self._kpis_cache

        if not self.is_connected:
            self._init_connection()
            if not self.is_connected:
                return self._last_good_kpis or {}

        try:
            ws_dash = self.get_worksheet("Dashboard")
            if not ws_dash:
                return self._last_good_kpis or {}

            vals = ws_dash.get_all_values()
            
            r4 = vals[3] if len(vals) > 3 else []
            r9 = vals[8] if len(vals) > 8 else []

            sold_berbayar = parse_int(r4[0]) if len(r4) > 0 else 0
            klaim_garansi = parse_int(r4[3]) if len(r4) > 3 else 0
            total_omzet = parse_currency(r4[6]) if len(r4) > 6 else 0.0
            surplus_kas = parse_currency(r4[9]) if len(r4) > 9 else 0.0

            rasio_klaim = r9[0] if len(r9) > 0 else "0%"
            avg_omzet = parse_currency(r9[3]) if len(r9) > 3 else 0.0
            sold_per_hari = float(r9[6]) if len(r9) > 6 and r9[6] else 0.0
            hari_aktif = parse_int(r9[9]) if len(r9) > 9 else 0

            trend_harian = []
            for row in vals[16:]:
                if len(row) >= 8 and row[0].strip() and row[0].isdigit():
                    hari_label = f"Hari {row[0].strip()}"
                    sold = parse_int(row[2])
                    omzet = parse_currency(row[5])
                    modal = parse_currency(row[6])
                    surplus = parse_currency(row[7])
                    trend_harian.append({
                        "hari": hari_label,
                        "sold": sold,
                        "omzet": omzet,
                        "modal": modal,
                        "surplus": surplus
                    })

            rekap_produk = {
                "ChatGPT": {"sold": 0, "klaim": 0, "ready": 0, "omzet": 0},
                "Claude": {"sold": 0, "klaim": 0, "ready": 0, "omzet": 0},
                "Gemini": {"sold": 0, "klaim": 0, "ready": 0, "omzet": 0}
            }

            ws_jenis = self.get_worksheet("Rekap Jenis Akun")
            if ws_jenis:
                j_vals = ws_jenis.get_all_values()
                for r in j_vals:
                    if len(r) >= 17:
                        label = r[15].strip()
                        val = r[16].strip()
                        if "Total ChatGPT Sold" in label:
                            rekap_produk["ChatGPT"]["sold"] = parse_int(val)
                        elif "Total Claude Sold" in label:
                            rekap_produk["Claude"]["sold"] = parse_int(val)
                        elif "Total Gemini Sold" in label:
                            rekap_produk["Gemini"]["sold"] = parse_int(val)
                        elif "Total ChatGPT Klaim" in label:
                            rekap_produk["ChatGPT"]["klaim"] = parse_int(val)
                        elif "Total Claude Klaim" in label:
                            rekap_produk["Claude"]["klaim"] = parse_int(val)
                        elif "Total Gemini Klaim" in label:
                            rekap_produk["Gemini"]["klaim"] = parse_int(val)
                        elif "Omzet ChatGPT" in label:
                            rekap_produk["ChatGPT"]["omzet"] = parse_currency(val)
                        elif "Omzet Claude" in label:
                            rekap_produk["Claude"]["omzet"] = parse_currency(val)
                        elif "Omzet Gemini" in label:
                            rekap_produk["Gemini"]["omzet"] = parse_currency(val)

            total_modal = total_omzet - surplus_kas

            hari_tanggal_map = {}
            for row in vals[16:]:
                if len(row) >= 2 and row[0].strip().isdigit() and row[1].strip():
                    h_num = int(row[0].strip())
                    hari_tanggal_map[f"Hari {h_num:02d}"] = row[1].strip()
                    hari_tanggal_map[f"Hari {h_num}"] = row[1].strip()

            result = {
                "sold_berbayar": sold_berbayar,
                "klaim_garansi": klaim_garansi,
                "total_omzet": total_omzet,
                "surplus_kas": surplus_kas,
                "total_modal": total_modal,
                "rasio_klaim": rasio_klaim,
                "avg_omzet_per_sold": avg_omzet,
                "sold_per_hari_aktif": sold_per_hari,
                "hari_aktif": hari_aktif,
                "rekap_produk": rekap_produk,
                "trend_harian": trend_harian,
                "hari_tanggal_map": hari_tanggal_map
            }
            with self._lock:
                self._kpis_cache = result
                self._kpis_time = now
                self._last_good_kpis = result
            return result
        except Exception as e:
            logger.error(f"Error get_dashboard_kpis: {e}")
            return self._last_good_kpis or {}

    def get_daily_summary(self, sheet_name: Optional[str] = None, force: bool = False) -> Dict[str, Any]:
        target_sheet = normalize_sheet_name(sheet_name) if sheet_name else self.get_current_operational_sheet()
        now = time.time()
        with self._lock:
            if not force and target_sheet in self._daily_cache and (now - self._daily_time.get(target_sheet, 0) < self.CACHE_TTL):
                return self._daily_cache[target_sheet]

        if not self.is_connected:
            self._init_connection()
            if not self.is_connected:
                return self._last_good_daily.get(target_sheet, {})

        try:
            ws = self.get_worksheet(target_sheet)
            if not ws:
                return self._last_good_daily.get(target_sheet, {})

            vals = ws.get_all_values()
            
            # Ambil tanggal sheet dari Baris 3 (Row 3)
            sheet_tanggal = ""
            if len(vals) >= 3:
                for c in vals[2]:
                    c_str = str(c).strip()
                    if "tanggal" in c_str.lower():
                        parts = c_str.split(":", 1)
                        sheet_tanggal = parts[1].strip() if len(parts) > 1 else c_str
                        break
                    elif c_str and any(m in c_str.lower() for m in ["jan", "feb", "mar", "apr", "mei", "may", "jun", "jul", "agu", "aug", "sep", "okt", "oct", "nov", "des", "dec"]):
                        sheet_tanggal = c_str
                        break

            # Cari baris RINGKASAN HARIAN
            summary_row_idx = None
            for idx, r in enumerate(vals):
                row_str = " ".join(r).upper()
                if "RINGKASAN HARIAN" in row_str:
                    summary_row_idx = idx
                    break

            if summary_row_idx is not None and len(vals) > summary_row_idx + 3:
                # Blok baris 48-53 ditemukan
                # Baris 1 setelah header (Row 49): Email Diinput (1), Sold Berbayar (3), Klaim Garansi (5), Akun Ready (7)
                r_metrics1 = vals[summary_row_idx + 1]
                # Baris 2 setelah header (Row 50): Total Omzet (3), Total Modal (5), Surplus Kas (7), Margin Kas (9)
                r_metrics2 = vals[summary_row_idx + 2]
                # Baris 3 setelah header (Row 51): Dari Threads (7), Dari Reseller (9)
                r_metrics3 = vals[summary_row_idx + 3]

                def find_val_after_label(row_arr, label_sub):
                    for i, cell in enumerate(row_arr):
                        if label_sub.lower() in cell.lower() and i + 1 < len(row_arr):
                            return row_arr[i + 1].strip()
                    return ""

                sold_str = find_val_after_label(r_metrics1, "Sold Berbayar")
                klaim_str = find_val_after_label(r_metrics1, "Klaim Garansi")
                ready_str = find_val_after_label(r_metrics1, "Akun Ready")

                omzet_str = find_val_after_label(r_metrics2, "Total Omzet")
                modal_str = find_val_after_label(r_metrics2, "Total Modal")
                surplus_str = find_val_after_label(r_metrics2, "Surplus Kas")
                margin_str = find_val_after_label(r_metrics2, "Margin Kas")

                threads_str = find_val_after_label(r_metrics3, "Dari Threads")
                reseller_str = find_val_after_label(r_metrics3, "Dari Reseller")

                # Agregasi produk dinamis dari baris 16-47 (misal Apple Music, Canva, ChatGPT, dll)
                daily_produk = {}
                for row in vals[15:min(47, len(vals))]:
                    if len(row) > 11 and row[11].strip():
                        p_name = row[11].strip()
                        pos = row[5].strip().lower() if len(row) > 5 else ""
                        hrg = parse_currency(row[6]) if len(row) > 6 else 0.0
                        
                        if p_name not in daily_produk:
                            daily_produk[p_name] = {"sold": 0, "klaim": 0, "ready": 0, "omzet": 0}
                        
                        if "sold" in pos:
                            daily_produk[p_name]["sold"] += 1
                            daily_produk[p_name]["omzet"] += hrg
                        elif "stanby" in pos or "ready" in pos:
                            daily_produk[p_name]["ready"] += 1
                        elif "klaim" in pos:
                            daily_produk[p_name]["klaim"] += 1

                result = {
                    "sheet_name": target_sheet,
                    "tanggal": sheet_tanggal,
                    "sold_berbayar": parse_int(sold_str),
                    "klaim_garansi": parse_int(klaim_str),
                    "akun_ready": parse_int(ready_str),
                    "total_omzet": parse_currency(omzet_str),
                    "total_modal": parse_currency(modal_str),
                    "surplus_kas": parse_currency(surplus_str),
                    "margin_kas": margin_str if margin_str else "0%",
                    "dari_threads": parse_int(threads_str),
                    "dari_reseller": parse_int(reseller_str),
                    "daily_produk": daily_produk
                }
                with self._lock:
                    self._daily_cache[target_sheet] = result
                    self._daily_time[target_sheet] = now
                    self._last_good_daily[target_sheet] = result
                return result

            fallback_res = {
                "sheet_name": target_sheet,
                "tanggal": sheet_tanggal,
                "sold_berbayar": 0,
                "klaim_garansi": 0,
                "akun_ready": 0,
                "total_omzet": 0.0,
                "total_modal": 0.0,
                "surplus_kas": 0.0,
                "margin_kas": "0%",
                "dari_threads": 0,
                "dari_reseller": 0,
                "daily_produk": {}
            }
            with self._lock:
                self._daily_cache[target_sheet] = fallback_res
                self._daily_time[target_sheet] = now
                self._last_good_daily[target_sheet] = fallback_res
            return fallback_res
        except Exception as e:
            logger.error(f"Error get_daily_summary: {e}")
            return self._last_good_daily.get(target_sheet, {})

    def get_sheet_raw_table(self, sheet_name: Optional[str] = None, force: bool = False) -> Dict[str, Any]:
        target_sheet = normalize_sheet_name(sheet_name) if sheet_name else self.get_current_operational_sheet()
        now = time.time()
        with self._lock:
            if not force and target_sheet in self._raw_table_cache and (now - self._raw_table_time.get(target_sheet, 0) < self.CACHE_TTL):
                return self._raw_table_cache[target_sheet]

        if not self.is_connected:
            return {"sheet_name": target_sheet, "headers": [], "rows": [], "modal_rows": [], "total_modal": "Rp 0"}

        try:
            ws = self.get_worksheet(target_sheet)
            if not ws:
                return {"sheet_name": target_sheet, "headers": [], "rows": [], "modal_rows": [], "total_modal": "Rp 0"}

            all_vals = ws.get_all_values()
            
            # Modal rows (Row 6 - 11)
            modal_rows = []
            total_modal = "Rp 0"
            if len(all_vals) >= 12:
                for r_idx in range(5, 11):
                    if r_idx < len(all_vals):
                        row = all_vals[r_idx]
                        if len(row) > 1 and row[1].strip():
                            modal_rows.append({
                                "row_idx": r_idx + 1,
                                "no": row[0] if len(row) > 0 else "",
                                "kebutuhan": row[1] if len(row) > 1 else "",
                                "harga_satuan": row[2] if len(row) > 2 else "",
                                "jumlah": row[3] if len(row) > 3 else "",
                                "satuan": row[4] if len(row) > 4 else "",
                                "total": row[5] if len(row) > 5 else ""
                            })
                # Check Total Modal cell (usually row 12 col F/G)
                if len(all_vals) > 11 and len(all_vals[11]) > 6:
                    total_modal = all_vals[11][6].strip() or all_vals[11][5].strip() or "Rp 0"

            # Akun rows (Row 15 is header, Rows 16 - 47 are data rows)
            headers = ["No", "Email", "Password Email", "Password CGPT", "Status Akun", "Posisi", "Harga Jual", "Jenis Transaksi", "Paket", "Sumber", "Keterangan", "Jenis Akun"]
            if len(all_vals) >= 15:
                raw_head = all_vals[14][:12]
                if any(h.strip() for h in raw_head):
                    headers = [h.strip() or headers[i] for i, h in enumerate(raw_head)]

            account_rows = []
            for r_idx in range(15, min(47, len(all_vals))):
                row = all_vals[r_idx]
                account_rows.append({
                    "row_idx": r_idx + 1,
                    "no": row[0] if len(row) > 0 else str(r_idx - 14),
                    "email": row[1] if len(row) > 1 else "",
                    "password_email": row[2] if len(row) > 2 else "",
                    "password_cgpt": row[3] if len(row) > 3 else "",
                    "status_akun": row[4] if len(row) > 4 else "",
                    "posisi": row[5] if len(row) > 5 else "",
                    "harga_jual": row[6] if len(row) > 6 else "",
                    "jenis_transaksi": row[7] if len(row) > 7 else "",
                    "paket": row[8] if len(row) > 8 else "",
                    "sumber": row[9] if len(row) > 9 else "",
                    "keterangan": row[10] if len(row) > 10 else "",
                    "jenis_akun": row[11] if len(row) > 11 else ""
                })

            result = {
                "sheet_name": target_sheet,
                "headers": headers,
                "rows": account_rows,
                "modal_rows": modal_rows,
                "total_modal": total_modal
            }
            with self._lock:
                self._raw_table_cache[target_sheet] = result
                self._raw_table_time[target_sheet] = now
            return result
        except Exception as e:
            logger.error(f"Error get_sheet_raw_table: {e}")
            return {"sheet_name": target_sheet, "headers": [], "rows": [], "modal_rows": [], "total_modal": "Rp 0"}

    def update_raw_cell(self, sheet_name: str, row: int, col: str, value: Any) -> bool:
        target_sheet = normalize_sheet_name(sheet_name)
        if not self.is_connected:
            return True
        try:
            ws = self.get_worksheet(target_sheet)
            if not ws:
                return False
            cell_address = f"{col.upper()}{row}"
            ws.update(range_name=cell_address, values=[[value]], raw=False)
            logger.info(f"Berhasil update cell {cell_address} = {value} di {target_sheet}")
            self.invalidate_cache(target_sheet)
            return True
        except Exception as e:
            logger.error(f"Error update_raw_cell {cell_address}: {e}")
            return False

    def update_raw_row(self, sheet_name: str, row: int, row_data: List[Any]) -> bool:
        target_sheet = normalize_sheet_name(sheet_name)
        if not self.is_connected:
            return True
        try:
            ws = self.get_worksheet(target_sheet)
            if not ws:
                return False
            range_str = f"B{row}:L{row}"
            ws.update(range_name=range_str, values=[row_data], raw=False)
            logger.info(f"Berhasil update baris {range_str} di {target_sheet}")
            self.invalidate_cache(target_sheet)
            return True
        except Exception as e:
            logger.error(f"Error update_raw_row {row}: {e}")
            return False

sheets_service = GoogleSheetsClient()

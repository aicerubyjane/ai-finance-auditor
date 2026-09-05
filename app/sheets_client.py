import os
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
    if cleaned.lower().startswith("hari") and not cleaned.startswith("Hari "):
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
        self._init_connection()

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
            return None
        norm_name = normalize_sheet_name(sheet_name) if sheet_name else self.get_current_operational_sheet()
        try:
            return self.spreadsheet.worksheet(norm_name)
        except gspread.exceptions.WorksheetNotFound:
            try:
                alt = norm_name.replace("Hari 0", "Hari ")
                return self.spreadsheet.worksheet(alt)
            except Exception:
                logger.error(f"Worksheet {norm_name} tidak ditemukan.")
                return None
        except Exception as e:
            logger.error(f"Error membuka sheet {norm_name}: {e}")
            return None

    def list_sheet_names(self) -> List[str]:
        if not self.is_connected or not self.spreadsheet:
            return ["Hari 47", "Hari 38", "Dashboard", "Rekap 60 Hari", "Rekap Jenis Akun"]
        try:
            return [ws.title for ws in self.spreadsheet.worksheets()]
        except Exception:
            return ["Hari 47", "Hari 38", "Dashboard", "Rekap 60 Hari", "Rekap Jenis Akun"]

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
            
            # Cari baris kosong di Tabel B (mulai dari row 16 / index 15 sampai batas sebelum ringkasan harian)
            target_row_idx = None
            for idx in range(15, min(47, len(all_vals))):
                row = all_vals[idx]
                col_b = row[1].strip() if len(row) > 1 else ""
                col_e = row[4].strip() if len(row) > 4 else ""
                # Kosong jika tidak ada email DAN status akun kosong
                if not col_b and not col_e:
                    target_row_idx = idx + 1
                    break

            formatted_price = f"Rp {harga_jual:,.0f}" if harga_jual > 0 else ""
            
            # Normalisasi presisi dengan aturan data validation Google Sheets:
            # Status Akun (Col E)
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

            # Jenis Transaksi (Col H): Wajib 'Penjualan' / 'Klaim' / 'Stok'
            if "klaim" in status_akun.lower():
                transaksi_val = "Klaim"
            elif posisi_val == "Sold":
                transaksi_val = "Penjualan"
            else:
                transaksi_val = ""

            # Paket (Col I): Wajib 'Garansi' atau 'Non Garansi'
            if "non" in paket.lower():
                paket_val = "Non Garansi"
            elif "garansi" in paket.lower():
                paket_val = "Garansi"
            else:
                paket_val = ""

            # Sumber (Col J): Wajib 'Threads', 'Reseller', 'Teman', dll (tanpa kata 'Dari')
            sumber_clean = sumber.replace("Dari ", "").strip()

            row_data = [
                email,
                password_email,
                password_cgpt,
                status_val,
                posisi_val,
                formatted_price,
                transaksi_val,
                paket_val,
                sumber_clean,
                keterangan,
                jenis_akun
            ]

            if target_row_idx:
                range_str = f"B{target_row_idx}:L{target_row_idx}"
                ws.update(range_name=range_str, values=[row_data])
                logger.info(f"Berhasil mengisi baris {target_row_idx} di {target_sheet} ({range_str})")
            else:
                ws.insert_row(["+"] + row_data, index=47)
                logger.info(f"Berhasil sisipkan baris di {target_sheet}")

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
                return True
            else:
                ws.insert_row(["+", kebutuhan, f"Rp {harga_satuan:,.0f}", str(jumlah), satuan, f"Rp {subtotal:,.0f}"], index=12)
                return True
        except Exception as e:
            logger.error(f"Error add_expense: {e}")
            return False

    def get_dashboard_kpis(self) -> Dict[str, Any]:
        if not self.is_connected:
            return {}

        try:
            ws_dash = self.get_worksheet("Dashboard")
            if not ws_dash:
                return {}

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
            for row in vals[16:76]:
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

            return {
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
                "trend_harian": trend_harian
            }
        except Exception as e:
            logger.error(f"Error get_dashboard_kpis: {e}")
            return {}

    def get_daily_summary(self, sheet_name: Optional[str] = None) -> Dict[str, Any]:
        target_sheet = normalize_sheet_name(sheet_name) if sheet_name else self.get_current_operational_sheet()

        if not self.is_connected:
            return {}

        try:
            ws = self.get_worksheet(target_sheet)
            if not ws:
                return {}

            vals = ws.get_all_values()
            
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

                return {
                    "sheet_name": target_sheet,
                    "sold_berbayar": parse_int(sold_str),
                    "klaim_garansi": parse_int(klaim_str),
                    "akun_ready": parse_int(ready_str),
                    "total_omzet": parse_currency(omzet_str),
                    "total_modal": parse_currency(modal_str),
                    "surplus_kas": parse_currency(surplus_str),
                    "margin_kas": margin_str if margin_str else "0%",
                    "dari_threads": parse_int(threads_str),
                    "dari_reseller": parse_int(reseller_str)
                }

            return {
                "sheet_name": target_sheet,
                "sold_berbayar": 0,
                "klaim_garansi": 0,
                "akun_ready": 0,
                "total_omzet": 0.0,
                "total_modal": 0.0,
                "surplus_kas": 0.0,
                "margin_kas": "0%",
                "dari_threads": 0,
                "dari_reseller": 0
            }
        except Exception as e:
            logger.error(f"Error get_daily_summary: {e}")
            return {}

sheets_service = GoogleSheetsClient()

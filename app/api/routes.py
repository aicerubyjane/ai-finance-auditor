import asyncio
import logging
from fastapi import APIRouter
from app.sheets_client import sheets_service
from app.config import settings

logger = logging.getLogger(__name__)

async def notify_telegram_transaction(email: str, jenis_akun: str, harga_jual: float, posisi: str, sheet_name: str, paket: str, sumber: str):
    try:
        import app.main as main_module
        admin_id = settings.TELEGRAM_ADMIN_ID
        bot_app = getattr(main_module, "bot_app", None)
        if not admin_id or not bot_app or not getattr(bot_app, "bot", None):
            return
        
        harga_fmt = f"Rp {int(harga_jual):,}".replace(",", ".")
        msg = (
            f"🔔 <b>Transaksi Baru Terinput (Web)</b>\n"
            f"━━━━━━━━━━━━━━━━━━━\n"
            f"📦 <b>Produk:</b> {jenis_akun}\n"
            f"📧 <b>Email:</b> <code>{email}</code>\n"
            f"🏷️ <b>Posisi:</b> {posisi}\n"
            f"💰 <b>Harga:</b> {harga_fmt}\n"
            f"🛡️ <b>Paket:</b> {paket}\n"
            f"🌐 <b>Sumber:</b> {sumber}\n"
            f"📑 <b>Sheet:</b> {sheet_name}\n"
            f"━━━━━━━━━━━━━━━━━━━\n"
            f"✨ <i>Dicatat via Dashboard Finance Auditor</i>"
        )
        await bot_app.bot.send_message(
            chat_id=admin_id,
            text=msg,
            parse_mode="HTML"
        )
    except Exception as e:
        logger.warning(f"Gagal mengirim notifikasi Telegram: {e}")

api_router = APIRouter(prefix="/api")

@api_router.get("/health")
async def health_check():
    return {
        "status": "ok",
        "sheets_connected": sheets_service.is_connected,
        "active_sheet": settings.ACTIVE_SHEET_NAME,
    }

@api_router.get("/dashboard")
async def get_dashboard_data(sheet: str = ""):
    current_sheet = sheet if sheet else sheets_service.get_current_operational_sheet()
    kpis = sheets_service.get_dashboard_kpis()
    daily = sheets_service.get_daily_summary(current_sheet)
    
    # Filter dan sortir hanya sheet harian untuk dropdown
    all_sheets = sheets_service.list_sheet_names()
    day_sheets = [s for s in all_sheets if s.lower().startswith("hari")]
    
    return {
        "kpis": kpis,
        "daily": daily,
        "available_sheets": day_sheets if day_sheets else all_sheets,
        "active_sheet": current_sheet
    }

@api_router.get("/daily-summary")
async def get_daily(sheet: str = ""):
    target_sheet = sheet if sheet else sheets_service.get_current_operational_sheet()
    return sheets_service.get_daily_summary(target_sheet)

@api_router.post("/set-active-day")
async def set_active_day(payload: dict):
    new_day = payload.get("sheet_name")
    if new_day:
        settings.ACTIVE_SHEET_NAME = new_day
        return {"success": True, "active_sheet": new_day}
    return {"success": False, "error": "Sheet name missing"}

SECURITY_PIN = "684249"

@api_router.post("/verify-pin")
async def verify_pin(payload: dict):
    pin = str(payload.get("pin", "")).strip()
    if pin == SECURITY_PIN:
        return {"success": True, "message": "PIN valid"}
    return {"success": False, "error": "PIN tidak sesuai"}

@api_router.get("/sheet-table")
async def get_sheet_table(sheet: str = "", pin: str = ""):
    if pin.strip() != SECURITY_PIN:
        return {"success": False, "error": "Akses ditolak. PIN salah."}
    
    target_sheet = sheet if sheet else sheets_service.get_current_operational_sheet()
    data = sheets_service.get_sheet_raw_table(target_sheet)
    return {"success": True, "data": data}

@api_router.post("/update-sheet-cell")
async def update_sheet_cell(payload: dict):
    pin = str(payload.get("pin", "")).strip()
    if pin != SECURITY_PIN:
        return {"success": False, "error": "Akses ditolak. PIN salah."}
    
    sheet_name = payload.get("sheet_name", "")
    row = payload.get("row")
    col = payload.get("col", "")
    val = payload.get("val", "")
    
    if not sheet_name or not row or not col:
        return {"success": False, "error": "Parameter tidak lengkap"}
    
    ok = sheets_service.update_raw_cell(sheet_name, int(row), col, val)
    return {"success": ok}

@api_router.post("/add-row-data")
async def add_row_data(payload: dict):
    pin = str(payload.get("pin", "")).strip()
    if pin != SECURITY_PIN:
        return {"success": False, "error": "Akses ditolak. PIN salah."}
    
    sheet_name = payload.get("sheet_name", "")
    email = payload.get("email", "")
    pass_email = payload.get("password_email", "")
    pass_cgpt = payload.get("password_cgpt", "")
    status_akun = payload.get("status_akun", "Signed / Premium")
    posisi = payload.get("posisi", "Sold")
    harga_jual = float(payload.get("harga_jual", 0) or 0)
    transaksi = payload.get("jenis_transaksi", "Penjualan")
    paket = payload.get("paket", "Garansi")
    sumber = payload.get("sumber", "Threads")
    keterangan = payload.get("keterangan", "")
    jenis_akun = payload.get("jenis_akun", "ChatGPT")

    ok = sheets_service.add_account_transaction(
        email=email,
        password_email=pass_email,
        password_cgpt=pass_cgpt,
        status_akun=status_akun,
        harga_jual=harga_jual,
        jenis_transaksi=transaksi,
        paket=paket,
        sumber=sumber,
        jenis_akun=jenis_akun,
        keterangan=keterangan,
        posisi=posisi,
        sheet_name=sheet_name
    )
    if ok:
        asyncio.create_task(
            notify_telegram_transaction(
                email=email,
                jenis_akun=jenis_akun,
                harga_jual=harga_jual,
                posisi=posisi,
                sheet_name=sheet_name or sheets_service.get_current_operational_sheet(),
                paket=paket,
                sumber=sumber
            )
        )
    return {"success": ok}

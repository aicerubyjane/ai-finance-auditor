from fastapi import APIRouter
from app.sheets_client import sheets_service
from app.config import settings

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
    return {"success": ok}

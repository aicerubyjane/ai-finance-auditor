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

import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from telegram.ext import Application

from app.config import settings
from app.api.routes import api_router
from app.bot.handlers import register_bot_handlers

logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO
)
logger = logging.getLogger(__name__)

bot_app: Application = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global bot_app
    token = settings.TELEGRAM_BOT_TOKEN
    
    if token and token != "your_telegram_bot_token_here":
        try:
            logger.info("Menginisialisasi Telegram Bot...")
            bot_app = Application.builder().token(token).build()
            register_bot_handlers(bot_app)
            await bot_app.initialize()
            await bot_app.start()
            await bot_app.updater.start_polling(drop_pending_updates=True)
            logger.info("Telegram Bot berhasil running dan siap menerima pesan!")
        except Exception as e:
            logger.error(f"Gagal menjalankan Telegram Bot: {e}")
    else:
        logger.warning("TELEGRAM_BOT_TOKEN belum diisi di .env. Bot Telegram ditunda sampai token diisi.")

    yield

    if bot_app and bot_app.updater and bot_app.updater.running:
        logger.info("Menghentikan Telegram Bot...")
        await bot_app.updater.stop()
        await bot_app.stop()
        await bot_app.shutdown()

app = FastAPI(
    title="AI Finance & Stock Auditor API",
    description="Automasi pencatatan penjualan akun AI, modal, dan monitoring keuangan",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)

# Mount frontend web dashboard static files
app.mount("/", StaticFiles(directory="static", html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host=settings.HOST, port=settings.PORT, reload=True)

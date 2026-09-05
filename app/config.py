import os
from pydantic_settings import BaseSettings
from typing import Optional

class Settings(BaseSettings):
    TELEGRAM_BOT_TOKEN: str = ""
    TELEGRAM_ADMIN_ID: Optional[str] = ""
    SPREADSHEET_ID: str = ""
    SERVICE_ACCOUNT_FILE: str = "credentials.json"
    GOOGLE_SERVICE_ACCOUNT_JSON: Optional[str] = None
    ACTIVE_SHEET_NAME: str = ""
    PORT: int = 8000
    HOST: str = "0.0.0.0"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"

settings = Settings()

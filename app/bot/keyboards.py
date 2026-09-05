from telegram import InlineKeyboardButton, InlineKeyboardMarkup

def get_main_menu_keyboard() -> InlineKeyboardMarkup:
    keyboard = [
        [
            InlineKeyboardButton("🛒 + Penjualan", callback_data="menu_sale"),
            InlineKeyboardButton("📦 + Stok Ready", callback_data="menu_stock"),
        ],
        [
            InlineKeyboardButton("💸 + Catat Modal", callback_data="menu_expense"),
            InlineKeyboardButton("📊 Ringkasan Hari Ini", callback_data="menu_summary"),
        ],
        [
            InlineKeyboardButton("⚙️ Ganti Hari Aktif", callback_data="menu_change_day"),
            InlineKeyboardButton("🌐 Web Dashboard", callback_data="menu_web_info"),
        ]
    ]
    return InlineKeyboardMarkup(keyboard)

def get_product_keyboard(prefix: str = "prod") -> InlineKeyboardMarkup:
    keyboard = [
        [
            InlineKeyboardButton("🤖 ChatGPT", callback_data=f"{prefix}_ChatGPT"),
            InlineKeyboardButton("🎭 Claude", callback_data=f"{prefix}_Claude"),
        ],
        [
            InlineKeyboardButton("✨ Gemini", callback_data=f"{prefix}_Gemini"),
            InlineKeyboardButton("❌ Batal", callback_data="cancel_action"),
        ]
    ]
    return InlineKeyboardMarkup(keyboard)

def get_sale_status_keyboard() -> InlineKeyboardMarkup:
    keyboard = [
        [
            InlineKeyboardButton("💰 Sold Berbayar", callback_data="status_Sold Berbayar"),
            InlineKeyboardButton("🛡️ Klaim Garansi", callback_data="status_Klaim Garansi"),
        ],
        [
            InlineKeyboardButton("❌ Batal", callback_data="cancel_action")
        ]
    ]
    return InlineKeyboardMarkup(keyboard)

def get_warranty_package_keyboard() -> InlineKeyboardMarkup:
    keyboard = [
        [
            InlineKeyboardButton("✅ Paket Garansi", callback_data="pkg_Paket Garansi"),
            InlineKeyboardButton("🚫 Non Garansi", callback_data="pkg_Non Garansi"),
        ],
        [
            InlineKeyboardButton("❌ Batal", callback_data="cancel_action")
        ]
    ]
    return InlineKeyboardMarkup(keyboard)

def get_source_keyboard() -> InlineKeyboardMarkup:
    keyboard = [
        [
            InlineKeyboardButton("🧵 Threads", callback_data="src_Dari Threads"),
            InlineKeyboardButton("🤝 Reseller", callback_data="src_Dari Reseller"),
        ],
        [
            InlineKeyboardButton("👥 Dari Teman", callback_data="src_Dari Teman"),
            InlineKeyboardButton("🔄 Repeat Order", callback_data="src_Repeat Order"),
        ],
        [
            InlineKeyboardButton("📌 Lainnya", callback_data="src_Lainnya"),
            InlineKeyboardButton("❌ Batal", callback_data="cancel_action")
        ]
    ]
    return InlineKeyboardMarkup(keyboard)

def get_cancel_keyboard() -> InlineKeyboardMarkup:
    keyboard = [
        [InlineKeyboardButton("❌ Batalkan", callback_data="cancel_action")]
    ]
    return InlineKeyboardMarkup(keyboard)

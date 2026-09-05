import logging
from telegram import Update
from telegram.ext import (
    ContextTypes,
    CommandHandler,
    CallbackQueryHandler,
    MessageHandler,
    ConversationHandler,
    filters,
)
from app.config import settings
from app.sheets_client import sheets_service
from app.bot.keyboards import (
    get_main_menu_keyboard,
    get_product_keyboard,
    get_sale_status_keyboard,
    get_warranty_package_keyboard,
    get_source_keyboard,
    get_cancel_keyboard,
)

logger = logging.getLogger(__name__)

# State definitions for ConversationHandlers
(
    SALE_PRODUCT,
    SALE_STATUS,
    SALE_PACKAGE,
    SALE_ACCOUNT_DATA,
    SALE_PRICE,
    SALE_SOURCE,
    SALE_NOTE,
) = range(7)

STOCK_PRODUCT, STOCK_ACCOUNTS = range(7, 9)
EXPENSE_NEED, EXPENSE_DETAILS = range(9, 11)
CHANGE_DAY_INPUT = 11

def is_admin(update: Update) -> bool:
    if not settings.TELEGRAM_ADMIN_ID:
        return True
    user_id = str(update.effective_user.id)
    return user_id == str(settings.TELEGRAM_ADMIN_ID)

async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not is_admin(update):
        await update.message.reply_text("⛔ Maaf, Anda tidak memiliki akses ke bot audit keuangan ini.")
        return

    current_sheet = sheets_service.get_current_operational_sheet()
    text = (
        f"👋 **Selamat Datang di Finance & Stock Auditor Bot**\n\n"
        f"📅 **Sheet Kerja Hari Ini:** `{current_sheet}`\n"
        f"Silakan pilih menu di bawah ini untuk memulai input atau kontrol data:"
    )
    await update.message.reply_text(
        text,
        reply_markup=get_main_menu_keyboard(),
        parse_mode="Markdown"
    )

async def cancel_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    context.user_data.clear()
    await query.edit_message_text(
        "❌ Operasi dibatalkan.\nKembali ke menu utama:",
        reply_markup=get_main_menu_keyboard()
    )
    return ConversationHandler.END

# ----------------- FLOW 1: PENJUALAN -----------------

async def sale_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    context.user_data["sale"] = {}
    await query.edit_message_text(
        "🛒 **[Input Penjualan] - Langkah 1/6**\nPilih jenis produk AI:",
        reply_markup=get_product_keyboard(prefix="sale_prod"),
        parse_mode="Markdown"
    )
    return SALE_PRODUCT

async def sale_product_chosen(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    product = query.data.replace("sale_prod_", "")
    context.user_data["sale"]["product"] = product
    
    await query.edit_message_text(
        f"Produk: *{product}*\n\n🛒 **[Input Penjualan] - Langkah 2/6**\nPilih status transaksi:",
        reply_markup=get_sale_status_keyboard(),
        parse_mode="Markdown"
    )
    return SALE_STATUS

async def sale_status_chosen(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    status = query.data.replace("status_", "")
    context.user_data["sale"]["status"] = status

    await query.edit_message_text(
        f"Status: *{status}*\n\n🛒 **[Input Penjualan] - Langkah 3/6**\nPilih paket garansi:",
        reply_markup=get_warranty_package_keyboard(),
        parse_mode="Markdown"
    )
    return SALE_PACKAGE

async def sale_package_chosen(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    pkg = query.data.replace("pkg_", "")
    context.user_data["sale"]["package"] = pkg

    await query.edit_message_text(
        f"Paket: *{pkg}*\n\n🛒 **[Input Penjualan] - Langkah 4/6**\n"
        "Ketik data akun dengan format:\n"
        "`Email | Password Email | Password CGPT`\n\n"
        "_(Contoh: user1@gmail.com | pass123 | cgptPass45)_",
        reply_markup=get_cancel_keyboard(),
        parse_mode="Markdown"
    )
    return SALE_ACCOUNT_DATA

async def sale_account_received(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = update.message.text.strip()
    parts = [p.strip() for p in text.split("|")]
    
    email = parts[0]
    pass_mail = parts[1] if len(parts) > 1 else "-"
    pass_cgpt = parts[2] if len(parts) > 2 else "-"

    context.user_data["sale"]["email"] = email
    context.user_data["sale"]["pass_mail"] = pass_mail
    context.user_data["sale"]["pass_cgpt"] = pass_cgpt

    # Default harga rekomendasi jika klaim
    if context.user_data["sale"].get("status") == "Klaim Garansi":
        context.user_data["sale"]["price"] = 0.0
        await update.message.reply_text(
            f"Akun: `{email}`\nStatus Klaim: Harga diset Rp 0.\n\n🛒 **[Input Penjualan] - Langkah 5/6**\nPilih sumber transaksi:",
            reply_markup=get_source_keyboard(),
            parse_mode="Markdown"
        )
        return SALE_SOURCE

    await update.message.reply_text(
        f"Akun: `{email}`\n\n🛒 **[Input Penjualan] - Langkah 5/6**\nKetik nominal harga jual:\n_(Contoh: 45000)_",
        reply_markup=get_cancel_keyboard(),
        parse_mode="Markdown"
    )
    return SALE_PRICE

async def sale_price_received(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = update.message.text.strip().replace(".", "").replace(",", "")
    try:
        price = float(text)
    except ValueError:
        await update.message.reply_text("Nominal tidak valid. Silakan ketik angka saja (misal: 45000):")
        return SALE_PRICE

    context.user_data["sale"]["price"] = price
    await update.message.reply_text(
        f"Harga Jual: Rp {price:,.0f}\n\n🛒 **[Input Penjualan] - Langkah 6/6**\nPilih sumber transaksi:",
        reply_markup=get_source_keyboard(),
        parse_mode="Markdown"
    )
    return SALE_SOURCE

async def sale_source_chosen(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    source = query.data.replace("src_", "")
    context.user_data["sale"]["source"] = source

    sale_data = context.user_data["sale"]
    product = sale_data.get("product", "ChatGPT")
    status = sale_data.get("status", "Sold Berbayar")
    pkg = sale_data.get("package", "Paket Garansi")
    email = sale_data.get("email", "")
    pass_mail = sale_data.get("pass_mail", "-")
    pass_cgpt = sale_data.get("pass_cgpt", "-")
    price = sale_data.get("price", 0.0)

    target_sheet = sheets_service.get_current_operational_sheet()

    # Simpan ke Google Sheets Tabel B
    success = sheets_service.add_account_transaction(
        email=email,
        password_email=pass_mail,
        password_cgpt=pass_cgpt,
        status_akun=status,
        harga_jual=price,
        jenis_transaksi="Penjualan" if status == "Sold Berbayar" else "Klaim",
        paket="Garansi" if "garansi" in pkg.lower() and "non" not in pkg.lower() else ("Non Garansi" if "non" in pkg.lower() else ""),
        sumber=source.replace("Dari ", "").strip(),
        jenis_akun=product,
        keterangan=f"via {source.replace('Dari ', '').strip()}",
        posisi="Sold" if status == "Sold Berbayar" else "Klaim",
        sheet_name=target_sheet
    )

    if success:
        result_text = (
            f"✅ **Transaksi Penjualan Berhasil Dicatat!**\n\n"
            f"• **Sheet:** `{target_sheet}`\n"
            f"• **Produk:** {product}\n"
            f"• **Status:** {status}\n"
            f"• **Email:** `{email}`\n"
            f"• **Harga Jual:** Rp {price:,.0f}\n"
            f"• **Paket:** {'Garansi' if 'garansi' in pkg.lower() and 'non' not in pkg.lower() else 'Non Garansi'}\n"
            f"• **Sumber:** {source.replace('Dari ', '').strip()}\n\n"
            f"Data valid dan otomatis terhitung ke ringkasan harian Google Sheets."
        )
    else:
        result_text = "⚠️ Gagal mencatat transaksi ke Google Sheets. Silakan cek koneksi kredensial."

    context.user_data.clear()
    await query.edit_message_text(
        result_text,
        reply_markup=get_main_menu_keyboard(),
        parse_mode="Markdown"
    )
    return ConversationHandler.END

# ----------------- FLOW 2: STOK READY -----------------

async def stock_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    context.user_data["stock"] = {}
    await query.edit_message_text(
        "📦 **[Input Stok Ready] - Langkah 1/2**\nPilih jenis produk akun:",
        reply_markup=get_product_keyboard(prefix="stk_prod"),
        parse_mode="Markdown"
    )
    return STOCK_PRODUCT

async def stock_product_chosen(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    product = query.data.replace("stk_prod_", "")
    context.user_data["stock"]["product"] = product

    await query.edit_message_text(
        f"Produk: *{product}*\n\n📦 **[Input Stok Ready] - Langkah 2/2**\n"
        "Ketik data akun Ready. Anda bisa memasukkan 1 akun atau banyak akun (1 baris per akun):\n\n"
        "Format: `email | pass_email | pass_cgpt`\n\n"
        "Contoh:\n"
        "`akun1@gmail.com | pass1 | passCgpt1`\n"
        "`akun2@gmail.com | pass2 | passCgpt2`",
        reply_markup=get_cancel_keyboard(),
        parse_mode="Markdown"
    )
    return STOCK_ACCOUNTS

async def stock_accounts_received(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = update.message.text.strip()
    lines = text.split("\n")
    product = context.user_data["stock"].get("product", "ChatGPT")

    count = 0
    for line in lines:
        if not line.strip():
            continue
        parts = [p.strip() for p in line.split("|")]
        email = parts[0]
        pass_mail = parts[1] if len(parts) > 1 else "-"
        pass_cgpt = parts[2] if len(parts) > 2 else "-"

        target_sheet = sheets_service.get_current_operational_sheet()
        sheets_service.add_account_transaction(
            email=email,
            password_email=pass_mail,
            password_cgpt=pass_cgpt,
            status_akun="Signed / Free",
            harga_jual=0,
            jenis_transaksi="",
            paket="",
            sumber="",
            jenis_akun=product,
            keterangan="Stok Ready",
            posisi="Stanby",
            sheet_name=target_sheet
        )
        count += 1

    await update.message.reply_text(
        f"✅ Berhasil menambahkan **{count} akun Ready** ({product}) ke sheet `{target_sheet}`!\nStatus diset `Stanby` dan siap dijual.",
        reply_markup=get_main_menu_keyboard(),
        parse_mode="Markdown"
    )
    context.user_data.clear()
    return ConversationHandler.END

# ----------------- FLOW 3: CATAT MODAL / PENGELUARAN -----------------

async def expense_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    context.user_data["expense"] = {}
    await query.edit_message_text(
        "💸 **[Catat Modal / Pengeluaran] - Langkah 1/2**\n"
        "Ketik nama kebutuhan/pengeluaran:\n"
        "_(Contoh: Beli Nomor OTP / Beli Akun Domain)_",
        reply_markup=get_cancel_keyboard(),
        parse_mode="Markdown"
    )
    return EXPENSE_NEED

async def expense_need_received(update: Update, context: ContextTypes.DEFAULT_TYPE):
    need = update.message.text.strip()
    context.user_data["expense"]["need"] = need
    await update.message.reply_text(
        f"Kebutuhan: *{need}*\n\n💸 **[Catat Modal] - Langkah 2/2**\n"
        "Ketik jumlah dan harga satuan dengan format: `Jumlah | Harga Satuan`\n\n"
        "_(Contoh: 10 | 5000  -> Total Rp 50.000)_",
        reply_markup=get_cancel_keyboard(),
        parse_mode="Markdown"
    )
    return EXPENSE_DETAILS

async def expense_details_received(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = update.message.text.strip()
    parts = [p.strip() for p in text.split("|")]
    try:
        qty = float(parts[0])
        unit_price = float(parts[1].replace(".", "").replace(",", "")) if len(parts) > 1 else 0.0
    except ValueError:
        await update.message.reply_text("Format angka tidak valid. Silakan ulangi: `Jumlah | Harga Satuan`")
        return EXPENSE_DETAILS

    need = context.user_data["expense"].get("need", "Modal")
    sheets_service.add_expense(
        kebutuhan=need,
        harga_satuan=unit_price,
        jumlah=qty,
        satuan="Pcs",
        sheet_name=settings.ACTIVE_SHEET_NAME
    )

    subtotal = qty * unit_price
    await update.message.reply_text(
        f"✅ **Modal / Pengeluaran Berhasil Dicatat!**\n\n"
        f"• **Kebutuhan:** {need}\n"
        f"• **Jumlah:** {qty} Pcs\n"
        f"• **Harga Satuan:** Rp {unit_price:,.0f}\n"
        f"• **Subtotal:** Rp {subtotal:,.0f}\n"
        f"• **Sheet:** `{settings.ACTIVE_SHEET_NAME}`",
        reply_markup=get_main_menu_keyboard(),
        parse_mode="Markdown"
    )
    context.user_data.clear()
    return ConversationHandler.END

# ----------------- RINGKASAN HARI INI -----------------

async def summary_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()

    active_sheet = sheets_service.get_current_operational_sheet()
    data = sheets_service.get_daily_summary(active_sheet)

    sold = data.get("sold_berbayar", 0)
    klaim = data.get("klaim_garansi", 0)
    ready = data.get("akun_ready", 0)
    omzet = data.get("total_omzet", 0)
    modal = data.get("total_modal", 0)
    surplus = data.get("surplus_kas", 0)
    margin = data.get("margin_kas", "0%")

    text = (
        f"📊 **RINGKASAN HARIAN ({active_sheet})**\n"
        f"━━━━━━━━━━━━━━━━━━━\n"
        f"💰 **Total Omzet:** Rp {omzet:,.0f}\n"
        f"💸 **Total Modal:** Rp {modal:,.0f}\n"
        f"📈 **Surplus Kas:** Rp {surplus:,.0f} ({margin})\n\n"
        f"🛒 **Sold Berbayar:** {sold} Akun\n"
        f"🛡️ **Klaim Garansi:** {klaim} Akun\n"
        f"📦 **Akun Ready:** {ready} Akun\n"
        f"━━━━━━━━━━━━━━━━━━━\n"
        f"Buka Dashboard Web untuk melihat analitik lengkap 60 hari & grafik produk."
    )

    await query.edit_message_text(
        text,
        reply_markup=get_main_menu_keyboard(),
        parse_mode="Markdown"
    )

async def web_info_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    port = settings.PORT
    text = (
        f"🌐 **Web Dashboard Monitoring & Performance**\n\n"
        f"Dashboard web dapat diakses di browser Anda:\n"
        f"👉 `http://localhost:{port}`\n\n"
        f"Fitur web mencakup:\n"
        f"• Indikator KPI Global (Tab Dashboard)\n"
        f"• Grafik Omzet vs Modal vs Surplus 60 Hari\n"
        f"• Breakdown ChatGPT, Claude, Gemini\n"
        f"• Live Inventory Auditor"
    )
    await query.edit_message_text(
        text,
        reply_markup=get_main_menu_keyboard(),
        parse_mode="Markdown"
    )

# ----------------- GANTI HARI AKTIF -----------------

async def change_day_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    await query.edit_message_text(
        f"📅 Sheet aktif saat ini: `{settings.ACTIVE_SHEET_NAME}`\n\n"
        "Ketik nama sheet hari yang ingin diaktifkan:\n"
        "_(Contoh: `Hari 39` atau `Hari 40`)_",
        reply_markup=get_cancel_keyboard(),
        parse_mode="Markdown"
    )
    return CHANGE_DAY_INPUT

async def change_day_received(update: Update, context: ContextTypes.DEFAULT_TYPE):
    from app.sheets_client import normalize_sheet_name
    raw_input = update.message.text.strip()
    new_day = normalize_sheet_name(raw_input)
    
    # Validasi apakah sheet benar-benar ada di spreadsheet
    available = sheets_service.list_sheet_names()
    if new_day not in available:
        # Cari case-insensitive match
        match = next((s for s in available if s.lower() == new_day.lower()), None)
        if match:
            new_day = match
        else:
            await update.message.reply_text(
                f"⚠️ Sheet `{new_day}` tidak ditemukan di Google Sheets Anda.\n"
                f"Contoh format yang benar: `Hari 47` atau cukup ketik `47`.\n\n"
                f"Sheet aktif saat ini tetap: `{settings.ACTIVE_SHEET_NAME}`",
                reply_markup=get_main_menu_keyboard(),
                parse_mode="Markdown"
            )
            return ConversationHandler.END

    settings.ACTIVE_SHEET_NAME = new_day
    
    # Ambil sekilas ringkasan sheet tersebut
    summary = sheets_service.get_daily_summary(new_day)
    sold = summary.get("sold_berbayar", 0)
    ready = summary.get("akun_ready", 0)
    omzet = summary.get("total_omzet", 0)

    await update.message.reply_text(
        f"✅ **Sheet Aktif Berhasil Diubah!**\n\n"
        f"📅 Sheet: `{new_day}`\n"
        f"🛒 Sold: {sold} Akun\n"
        f"📦 Ready: {ready} Akun\n"
        f"💰 Omzet: Rp {omzet:,.0f}\n\n"
        f"Semua transaksi yang Anda input selanjutnya akan masuk ke `{new_day}`.",
        reply_markup=get_main_menu_keyboard(),
        parse_mode="Markdown"
    )
    return ConversationHandler.END

def register_bot_handlers(application):
    # Penjualan Conversation
    sale_conv = ConversationHandler(
        entry_points=[CallbackQueryHandler(sale_start, pattern="^menu_sale$")],
        states={
            SALE_PRODUCT: [CallbackQueryHandler(sale_product_chosen, pattern="^sale_prod_")],
            SALE_STATUS: [CallbackQueryHandler(sale_status_chosen, pattern="^status_")],
            SALE_PACKAGE: [CallbackQueryHandler(sale_package_chosen, pattern="^pkg_")],
            SALE_ACCOUNT_DATA: [MessageHandler(filters.TEXT & ~filters.COMMAND, sale_account_received)],
            SALE_PRICE: [MessageHandler(filters.TEXT & ~filters.COMMAND, sale_price_received)],
            SALE_SOURCE: [CallbackQueryHandler(sale_source_chosen, pattern="^src_")],
        },
        fallbacks=[CallbackQueryHandler(cancel_callback, pattern="^cancel_action$")],
    )

    # Stok Ready Conversation
    stock_conv = ConversationHandler(
        entry_points=[CallbackQueryHandler(stock_start, pattern="^menu_stock$")],
        states={
            STOCK_PRODUCT: [CallbackQueryHandler(stock_product_chosen, pattern="^stk_prod_")],
            STOCK_ACCOUNTS: [MessageHandler(filters.TEXT & ~filters.COMMAND, stock_accounts_received)],
        },
        fallbacks=[CallbackQueryHandler(cancel_callback, pattern="^cancel_action$")],
    )

    # Catat Modal Conversation
    expense_conv = ConversationHandler(
        entry_points=[CallbackQueryHandler(expense_start, pattern="^menu_expense$")],
        states={
            EXPENSE_NEED: [MessageHandler(filters.TEXT & ~filters.COMMAND, expense_need_received)],
            EXPENSE_DETAILS: [MessageHandler(filters.TEXT & ~filters.COMMAND, expense_details_received)],
        },
        fallbacks=[CallbackQueryHandler(cancel_callback, pattern="^cancel_action$")],
    )

    # Ganti Hari Aktif Conversation
    change_day_conv = ConversationHandler(
        entry_points=[CallbackQueryHandler(change_day_callback, pattern="^menu_change_day$")],
        states={
            CHANGE_DAY_INPUT: [MessageHandler(filters.TEXT & ~filters.COMMAND, change_day_received)],
        },
        fallbacks=[CallbackQueryHandler(cancel_callback, pattern="^cancel_action$")],
    )

    application.add_handler(CommandHandler("start", start_command))
    application.add_handler(sale_conv)
    application.add_handler(stock_conv)
    application.add_handler(expense_conv)
    application.add_handler(change_day_conv)
    application.add_handler(CallbackQueryHandler(summary_callback, pattern="^menu_summary$"))
    application.add_handler(CallbackQueryHandler(web_info_callback, pattern="^menu_web_info$"))

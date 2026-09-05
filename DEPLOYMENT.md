# Panduan Deploy Cloud (24 Jam Non-Stop)

Aplikasi ini sudah dilengkapi dengan `Dockerfile`, `Procfile`, dan `render.yaml`. Anda bisa memilih antara **Railway.app** (Paling Cepat & Simpel) atau **Render.com** (Ada Free Tier).

---

## CARA 1: Deploy ke Railway.app (Sangat Direkomendasikan ⭐)

Railway adalah platform hosting cloud modern yang paling mudah untuk Python & Docker:

### 1. Upload Project ke GitHub
1. Buat repository baru di [GitHub](https://github.com/new) (beri nama misal `ai-finance-auditor`, set sebagai **Private** agar aman).
2. Di folder project ini, jalankan perintah git:
   ```bash
   git init
   git add .
   git commit -m "Initial commit finance auditor"
   git branch -M main
   git remote add origin https://github.com/<username-kamu>/ai-finance-auditor.git
   git push -u origin main
   ```
   *(Catatan: `.env` dan `credentials.json` sudah otomatis di-ignore oleh `.gitignore` sehingga tidak akan bocor ke GitHub).*

### 2. Hubungkan ke Railway
1. Buka [Railway.app](https://railway.app/) dan login pakai akun GitHub Anda.
2. Klik tombol **"+ New Project"** -> Pilih **"Deploy from GitHub repo"**.
3. Pilih repository `ai-finance-auditor` Anda.
4. Klik **"Deploy Now"**.

### 3. Masukkan Environment Variables (Kunci Rahasia)
1. Di halaman project Railway Anda, klik menu **"Variables"**.
2. Tambahkan variable berikut:
   * `TELEGRAM_BOT_TOKEN`: `8970416011:AAHbx1scyEEHcCCrnnuWi_5wqI-aXMnDjt4`
   * `TELEGRAM_ADMIN_ID`: `6413728861`
   * `SPREADSHEET_ID`: `197bjyWRktBJk5JKrYNj7GW3autB2n4as8xLRQW4Dqzc`
   * `ACTIVE_SHEET_NAME`: `Hari 47`
   * `GOOGLE_SERVICE_ACCOUNT_JSON`: *(Copy seluruh isi teks dari file `credentials.json` lalu paste di sini)*
3. Klik menu **"Settings"** -> di bagian **"Networking"**, klik **"Generate Domain"**.
   * Anda akan mendapatkan link publik gratis (contoh: `https://ai-finance-auditor-production.up.railway.app`).

**SELESAI!**
Bot Telegram Anda langsung aktif 24 jam di cloud, dan Dashboard Web bisa dibuka dari link publik Railway tersebut lewat HP/laptop mana pun tanpa terminal!

---

## CARA 2: Deploy ke Render.com (Gratis)

1. Buka [Render.com](https://render.com/) dan login dengan GitHub.
2. Klik **"New +"** -> Pilih **"Web Service"**.
3. Hubungkan repository GitHub Anda.
4. Pengaturan:
   * **Runtime:** Python 3
   * **Build Command:** `pip install -r requirements.txt`
   * **Start Command:** `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
5. Masukkan **Environment Variables** yang sama seperti di atas (`TELEGRAM_BOT_TOKEN`, `GOOGLE_SERVICE_ACCOUNT_JSON`, dst).
6. Klik **"Create Web Service"**.

---

## CARA 3: VPS Linux Ubuntu (Bila Punya Server Sendiri)

Jika Anda memiliki server VPS (DigitalOcean / AWS / Linode / dsb):
```bash
git clone https://github.com/<username>/ai-finance-auditor.git
cd ai-finance-auditor
python3 -m venv venv
./venv/bin/pip install -r requirements.txt
# Jalankan di background dengan systemd atau PM2:
pm2 start "venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 80" --name finance-bot
```

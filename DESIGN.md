# Finance Auditor — UI

Dashboard untuk membaca penjualan, kas, dan persediaan sehari-hari. Tiga halaman yang sudah ada tetap dipakai: Ringkasan, Tren keuangan, dan Produk & stok.

## Arah visual

- Sidebar hijau gelap memberi batas yang jelas antara navigasi dan data. Canvas putih hangat membuat tabel mudah dibaca.
- Omzet mendapat satu permukaan hijau solid sebagai angka utama. Metrik lain memakai permukaan putih dengan pembatas tipis.
- DM Sans dengan angka tabular; judul menggunakan bobot sedang. Label memakai huruf biasa agar mudah dipindai.
- Kartu data tetap diam saat hover. Transisi singkat dipakai untuk perpindahan halaman, kontrol, dan dialog. Preferensi reduced motion mematikan animasi.

## Warna

| Peran | Nilai |
| --- | --- |
| Canvas | `#f6f7f3` |
| Permukaan | `#ffffff` |
| Sidebar | `#192c23` |
| Teks utama | `#202b23` |
| Teks sekunder | `#526052` |
| Teks pendukung | `#647160` |
| Aksi utama | `#235c46` |
| Grafik modal | `#849677` |
| Grafik surplus | `#377455` |
| Grafik defisit | `#b95c48` |
| Klaim/perhatian | `#886326` |

## Data dan interaksi

- Ringkasan usaha adalah akumulasi; catatan harian dan stok mengikuti sheet yang dipilih.
- Rincian produk mempertahankan perilaku data yang ada: rekap global ditambah produk harian yang belum ada di rekap. Tabel menjelaskan cakupan tersebut.
- Grafik mempertahankan dua batang bertumpuk, modal dan surplus. Nilai negatif berada di bawah nol. Tooltip juga menyebut omzet agar nilai bersih tetap jelas.
- Rentang 7/14/30/90 hari, zoom, geser periode, dan toggle seri berfungsi di kedua halaman grafik. Scroll biasa tetap menggulir halaman; Alt + scroll mengubah zoom.
- Pencarian, filter, sortir, dan ekspor bekerja pada produk yang ditampilkan. Tombol ekspor dinonaktifkan jika hasil kosong.
- Status sinkronisasi menunjukkan waktu respons terakhir yang berhasil. Saat gagal, data terakhir dan pesan kegagalan tampil di semua halaman.
- Dialog PIN/editor mengelola fokus, Escape, dan pengembalian fokus. Sel gagal simpan memiliki pesan serta tombol coba lagi.

## Responsif

- Pada lebar 900 px ke bawah, sidebar berubah menjadi tiga tab navigasi di atas.
- Pada lebar 700 px ke bawah, KPI menjadi dua kolom dan panel data satu kolom. Grafik tetap memiliki tinggi yang cukup untuk label.
- Tabel lebar menggulir di dalam kontainernya; halaman tidak menyembunyikan overflow untuk menutupi masalah layout.
- Kontrol utama pada perangkat kecil memiliki area sentuh minimal 44 px. Form memakai label nyata, status invalid, dan ukuran teks input 16 px.
- Tata letak diverifikasi pada 320, 375, 768, 1024, dan 1440 px. Uji interaksi menggunakan server fixture lokal tanpa menjalankan bot atau menulis Google Sheets.

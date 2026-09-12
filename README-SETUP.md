PANDUAN SETUP — CHECKOUT + ADMIN (Firebase BARU)
================================================

PENTING: API key Firebase yang lama di file HTML Anda sudah terekspos publik.
Jangan dipakai lagi. Buat PROJECT FIREBASE BARU dengan langkah ini:

1. Buka https://console.firebase.google.com -> "Add project" -> beri nama (mis. "checkout-stej-baru")
2. Build -> Authentication -> Sign-in method -> aktifkan "Google"
   -> isi "Authorized domains": tambahkan domain tempat file ini dihosting
   (contoh: stejproject.github.io, atau domain hosting Anda)
3. Build -> Firestore Database -> Create database -> Start in test mode
4. Di halaman Project Settings (ikon gigi) -> "Your apps" -> Web (ikon </>)
   -> daftarkan app -> SALIN konfigurasinya
5. Edit DUA file: checkout.html dan admin.html — ganti blok firebaseConfig
   (ganti MASUKKAN_API_KEY_ANDA, MASUKKAN_PROJECT_ID_ANDA, dll)

CATATAN KEAMANAN "TEST MODE":
- Test mode memungkinkan siapa pun menulis ke database selama 30 hari.
- Untuk produksi, atur Firestore Rules seperti ini:

    rules_version = '2';
    service cloud.firestore {
      match /databases/{db}/documents {
        // Semua boleh BACA checkout settings & items (untuk halaman checkout publik)
        match /checkout_settings/{doc} { allow read: if true; }
        match /items/{doc}             { allow read: if true; }

        // Pembayaran: siapa pun boleh TAMBAH, tapi hanya login boleh baca/ubah
        match /payments/{doc} {
          allow create: if true;
          allow read, update, delete: if request.auth != null;
        }
      }
    }

CARA PAKAI:
- Buka admin.html -> Login Google -> tab "Halaman" isi judul, QRIS, dst.
- Tab "Rekening" -> tambah rekening bank Anda (BCA/Mandiri/dll), bisa
  diaktifkan/dinonaktifkan kapan saja.
- Tab "Item" -> tambah produk, salin link checkout yang dihasilkan.
- Halaman checkout.html bisa juga dipanggil manual:
    checkout.html?item=Nama%20Produk&price=150000
- Pembayaran masuk otomatis (realtime) di tab "Pembayaran" -> Setujui / Tolak.
  Status di halaman customer berubah otomatis (tanpa refresh).

HOSTING: dua file HTML ini bisa dihosting di GitHub Pages, Netlify, atau
Firebase Hosting. Untuk login Google berfungsi, domain harus didaftarkan di
Firebase Authentication (Authorized domains), sudah default localhost + domain Firebase Anda.

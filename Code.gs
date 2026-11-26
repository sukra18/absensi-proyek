// ==========================================
// KONFIGURASI SISTEM ABSENSI
// ==========================================
const CONFIG = {
  // PIN Master disimpan di Script Properties agar tidak hardcode di source
  // Setup: Apps Script Editor → Project Settings → Script Properties → tambah key PIN_MASTER value 9281
  get PIN_MASTER() {
    return (
      PropertiesService.getScriptProperties().getProperty("PIN_MASTER") || ""
    );
  },
  FOLDER_FOTO_ID: "1W5G8yEWt2a2_2m77p1_MaG1bhuS3r7l-",
  SHEET_PROYEK: "Master_Proyek",
  SHEET_MASTER: "Master_Pekerja",
  SHEET_LOG: "Log_Absensi",
  TIMEZONE: "Asia/Jakarta",
};

const getSheet = (name) =>
  SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);

/**
 * Helper Verifikasi PIN (Mendukung PIN Khusus Per Proyek di Tab Master_Proyek & PIN Master Admin)
 * Dilengkapi Rate Limiting berbasis CacheService untuk Mencegah Brute Force PIN
 */
function verifikasiAksesPin(pinInput) {
  const pin = String(pinInput || "").trim();
  if (!pin) return { valid: false, message: "PIN belum diisi." };

  const cache = CacheService.getScriptCache();
  const failKey = "pin_fail_count";
  const lockKey = "pin_lock_until";

  // Cek apakah sistem sedang terkunci sementara karena percobaan gagal berulang
  const isLocked = cache.get(lockKey);
  if (isLocked) {
    return {
      valid: false,
      message:
        "Terlalu banyak percobaan PIN salah. Sistem dikunci selama 5 menit demi keamanan.",
    };
  }

  // 1. Cek PIN Master Admin Kantor
  if (pin === CONFIG.PIN_MASTER) {
    cache.remove(failKey); // Reset percobaan jika berhasil
    return { valid: true, isAdmin: true, proyekFilter: null, pelaksana: null };
  }

  // 2. Cek PIN Khusus Proyek di Tab Master_Proyek (Kolom D)
  const sheetProyek = getSheet(CONFIG.SHEET_PROYEK);
  if (sheetProyek) {
    const dataP = sheetProyek.getDataRange().getValues();
    const headerRow = dataP.findIndex((r) =>
      r.some((c) => String(c).trim() === "Nama_Proyek")
    );
    const startIdx = Math.max(1, headerRow + 1);

    // Cari kolom "PIN_Proyek" atau default ke kolom D (index 3)
    let pinColIdx = 3;
    if (headerRow >= 0) {
      const idx = dataP[headerRow].findIndex((c) => /pin/i.test(String(c)));
      if (idx >= 0) pinColIdx = idx;
    }

    for (let i = startIdx; i < dataP.length; i++) {
      const row = dataP[i];
      const nama = String(row[0] || "").trim();
      const pelaksana = String(row[1] || "").trim();
      const status = String(row[2] || "").trim();
      const pinProyek = String(row[pinColIdx] || "").trim();

      if (nama && pinProyek && pinProyek === pin) {
        if (status.toLowerCase() === "nonaktif") {
          return {
            valid: false,
            message: `Proyek "${nama}" berstatus Nonaktif.`,
          };
        }
        cache.remove(failKey); // Reset jika berhasil login
        return {
          valid: true,
          isAdmin: false,
          proyekFilter: nama,
          pelaksana: pelaksana || "-",
        };
      }
    }
  }

  // Catat percobaan gagal untuk proteksi Brute Force (Maksimal 10x gagal berturut-turut)
  let failCount = parseInt(cache.get(failKey) || "0", 10) + 1;
  if (failCount >= 10) {
    cache.put(lockKey, "locked", 300); // Kunci selama 300 detik (5 menit)
    cache.remove(failKey);
    return {
      valid: false,
      message:
        "PIN Proyek salah 10 kali. Akses dibekukan sementara selama 5 menit.",
    };
  } else {
    cache.put(failKey, String(failCount), 600); // Simpan hitungan selama 10 menit
  }

  return {
    valid: false,
    message: `PIN Proyek tidak dikenali. (Sisa percobaan: ${10 - failCount})`,
  };
}

/**
 * 1. GET: Ambil Daftar Proyek & Pekerja Aktif + Status Absen Hari Ini
 */
function doGet(e) {
  try {
    const auth = verifikasiAksesPin(e.parameter.pin);
    if (!auth.valid) {
      return jsonRes({
        status: "error",
        message: auth.message || "PIN Proyek salah.",
      });
    }

    const daftarProyek = [],
      proyekSet = new Set();
    const sheetProyek = getSheet(CONFIG.SHEET_PROYEK);

    // Gunakan tanggal dari parameter jika ada, default hari ini WIB
    const paramTgl = (e.parameter.tanggal || "").trim();
    const todayStr = paramTgl || Utilities.formatDate(
      new Date(),
      CONFIG.TIMEZONE,
      "yyyy-MM-dd"
    );

    // 1. Ambil data proyek (Admin = semua, Pelaksana = proyek sendiri)
    if (auth.isAdmin) {
      if (sheetProyek) {
        const dataP = sheetProyek.getDataRange().getValues();
        const startIdx = Math.max(
          1,
          dataP.findIndex((r) => r[0] === "Nama_Proyek") + 1
        );
        for (let i = startIdx; i < dataP.length; i++) {
          const [nama, pelaksana, status] = dataP[i].map((v) =>
            String(v || "").trim()
          );
          if (nama && (status.toLowerCase() === "aktif" || !status)) {
            daftarProyek.push({
              nama_proyek: nama,
              pelaksana_lapangan: pelaksana || "-",
            });
            proyekSet.add(nama);
          }
        }
      }
    } else {
      daftarProyek.push({
        nama_proyek: auth.proyekFilter,
        pelaksana_lapangan: auth.pelaksana,
      });
      proyekSet.add(auth.proyekFilter);
    }

    // 2. Kumpulkan data siapa saja yang SUDAH diabsen hari ini dari Log_Absensi
    const sheetLog = getSheet(CONFIG.SHEET_LOG);
    const sudahAbsenMap = {};
    // Track operator terakhir per mandor+proyek+tanggal
    const operatorPerMandor = {};
    if (sheetLog) {
      const logData = sheetLog.getDataRange().getValues();
      for (let i = 1; i < logData.length; i++) {
        const rowTgl = logData[i][1]; // Kolom B: Tanggal
        const tglFormatted = formatTglStr(rowTgl);
        if (tglFormatted === todayStr) {
          const rowProyek = String(logData[i][2] || "").trim(); // Kolom C: Nama_Proyek
          // Hanya muat data absensi proyek yang berhak diakses
          if (auth.isAdmin || rowProyek === auth.proyekFilter) {
            const id = String(logData[i][5] || "").trim(); // Kolom F: ID_Pekerja
            const rowMandor = String(logData[i][3] || "").trim(); // Kolom D: Nama_Mandor
            const rowOperator = String(logData[i][4] || "").trim(); // Kolom E: Nama_Operator
            if (id && rowProyek) {
              // Kunci unik: ID_Pekerja + Nama_Proyek (Mendukung 1 pekerja di multi proyek dalam 1 hari)
              sudahAbsenMap[`${id}___${rowProyek}`] = {
                status_hadir: Number(logData[i][8]),
                jam_lembur: Number(logData[i][9] || 0),
                uang_makan: Number(logData[i][10] || 0),
                catatan: String(logData[i][13] || ""),
              };
            }
            // Catat operator terakhir per mandor+proyek
            if (rowMandor && rowProyek && rowOperator) {
              operatorPerMandor[`${rowMandor}___${rowProyek}`] = rowOperator;
            }
          }
        }
      }
    }

    // 3. Ambil data pekerja dari Master_Pekerja (HANYA milik proyek yang diakses)
    const dataM = getSheet(CONFIG.SHEET_MASTER).getDataRange().getValues();
    const pekerjaAktif = [];

    for (let i = 1; i < dataM.length; i++) {
      const [id, nama, keahlian, proyek, mandor, status] = dataM[i].map((v) =>
        String(v || "").trim()
      );

      // Filter ketat: jika pelaksana, abaikan total seluruh pekerja proyek lain
      if (!auth.isAdmin && proyek !== auth.proyekFilter) continue;

      if (auth.isAdmin && proyek && !proyekSet.has(proyek)) {
        daftarProyek.push({ nama_proyek: proyek, pelaksana_lapangan: "-" });
        proyekSet.add(proyek);
      }
      if (id && status.toLowerCase() === "aktif") {
        const lookupKey = `${id}___${proyek}`;
        const infoAbsen = sudahAbsenMap[lookupKey];
        pekerjaAktif.push({
          id_pekerja: id,
          nama_pekerja: nama,
          keahlian,
          proyek_default: proyek,
          nama_mandor: mandor,
          sudah_absen: !!infoAbsen,
          status_hadir: infoAbsen ? infoAbsen.status_hadir : 1,
          jam_lembur: infoAbsen ? infoAbsen.jam_lembur : 0,
          uang_makan: infoAbsen ? infoAbsen.uang_makan : 0,
          catatan: infoAbsen ? infoAbsen.catatan : "",
        });
      }
    }

    return jsonRes({
      status: "success",
      is_admin: auth.isAdmin,
      proyek_terkunci: auth.proyekFilter || "",
      daftar_proyek: daftarProyek,
      daftar_pekerja: pekerjaAktif,
      operator_per_mandor: operatorPerMandor,
    });
  } catch (err) {
    return jsonRes({
      status: "error",
      message: "Gagal memuat data: " + err.message,
    });
  }
}

/**
 * 2. POST: Terima Data Absensi & Tambah Pekerja Baru
 */
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);

    const auth = verifikasiAksesPin(payload.pin);
    if (!auth.valid) {
      return jsonRes({
        status: "error",
        message: auth.message || "PIN Proyek tidak valid.",
      });
    }

    // Proteksi Server: Pelaksana dilarang memanipulasi proyek orang lain
    if (!auth.isAdmin) {
      if (payload.nama_proyek && payload.nama_proyek !== auth.proyekFilter) {
        return jsonRes({
          status: "error",
          message: "Akses ditolak: bukan proyek Anda.",
        });
      }
      if (
        payload.proyek_default &&
        payload.proyek_default !== auth.proyekFilter
      ) {
        return jsonRes({
          status: "error",
          message: "Akses ditolak: bukan proyek Anda.",
        });
      }
    }

    if (payload.action === "tambah_pekerja")
      return handleTambahPekerja(payload);
    if (payload.action === "kirim_absensi") return handleKirimAbsensi(payload);
    return jsonRes({ status: "error", message: "Aksi tidak dikenali." });
  } catch (err) {
    return jsonRes({
      status: "error",
      message: "Gangguan server: " + err.message,
    });
  }
}

/**
 * TAMBAH PEKERJA BARU (Ke Tab Master_Pekerja)
 */
function handleTambahPekerja(payload) {
  const namaPekerja = sanitizeText(payload.nama_pekerja);
  if (!namaPekerja)
    return jsonRes({ status: "error", message: "Nama pekerja wajib diisi." });

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000); // Batas waktu tunggu dinaikkan ke 30 detik
    const sheet = getSheet(CONFIG.SHEET_MASTER);
    const lastRow = getActualLastRow(sheet, 1);

    // Penomoran ID otomatis berbasis angka ID tertinggi (aman dari duplikat)
    const allIds = sheet
      .getRange(2, 1, Math.max(lastRow - 1, 1), 1)
      .getValues();
    const maxNum = allIds.reduce(
      (max, [id]) =>
        Math.max(max, parseInt(String(id || "").match(/\d+/) || 0, 10)),
      0
    );
    const newId = "PKR-" + String(maxNum + 1).padStart(3, "0");

    // Validasi & Batasi Angka Upah (Maksimal 1 juta per hari untuk mencegah eksploitasi)
    const upah = clampNumber(payload.upah_harian, 0, 1000000, 0);
    const lembur = clampNumber(
      payload.tarif_lembur,
      0,
      200000,
      upah > 0 ? Math.ceil(upah / 7 / 100) * 100 : 0
    );
    const makan = clampNumber(payload.tarif_uang_makan, 0, 100000, 10000);

    const mandorInput = sanitizeText(payload.nama_mandor);
    const keahlianInput = sanitizeText(payload.keahlian);
    const proyekInput = sanitizeText(payload.proyek_default);
    const isMandor = keahlianInput === "Mandor";

    // Standarisasi: Pastikan Kolom E (Nama_Mandor) selalu diawali "Mandor "
    let mandor = mandorInput;
    if (isMandor || !mandor) {
      const baseName = mandor || namaPekerja;
      mandor = baseName.toLowerCase().startsWith("mandor")
        ? baseName
        : `Mandor ${baseName}`;
    } else if (mandor && !mandor.toLowerCase().startsWith("mandor")) {
      mandor = `Mandor ${mandor}`;
    }

    const targetRow = lastRow + 1;
    const newRow = [
      newId,
      namaPekerja,
      keahlianInput,
      proyekInput,
      mandor,
      "Aktif",
      upah,
      lembur,
      makan,
    ];

    if (targetRow > sheet.getMaxRows())
      sheet.insertRowAfter(sheet.getMaxRows());
    if (lastRow >= 1) {
      try {
        const prevRange = sheet.getRange(lastRow, 1, 1, 9);
        const targetRange = sheet.getRange(targetRow, 1, 1, 9);
        // Salin format tampilan (border, font, warna) tanpa menimpa aturan validasi data
        prevRange.copyTo(
          targetRange,
          SpreadsheetApp.CopyPasteType.PASTE_FORMAT,
          false
        );
      } catch (_) {}
    }

    try {
      sheet.getRange(targetRow, 1, 1, 9).setValues([newRow]);
    } catch (errWrite) {
      // Fallback aman jika sheet disetel tolak masukan ketat
      sheet.getRange(targetRow, 1, 1, 9).clearDataValidations();
      sheet.getRange(targetRow, 1, 1, 9).setValues([newRow]);
    }

    // Jika pekerja adalah Mandor, otomatis catat namanya ke daftar referensi Master_Proyek Kolom F
    if (keahlianInput === "Mandor" || isMandor) {
      try {
        const sheetProyek = getSheet(CONFIG.SHEET_PROYEK);
        if (sheetProyek) {
          const lastPRow = Math.max(sheetProyek.getLastRow(), 5);
          const existingF = sheetProyek
            .getRange(5, 6, Math.max(lastPRow - 4, 1), 1)
            .getValues()
            .flat()
            .map((v) => String(v || "").trim())
            .filter(Boolean);

          if (mandor && !existingF.includes(mandor)) {
            let targetFRow = 5;
            while (sheetProyek.getRange(targetFRow, 6).getValue()) {
              targetFRow++;
            }
            sheetProyek.getRange(targetFRow, 6).setValue(mandor);
          }
        }
      } catch (_) {}
    }

    return jsonRes({
      status: "success",
      message: "Pekerja baru berhasil didaftarkan.",
      pekerja: {
        id_pekerja: newId,
        nama_pekerja: payload.nama_pekerja,
        keahlian: payload.keahlian,
        proyek_default: payload.proyek_default || "",
        nama_mandor: mandor,
        sudah_absen: false,
        status_hadir: 1,
        jam_lembur: 0,
        uang_makan: 0,
        catatan: "",
      },
    });
  } finally {
    lock.releaseLock();
  }
}

/**
 * SIMPAN ABSENSI HARIAN (ANTI DUPLIKAT DENGAN SISTEM UPSERT)
 */
function handleKirimAbsensi(payload) {
  const now = new Date();
  const timestamp = Utilities.formatDate(
    now,
    CONFIG.TIMEZONE,
    "yyyy-MM-dd HH:mm:ss"
  );
  const jamWib = Utilities.formatDate(now, CONFIG.TIMEZONE, "HH:mm");

  // Gunakan tanggal dari frontend jika dikirim, default hari ini WIB
  const paramTgl = (payload.tanggal_absensi || "").trim();
  const tglStr = paramTgl || Utilities.formatDate(now, CONFIG.TIMEZONE, "yyyy-MM-dd");
  const tanggalDate = new Date(tglStr.replace(/-/g, "/") + " 00:00:00");

  const daftar = payload.daftar_absensi || [];
  if (!daftar.length)
    return jsonRes({ status: "error", message: "Daftar absensi kosong." });

  // 1. Validasi Ukuran Foto Base64 (Maksimal 6 MB untuk cegah DoS kuota Drive)
  const fotoStr = String(payload.foto_base64 || "");
  if (fotoStr.length > 8 * 1024 * 1024) {
    return jsonRes({
      status: "error",
      message: "Ukuran foto terlalu besar. Silakan ambil ulang foto.",
    });
  }

  // Simpan foto ke Google Drive DILUAR LOCK (agar upload foto tidak memblokir antrean server)
  const linkFoto = fotoStr
    ? simpanFotoKeDrive(fotoStr, payload.nama_proyek, tglStr, jamWib)
    : "-";

  // 2. Kunci Spreadsheet HANYA saat proses penulisan ke sheet Log_Absensi (< 0.5 detik)
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000); // Batas waktu tunggu dinaikkan ke 30 detik
    const sheet = getSheet(CONFIG.SHEET_LOG);

    // Peta baris yang sudah ada hari ini di Log_Absensi per Proyek:
    // key = ID_Pekerja + "___" + Nama_Proyek -> nomor baris (1-based)
    // Ini memungkinkan pekerja yang sama bekerja di 2 proyek berbeda pada hari yang sama tanpa saling menimpa
    const logValues = sheet.getDataRange().getValues();
    const existingRowMap = {};
    for (let i = 1; i < logValues.length; i++) {
      const rowTgl = logValues[i][1];
      const rowTglStr = formatTglStr(rowTgl);
      if (rowTglStr === tglStr) {
        const rowProyek = String(logValues[i][2] || "").trim(); // Kolom C: Nama_Proyek
        const id = String(logValues[i][5] || "").trim(); // Kolom F: ID_Pekerja
        if (id && rowProyek) existingRowMap[`${id}___${rowProyek}`] = i + 1;
      }
    }

    // Validasi Keamanan: Batasi jumlah pekerja dalam satu kali kirim (Maksimal 200 pekerja per batch)
    if (daftar.length > 200) {
      return jsonRes({
        status: "error",
        message:
          "Jumlah data melebihi batas wajar (maksimal 200 pekerja per kirim).",
      });
    }

    const rowsToInsert = [];
    let updateCount = 0;

    daftar.forEach((item) => {
      const lookupKey = `${item.id_pekerja}___${payload.nama_proyek}`;
      const existingRow = existingRowMap[lookupKey];
      const prevFoto = existingRow
        ? String(logValues[existingRow - 1][12] || "-")
        : "-";
      // Untuk baris yg sudah ada: pertahankan foto asli (jangan timpa dgn foto batch baru)
      // Untuk baris baru: gunakan foto yang diupload, atau "-" jika tidak ada
      const fotoFinal = existingRow
        ? prevFoto
        : linkFoto !== "-"
        ? linkFoto
        : "-";

      // Validasi Keamanan & Sanitasi Nilai Setiap Pekerja
      let sh = Number(item.status_hadir);
      if (sh !== 1 && sh !== 0.5 && sh !== 0) sh = 1; // Hanya boleh 1, 0.5, atau 0

      const jl = clampNumber(item.jam_lembur, 0, 12, 0); // Maksimal lembur 12 jam
      const um =
        jl >= 7 || Number(item.uang_makan) === 1
          ? sh === 0
            ? 0
            : Number(item.uang_makan)
            ? 1
            : 0
          : 0;
      const catatanClean = sanitizeText(item.catatan);

      const rowData = [
        timestamp, // A: Timestamp
        tanggalDate, // B: Tanggal
        sanitizeText(payload.nama_proyek), // C: Nama_Proyek
        sanitizeText(payload.nama_mandor || item.nama_mandor || "-"), // D: Nama_Mandor
        sanitizeText(payload.nama_operator), // E: Nama_Operator
        sanitizeText(item.id_pekerja), // F: ID_Pekerja
        sanitizeText(item.nama_pekerja), // G: Nama_Pekerja
        sanitizeText(item.keahlian), // H: Keahlian
        sh, // I: Status_Hadir (Validated: 1, 0.5, 0)
        jl, // J: Jam_Lembur (Validated: 0..12)
        um, // K: Uang_Makan (Validated: 0/1)
        sanitizeText(payload.koordinat_gps || "-"), // L: Koordinat_GPS
        fotoFinal, // M: Link_Foto_Bukti
        catatanClean, // N: Catatan (Sanitized from Formula Injection)
      ];

      if (existingRow) {
        // Pertahankan Timestamp asli (Kolom A) — hanya perbarui Kolom B–N
        rowData[0] = logValues[existingRow - 1][0];
        sheet.getRange(existingRow, 1, 1, 14).setValues([rowData]);
        updateCount++;
      } else {
        rowsToInsert.push(rowData);
      }
    });

    if (rowsToInsert.length > 0) {
      const lastRow = getActualLastRow(sheet, 1);
      const startRow = lastRow + 1;
      const neededRows = startRow + rowsToInsert.length - 1;
      if (neededRows > sheet.getMaxRows())
        sheet.insertRowsAfter(
          sheet.getMaxRows(),
          neededRows - sheet.getMaxRows()
        );
      if (lastRow >= 1) {
        try {
          sheet
            .getRange(lastRow, 1, 1, 14)
            .copyTo(
              sheet.getRange(startRow, 1, rowsToInsert.length, 14),
              SpreadsheetApp.CopyPasteType.PASTE_FORMAT,
              false
            );
        } catch (_) {}
      }
      try {
        sheet
          .getRange(startRow, 1, rowsToInsert.length, 14)
          .clearDataValidations();
      } catch (_) {}
      sheet
        .getRange(startRow, 1, rowsToInsert.length, 14)
        .setValues(rowsToInsert);
    }

    const msg =
      rowsToInsert.length && updateCount
        ? `Tersimpan: ${rowsToInsert.length} data baru & ${updateCount} data diperbarui.`
        : rowsToInsert.length
        ? `Absensi ${rowsToInsert.length} pekerja berhasil disimpan.`
        : `${updateCount} data absensi berhasil diperbarui.`;

    return jsonRes({
      status: "success",
      message: `${msg} (${jamWib} WIB)`,
      jumlah_tersimpan: rowsToInsert.length + updateCount,
      link_foto: linkFoto,
    });
  } finally {
    lock.releaseLock();
  }
}

/**
 * HELPER: Format Nilai Tanggal Apapun ke YYYY-MM-DD
 */
function formatTglStr(val) {
  if (!val) return "";
  if (val instanceof Date)
    return Utilities.formatDate(val, CONFIG.TIMEZONE, "yyyy-MM-dd");
  if (typeof val === "number") {
    const d = new Date(Math.round((val - 25569) * 86400 * 1000));
    return Utilities.formatDate(d, CONFIG.TIMEZONE, "yyyy-MM-dd");
  }
  const s = String(val).trim().split("T")[0];
  if (s.includes("/")) {
    const p = s.split("/");
    if (p[0].length === 4)
      return `${p[0]}-${p[1].padStart(2, "0")}-${p[2].padStart(2, "0")}`;
    return `${p[2]}-${p[1].padStart(2, "0")}-${p[0].padStart(2, "0")}`;
  }
  return s;
}

/**
 * HELPER: Ambil / Buat Folder Foto di Google Drive
 */
function getFolderBukti() {
  if (CONFIG.FOLDER_FOTO_ID && CONFIG.FOLDER_FOTO_ID.trim()) {
    try {
      return DriveApp.getFolderById(CONFIG.FOLDER_FOTO_ID.trim());
    } catch (_) {}
  }
  const folderName = "Foto_Absensi_Proyek";
  const folders = DriveApp.getFoldersByName(folderName);
  return folders.hasNext() ? folders.next() : DriveApp.createFolder(folderName);
}

/**
 * HELPER: Simpan Foto Base64 ke Google Drive
 */
function simpanFotoKeDrive(base64, namaProyek, tanggal, jamWib) {
  try {
    const cleanBase64 = base64.includes(",") ? base64.split(",")[1] : base64;
    // Validasi format Base64 yang valid (A-Z, a-z, 0-9, +, /, =)
    if (!/^[A-Za-z0-9+/=]+$/.test(cleanBase64.substring(0, 1000))) {
      return "-";
    }
    const blob = Utilities.newBlob(
      Utilities.base64Decode(cleanBase64),
      "image/jpeg",
      `Absensi_${String(namaProyek || "Proyek").replace(
        /[^a-zA-Z0-9_-]/g,
        "_"
      )}_${tanggal}_${String(jamWib || "").replace(":", "")}.jpg`
    );
    const file = getFolderBukti().createFile(blob);
    try {
      file.setSharing(
        DriveApp.Access.ANYONE_WITH_LINK,
        DriveApp.Permission.VIEW
      );
    } catch (_) {}
    return file.getUrl();
  } catch (err) {
    return "Gagal upload: " + err.message;
  }
}

/**
 * HELPER: Cari Baris Terakhir yang Terisi Data (Bebas dari Baris Kosong Berborder)
 */
function getActualLastRow(sheet, col = 1) {
  const vals = sheet.getRange(1, col, sheet.getMaxRows(), 1).getValues();
  for (let i = vals.length - 1; i >= 0; i--) {
    if (vals[i][0] !== "" && vals[i][0] !== null && vals[i][0] !== undefined)
      return i + 1;
  }
  return 1;
}

/**
 * HELPER KEAMANAN: Sanitasi String untuk Mencegah Formula Injection & Batasi Panjang Teks (DoS Payload)
 * Jika string diawali =, +, -, @, sisipkan tanda kutip (') di depan agar diperlakukan sebagai teks murni
 */
function sanitizeText(val, maxLen = 200) {
  if (val === null || val === undefined) return "";
  let str = String(val).trim();
  // Batasi panjang karakter untuk mencegah pembengkakan sel/memori spreadsheet
  if (str.length > maxLen) {
    str = str.substring(0, maxLen);
  }
  // Cegah injeksi formula Excel / Google Sheets (=, +, -, @, \t, \r)
  if (/^[=+\-@\t\r]/.test(str)) {
    return "'" + str;
  }
  return str;
}

/**
 * HELPER KEAMANAN: Validasi dan Pembatasan Nilai Input
 */
function clampNumber(val, min, max, defaultVal = 0) {
  const num = Number(val);
  if (isNaN(num)) return defaultVal;
  return Math.min(Math.max(num, min), max);
}

/**
 * HELPER: Format Output JSON
 */
function jsonRes(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(
    ContentService.MimeType.JSON
  );
}

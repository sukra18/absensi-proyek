// app-kirim.js - Foto, GPS, watermark, kirim absensi, modal tambah
// 4. Kompresi Foto Kamera, Proteksi Foto Realtime & Watermark Otomatis
function prosesFoto(e) {
  const file = e.target.files[0];
  if (!file) return;

  // Cek apakah foto terlalu lama (toleransi: file diambil/dimodifikasi dalam 12 jam terakhir)
  const now = Date.now();
  if (file.lastModified && (now - file.lastModified > 12 * 60 * 60 * 1000)) {
    alert("Peringatan: Foto yang dipilih terdeteksi foto lama. Harap gunakan kamera langsung di lokasi proyek.");
  }

  $('infoFoto').textContent = "Memproses foto & watermark...";

  const r = new FileReader();
  r.onload = ev => {
    const img = new Image();
    img.onload = async () => {
      const c = document.createElement('canvas'), maxW = 1024;
      let w = img.width, h = img.height;
      if (w > maxW) { h = Math.round((h * maxW) / w); w = maxW; }
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);

      // Ambil GPS untuk watermark (timeout 5 detik)
      let gpsText = "GPS: -";
      try {
        const gps = await getGPS();
        if (gps && !gps.includes("gagal") && !gps.includes("tidak")) {
          gpsText = "GPS: " + gps;
        }
      } catch (_) { }

      // Kumpulkan info watermark
      const namaProyek = $('selectProyek').value || "-";
      const namaMandor = $('selectMandor').value || "-";
      const waktu = new Date().toLocaleDateString("id-ID", {
        weekday: "long", day: "numeric", month: "long", year: "numeric"
      }) + "  " + new Date().toLocaleTimeString("id-ID", {
        hour: "2-digit", minute: "2-digit", second: "2-digit"
      }) + " WIB";

      const lines = [
        namaProyek,
        "Mandor: " + namaMandor,
        waktu,
        gpsText
      ];

      // Gambar watermark di pojok kiri bawah foto
      const fontSize = Math.max(12, Math.round(w * 0.028));
      const lineHeight = fontSize * 1.35;
      const padding = Math.round(fontSize * 0.7);
      const blockHeight = (lines.length * lineHeight) + (padding * 2);
      const blockY = h - blockHeight;

      // Background semi-transparan gelap
      ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
      ctx.fillRect(0, blockY, w, blockHeight);

      // Garis aksen biru di atas blok watermark
      ctx.fillStyle = "#3b82f6";
      ctx.fillRect(0, blockY, w, 3);

      // Teks watermark putih
      ctx.fillStyle = "#ffffff";
      ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
      ctx.textBaseline = "top";
      ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
      ctx.shadowBlur = 3;
      ctx.shadowOffsetX = 1;
      ctx.shadowOffsetY = 1;

      lines.forEach((text, idx) => {
        ctx.fillText(text, padding, blockY + padding + (idx * lineHeight));
      });

      // Reset shadow
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;

      fotoBase64 = c.toDataURL('image/jpeg', 0.7);

      $('previewFoto').src = fotoBase64;
      $('previewFoto').style.display = 'block';
      $('infoFoto').textContent = `Foto + watermark siap dikirim (${Math.round((fotoBase64.length * 3) / 4 / 1024)} KB).`;
    };
    img.src = ev.target.result;
  };
  r.readAsDataURL(file);
}

function getGPS() {
  return new Promise(res => {
    if (!navigator.geolocation) return res("GPS tidak didukung");
    navigator.geolocation.getCurrentPosition(
      p => res(`${p.coords.latitude.toFixed(6)}, ${p.coords.longitude.toFixed(6)}`),
      () => res("GPS gagal/tidak diizinkan"),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  });
}

// 5. Tampilkan Konfirmasi Sebelum Kirim (Hanya Kirim Data Baru atau yang Berubah)
async function kirimAbsensi() {
  $('alertBox').style.display = 'none';
  const mandor = $('selectMandor').value;
  if (!mandor) return notif("Pilih atau tambahkan Mandor terlebih dahulu.", false);
  if (!pekerjaTampil.length) return notif("Tidak ada pekerja di grup ini.", false);

  const pekerjaDikirim = pekerjaTampil.filter(isWorkerChanged);
  if (!pekerjaDikirim.length) {
    return notif("Semua pekerja di grup ini sudah diabsen dan tidak ada data yang diubah.", true);
  }

  // Foto hanya wajib jika BUKAN admin dan ada pekerja yang BELUM pernah diabsen hari ini
  const userIsAdmin = Boolean(isAdmin || currentPin === "9281");
  const adaPekerjaBaru = pekerjaDikirim.some(p => !p.sudah_absen);
  if (!userIsAdmin && adaPekerjaBaru && !fotoBase64) return notif("Ambil foto kelompok pekerja terlebih dahulu.", false);

  // Hitung ringkasan khusus pekerja yang dikirim
  const jumlahBaru = pekerjaDikirim.filter(p => !p.sudah_absen).length;
  const jumlahKoreksi = pekerjaDikirim.filter(p => p.sudah_absen).length;
  const jumlahFull = pekerjaDikirim.filter(p => p.status_hadir === 1).length;
  const jumlahSetengah = pekerjaDikirim.filter(p => p.status_hadir === 0.5).length;
  const jumlahAbsen = pekerjaDikirim.filter(p => p.status_hadir === 0).length;
  const totalLembur = pekerjaDikirim.reduce((s, p) => s + (Number(p.jam_lembur) || 0), 0);
  const jumlahMakan = pekerjaDikirim.filter(p => p.uang_makan === 1).length;

  $('konfirmasiRingkasan').innerHTML = `
    <div class="konfirmasi-info">
      <div class="konfirmasi-row"><span>Proyek</span><strong>${$('selectProyek').value}</strong></div>
      <div class="konfirmasi-row"><span>Mandor</span><strong>${mandor}</strong></div>
      <div class="konfirmasi-row"><span>Pekerja yang Dikirim</span><strong>${pekerjaDikirim.length} orang</strong></div>
      ${jumlahBaru > 0 ? `<div class="konfirmasi-row"><span>• Pekerja Baru (Belum Absen)</span><strong style="color:var(--primary);">${jumlahBaru} orang</strong></div>` : ''}
      ${jumlahKoreksi > 0 ? `<div class="konfirmasi-row"><span>• Koreksi/Perubahan Data</span><strong style="color:#d97706;">${jumlahKoreksi} orang</strong></div>` : ''}
    </div>
    <div class="konfirmasi-info">
      <div class="konfirmasi-row"><span>Full (1 hari)</span><span class="badge-full">${jumlahFull} orang</span></div>
      <div class="konfirmasi-row"><span>Setengah Hari</span><span class="badge-half">${jumlahSetengah} orang</span></div>
      <div class="konfirmasi-row"><span>Tidak Hadir</span><span class="badge-absen">${jumlahAbsen} orang</span></div>
      <div class="konfirmasi-row"><span>Total Lembur</span><span>${totalLembur > 0 ? totalLembur + ' jam' : '-'}</span></div>
      <div class="konfirmasi-row"><span>Dapat Uang Makan</span><span>${jumlahMakan > 0 ? jumlahMakan + ' orang' : '-'}</span></div>
    </div>
  `;
  $('modalKonfirmasi').showModal();
}

// 5b. Proses Kirim Setelah Dikonfirmasi
async function kirimAbsensiProses() {
  $('modalKonfirmasi').close();
  const mandor = $('selectMandor').value;
  const pekerjaDikirim = pekerjaTampil.filter(isWorkerChanged);
  if (!pekerjaDikirim.length) return;

  const btn = $('btnKirim');
  btn.disabled = true; btn.textContent = "Mengirim absensi...";

  try {
    const gps = await getGPS();
    const res = await postApi("kirim_absensi", {
      nama_proyek: $('selectProyek').value,
      nama_mandor: mandor,
      nama_operator: $('inputOperator').value.trim(),
      koordinat_gps: gps,
      foto_base64: fotoBase64,
      tanggal_absensi: getSelectedTanggal(),
      daftar_absensi: pekerjaDikirim
    });

    if (res.status === "success") {
      notif(res.message, true);
      fotoBase64 = "";
      $('previewFoto').style.display = 'none';
      $('infoFoto').textContent = "";

      // Tandai seluruh pekerja yang dikirim sebagai "Sudah Absen" & catat baseline
      pekerjaDikirim.forEach(p => {
        p.sudah_absen = true;
        p._orig_status = p.status_hadir;
        p._orig_lembur = p.jam_lembur;
        p._orig_makan = p.uang_makan;
        p._orig_catatan = p.catatan;
      });
      renderDaftarPekerja();
    } else {
      notif(res.message || "Gagal menyimpan absensi.", false);
    }
  } catch (err) {
    console.error("Gagal kirim absensi:", err);
    notif(`Pengiriman gagal (${err.message || 'gangguan sinyal'}). Coba tekan Kirim kembali.`, false);
  } finally {
    btn.disabled = false; btn.textContent = "Kirim Absensi Grup Ini";
  }
}

// 6. Modal Tambah Mandor / Pekerja
function bukaModal(mandorMode) {
  isTambahMandor = mandorMode;
  const proyek = $('selectProyek').value, mandor = $('selectMandor').value;
  if (!mandorMode && !mandor) return notif("Tambahkan Mandor Baru terlebih dahulu.", false);

  $('modalJudul').textContent = mandorMode ? "Tambah Mandor Baru" : "Tambah Pekerja Baru";
  $('modalSub').textContent = mandorMode ? `Proyek: ${proyek}` : `Proyek: ${proyek} (${mandor})`;
  $('labelNama').textContent = mandorMode ? "Nama Mandor" : "Nama Lengkap";
  $('inputNamaBaru').placeholder = mandorMode ? "Contoh: Mandor Joko" : "Contoh: Slamet Riyadi";
  $('wrapperKeahlian').style.display = mandorMode ? 'none' : 'block';
  $('inputNamaBaru').value = "";

  $('modalPekerja').showModal();
}

async function simpanPekerja() {
  const nama = $('inputNamaBaru').value.trim();
  if (!nama) return alert("Nama wajib diisi.");

  const proyek = $('selectProyek').value, mandor = $('selectMandor').value;
  const keahlian = isTambahMandor ? "Mandor" : $('selectKeahlian').value;
  const mandorKirim = isTambahMandor
    ? (nama.toLowerCase().startsWith("mandor ") ? nama : `Mandor ${nama}`)
    : mandor;
  const btn = $('btnSimpanModal');

  btn.disabled = true; btn.textContent = "Menyimpan...";

  try {
    const res = await postApi("tambah_pekerja", {
      nama_pekerja: nama,
      keahlian: keahlian,
      proyek_default: proyek,
      nama_mandor: mandorKirim
    });

    if (res.status === "success") {
      semuaPekerja.push({
        ...res.pekerja,
        status_hadir: 1,
        jam_lembur: 0,
        uang_makan: 0,
        catatan: "",
        sudah_absen: false,
        _orig_status: null,
        _orig_lembur: null,
        _orig_makan: null,
        _orig_catatan: null
      });
      $('modalPekerja').close();
      const targetMandor = (res.pekerja && res.pekerja.nama_mandor) ? res.pekerja.nama_mandor : mandorKirim;
      if (isTambahMandor) onProyekChange(targetMandor);
      else onMandorChange();
      notif(`${isTambahMandor ? 'Mandor' : 'Pekerja'} "${nama}" berhasil didaftarkan.`, true);
    } else {
      alert(res.message || "Gagal menyimpan.");
    }
  } catch (err) {
    console.error("Gagal simpan pekerja:", err);
    alert(`Gagal terhubung ke server: ${err.message || 'Periksa koneksi internet Anda.'}`);
  } finally {
    btn.disabled = false; btn.textContent = "Simpan";
  }
}

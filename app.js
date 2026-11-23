const URL_GAS = "https://script.google.com/macros/s/AKfycbws5ZAyiHw5wLzjnHmuRXxYej-sLFlZ2qR9UsY6zsyQRDgdqhCWOYbSNhVBKq-hrdI/exec";
const $ = id => document.getElementById(id);

let currentPin = "", daftarProyek = [], semuaPekerja = [], pekerjaTampil = [], fotoBase64 = "";
let isTambahMandor = false;

$('tanggalHariIni').textContent = new Date().toLocaleDateString("id-ID", {
  weekday: "long", day: "numeric", month: "long", year: "numeric"
});

// Helper Alert
function notif(pesan, sukses = true) {
  const b = $('alertBox');
  b.textContent = pesan;
  b.className = 'alert ' + (sukses ? 'alert-success' : 'alert-error');
  b.style.display = 'block';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Helper Reset Foto (dipanggil saat ganti proyek atau mandor)
function resetFoto() {
  fotoBase64 = "";
  $('previewFoto').style.display = 'none';
  $('previewFoto').src = "";
  $('infoFoto').textContent = "";
  const inputFoto = document.querySelector('input[type="file"]');
  if (inputFoto) inputFoto.value = "";
}

// Helper Request API ke Google Apps Script
async function postApi(action, data = {}) {
  const res = await fetch(URL_GAS, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ pin: currentPin, action, ...data })
  });
  return await res.json();
}

// 1. Verifikasi PIN & Muat Data Master
async function verifikasiPin() {
  $('alertBox').style.display = 'none';
  const pin = $('inputPin').value.trim();
  if (!pin) return notif("Masukkan PIN Proyek terlebih dahulu.", false);

  const btn = $('btnMasuk');
  btn.disabled = true; btn.textContent = "Memuat data...";

  try {
    const res = await fetch(`${URL_GAS}?pin=${encodeURIComponent(pin)}`);
    const data = await res.json();
    if (data.status !== "success") return notif(data.message || "PIN salah.", false);

    currentPin = pin;
    daftarProyek = data.daftar_proyek || [];
    semuaPekerja = (data.daftar_pekerja || []).map(p => {
      const sh = p.status_hadir !== undefined ? p.status_hadir : 1;
      const jl = Number(p.jam_lembur || 0);
      const um = Number(p.uang_makan || 0);
      const ct = p.catatan || "";
      const sudah = !!p.sudah_absen;
      return {
        ...p,
        status_hadir: sh,
        jam_lembur: jl,
        uang_makan: um,
        catatan: ct,
        sudah_absen: sudah,
        _orig_status: sudah ? sh : null,
        _orig_lembur: sudah ? jl : null,
        _orig_makan: sudah ? um : null,
        _orig_catatan: sudah ? ct : null
      };
    });

    const isAdmin = !!data.is_admin;
    $('selectProyek').innerHTML = daftarProyek.map(p => `<option value="${p.nama_proyek}">${p.nama_proyek}</option>`).join('');

    const labelP = $('labelProyek');
    if (labelP) {
      labelP.textContent = isAdmin ? "1. Pilih Proyek / Lokasi (Mode Admin)" : "1. Lokasi Proyek (Terkunci)";
    }
    $('selectProyek').disabled = !isAdmin && daftarProyek.length <= 1;

    onProyekChange();

    $('pinSection').classList.add('hidden');
    $('mainSection').classList.remove('hidden');
  } catch (err) {
    console.error("Gagal verifikasi PIN:", err);
    notif(`Gagal terhubung ke server: ${err.message || 'Periksa sinyal internet.'}`, false);
  } finally {
    btn.disabled = false; btn.textContent = "Masuk";
  }
}

// 2. Filter Proyek & Mandor
function onProyekChange(overrideMandor = "") {
  resetFoto();
  const proyek = $('selectProyek').value;
  const info = daftarProyek.find(p => p.nama_proyek === proyek);
  $('inputOperator').value = info ? info.pelaksana_lapangan : "-";

  const mandors = [...new Set(semuaPekerja.filter(p => p.proyek_default === proyek && p.nama_mandor).map(p => p.nama_mandor))];
  const sel = $('selectMandor');
  sel.innerHTML = mandors.length 
    ? mandors.map(m => `<option value="${m}">${m}</option>`).join('')
    : '<option value="">-- Belum ada mandor (+ Mandor Baru) --</option>';

  if (overrideMandor && mandors.includes(overrideMandor)) sel.value = overrideMandor;
  onMandorChange();
}

function onMandorChange() {
  resetFoto();
  const proyek = $('selectProyek').value, mandor = $('selectMandor').value;
  pekerjaTampil = semuaPekerja.filter(p => p.proyek_default === proyek && p.nama_mandor === mandor);
  renderDaftarPekerja();
}

// Helper: Cek apakah pekerja memiliki perubahan data dibanding data awal hari ini
function cekStatusPerubahan(p) {
  if (!p.sudah_absen) return "baru";
  const changed = (
    p.status_hadir !== p._orig_status ||
    p.jam_lembur !== p._orig_lembur ||
    p.uang_makan !== p._orig_makan ||
    (p.catatan || "").trim() !== (p._orig_catatan || "").trim()
  );
  return changed ? "ubah" : "tetap";
}

function isWorkerChanged(p) {
  return cekStatusPerubahan(p) !== "tetap";
}

function updateBadgeKartu(i) {
  const p = pekerjaTampil[i];
  const card = document.querySelector(`.worker-item[data-idx="${i}"]`);
  if (!card) return;
  const st = cekStatusPerubahan(p);
  const badge = card.querySelector('.badge-status');
  if (badge) {
    if (st === "baru") {
      badge.className = "badge-status badge-pending";
      badge.textContent = "Belum Absen";
      card.className = "worker-item";
    } else if (st === "ubah") {
      badge.className = "badge-status badge-modified";
      badge.textContent = "✎ Ada Perubahan";
      card.className = "worker-item is-modified";
    } else {
      badge.className = "badge-status badge-done";
      badge.textContent = "✓ Sudah Absen";
      card.className = "worker-item is-done";
    }
  }
}

// 3. Render Daftar Pekerja dengan Indikator Status Absen
function renderDaftarPekerja() {
  const list = $('workerList');
  $('jumlahPekerja').textContent = pekerjaTampil.length;

  if (!pekerjaTampil.length) {
    list.innerHTML = `<p style="color:#6b7280; text-align:center;">Belum ada pekerja di grup ini. Klik <b>+ Pekerja Baru</b>.</p>`;
    return;
  }

  list.innerHTML = pekerjaTampil.map((p, i) => {
    const st = cekStatusPerubahan(p);
    let badgeClass = "badge-done", badgeText = "✓ Sudah Absen", itemClass = "is-done";
    if (st === "baru") {
      badgeClass = "badge-pending"; badgeText = "Belum Absen"; itemClass = "";
    } else if (st === "ubah") {
      badgeClass = "badge-modified"; badgeText = "✎ Ada Perubahan"; itemClass = "is-modified";
    }

    return `
    <div class="worker-item ${itemClass}" data-idx="${i}">
      <div class="flex-between">
        <div>
          <span class="worker-name">${p.nama_pekerja}</span>
          <span class="worker-role">${p.keahlian}</span>
        </div>
        <span class="badge-status ${badgeClass}">${badgeText}</span>
      </div>
      <div class="status-group">
        <button type="button" class="status-btn ${p.status_hadir === 1 ? 'active-full' : ''}" onclick="setStatus(${i}, 1, this)">Full (1)</button>
        <button type="button" class="status-btn ${p.status_hadir === 0.5 ? 'active-half' : ''}" onclick="setStatus(${i}, 0.5, this)">1/2 Hari</button>
        <button type="button" class="status-btn ${p.status_hadir === 0 ? 'active-absent' : ''}" onclick="setStatus(${i}, 0, this)">Absen (0)</button>
      </div>
      <button type="button" class="meal-btn ${p.uang_makan === 1 ? 'active-meal' : ''}" onclick="toggleMakan(${i}, this)">
        ${p.uang_makan === 1 ? '✓ Dapat Uang Makan (Lembur s.d. 22.00 WIB)' : '+ Centang Uang Makan (Lembur s.d. 22.00 WIB)'}
      </button>
      <div class="extra-inputs">
        <input type="number" min="0" max="12" step="0.5" placeholder="Lembur (jam)" value="${p.jam_lembur || ''}" oninput="pekerjaTampil[${i}].jam_lembur = Number(this.value || 0); updateBadgeKartu(${i});">
        <input type="text" placeholder="Catatan singkat (opsional)" value="${p.catatan}" oninput="pekerjaTampil[${i}].catatan = this.value; updateBadgeKartu(${i});">
      </div>
    </div>
  `;
  }).join('');
}

// Update Status & Meal Tanpa Re-render Total
function setStatus(i, val, btn) {
  const p = pekerjaTampil[i];
  p.status_hadir = val;
  if (val === 0) { p.uang_makan = 0; p.jam_lembur = 0; }

  const card = btn.closest('.worker-item');
  card.querySelectorAll('.status-btn').forEach(b => b.className = 'status-btn');
  btn.className = `status-btn ${val === 1 ? 'active-full' : val === 0.5 ? 'active-half' : 'active-absent'}`;

  const mealBtn = card.querySelector('.meal-btn');
  mealBtn.className = `meal-btn ${p.uang_makan ? 'active-meal' : ''}`;
  mealBtn.textContent = p.uang_makan ? '✓ Dapat Uang Makan (Lembur s.d. 22.00 WIB)' : '+ Centang Uang Makan (Lembur s.d. 22.00 WIB)';

  if (val === 0) {
    const numInput = card.querySelector('input[type="number"]');
    if (numInput) numInput.value = '';
  }

  updateBadgeKartu(i);
}

function toggleMakan(i, btn) {
  const p = pekerjaTampil[i];
  if (p.status_hadir === 0) return;
  p.uang_makan = p.uang_makan === 1 ? 0 : 1;
  btn.className = `meal-btn ${p.uang_makan ? 'active-meal' : ''}`;
  btn.textContent = p.uang_makan ? '✓ Dapat Uang Makan (Lembur s.d. 22.00 WIB)' : '+ Centang Uang Makan (Lembur s.d. 22.00 WIB)';
  updateBadgeKartu(i);
}

// 4. Kompresi Foto Kamera
function prosesFoto(e) {
  const file = e.target.files[0];
  if (!file) return;

  const r = new FileReader();
  r.onload = ev => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'), maxW = 1024;
      let w = img.width, h = img.height;
      if (w > maxW) { h = Math.round((h * maxW) / w); w = maxW; }
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      fotoBase64 = c.toDataURL('image/jpeg', 0.7);

      $('previewFoto').src = fotoBase64;
      $('previewFoto').style.display = 'block';
      $('infoFoto').textContent = `Foto siap dikirim (${Math.round((fotoBase64.length * 3) / 4 / 1024)} KB).`;
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

  // Foto hanya wajib jika ada pekerja yang BELUM pernah diabsen hari ini
  const adaPekerjaBaru = pekerjaDikirim.some(p => !p.sudah_absen);
  if (adaPekerjaBaru && !fotoBase64) return notif("Ambil foto kelompok pekerja terlebih dahulu.", false);

  // Hitung ringkasan khusus pekerja yang dikirim
  const jumlahBaru     = pekerjaDikirim.filter(p => !p.sudah_absen).length;
  const jumlahKoreksi  = pekerjaDikirim.filter(p => p.sudah_absen).length;
  const jumlahFull     = pekerjaDikirim.filter(p => p.status_hadir === 1).length;
  const jumlahSetengah = pekerjaDikirim.filter(p => p.status_hadir === 0.5).length;
  const jumlahAbsen    = pekerjaDikirim.filter(p => p.status_hadir === 0).length;
  const totalLembur    = pekerjaDikirim.reduce((s, p) => s + (Number(p.jam_lembur) || 0), 0);
  const jumlahMakan    = pekerjaDikirim.filter(p => p.uang_makan === 1).length;

  $('konfirmasiRingkasan').innerHTML = `
    <div class="konfirmasi-info">
      <div class="konfirmasi-row"><span>Proyek</span><strong>${$('selectProyek').value}</strong></div>
      <div class="konfirmasi-row"><span>Mandor</span><strong>${mandor}</strong></div>
      <div class="konfirmasi-row"><span>Pekerja yang Dikirim</span><strong>${pekerjaDikirim.length} orang</strong></div>
      ${jumlahBaru > 0 ? `<div class="konfirmasi-row"><span>• Pekerja Baru (Belum Absen)</span><strong style="color:var(--primary);">${jumlahBaru} orang</strong></div>` : ''}
      ${jumlahKoreksi > 0 ? `<div class="konfirmasi-row"><span>• Koreksi/Perubahan Data</span><strong style="color:#d97706;">${jumlahKoreksi} orang</strong></div>` : ''}
    </div>
    <div class="konfirmasi-info">
      <div class="konfirmasi-row"><span>✅ Full (1 hari)</span><span class="badge-full">${jumlahFull} orang</span></div>
      <div class="konfirmasi-row"><span>🕐 Setengah Hari</span><span class="badge-half">${jumlahSetengah} orang</span></div>
      <div class="konfirmasi-row"><span>❌ Tidak Hadir</span><span class="badge-absen">${jumlahAbsen} orang</span></div>
      <div class="konfirmasi-row"><span>⏱ Total Lembur</span><span>${totalLembur > 0 ? totalLembur + ' jam' : '-'}</span></div>
      <div class="konfirmasi-row"><span>🍽 Dapat Uang Makan</span><span>${jumlahMakan > 0 ? jumlahMakan + ' orang' : '-'}</span></div>
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
  const btn = $('btnSimpanModal');

  btn.disabled = true; btn.textContent = "Menyimpan...";

  try {
    const res = await postApi("tambah_pekerja", {
      nama_pekerja: nama,
      keahlian: keahlian,
      proyek_default: proyek,
      nama_mandor: isTambahMandor ? nama : mandor
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
      if (isTambahMandor) onProyekChange(nama);
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

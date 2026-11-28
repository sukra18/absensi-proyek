// app-core.js - Konfig, util, auth, dan muat data master
const URL_GAS = "https://script.google.com/macros/s/AKfycbws5ZAyiHw5wLzjnHmuRXxYej-sLFlZ2qR9UsY6zsyQRDgdqhCWOYbSNhVBKq-hrdI/exec";
const $ = id => document.getElementById(id);

let currentPin = "", daftarProyek = [], semuaPekerja = [], pekerjaTampil = [], fotoBase64 = "";
let isTambahMandor = false;
let operatorPerMandor = {};
let isAdmin = false;

// Tanggal default = hari ini (WIB) — pakai tanggal lokal, jangan toISOString (UTC)
function getTodayStr() {
  const d = new Date();
  const off = d.getTimezoneOffset();
  const wib = new Date(d.getTime() + (off + 420) * 60000);
  return `${wib.getFullYear()}-${String(wib.getMonth() + 1).padStart(2, "0")}-${String(wib.getDate()).padStart(2, "0")}`;
}

function getSelectedTanggal() {
  return $('inputTanggal')?.value || getTodayStr();
}

function updateLabelTanggal() {
  const val = getSelectedTanggal();
  const [y, m, day] = val.split("-").map(Number);
  const d = new Date(y, m - 1, day);
  $('tanggalHariIni').textContent = d.toLocaleDateString("id-ID", {
    weekday: "long", day: "numeric", month: "long", year: "numeric"
  });
}

$('tanggalHariIni').textContent = new Date().toLocaleDateString("id-ID", {
  weekday: "long", day: "numeric", month: "long", year: "numeric"
});

// Helper Alert
function tutupAlert() {
  const b = $('alertBox');
  if (b) b.style.display = 'none';
}

function notif(pesan, sukses = true) {
  const b = $('alertBox');
  b.innerHTML = `
    <span class="alert-text">${esc(pesan)}</span>
    <button type="button" class="alert-close" onclick="tutupAlert()" title="Tutup" aria-label="Tutup" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);width:32px;height:32px;min-height:unset;padding:0;margin:0;background:none;border:none;color:inherit;font-size:22px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;">&times;</button>
  `;
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

// Helper: escape HTML (termasuk kutip) untuk cegah XSS & atribut rusak di innerHTML
function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Helper Request API ke Google Apps Script
async function postApi(action, data = {}) {
  const res = await fetch(URL_GAS, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ pin: currentPin, action, ...data })
  });
  if (!res.ok) throw new Error(`Server error ${res.status}`);
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
    if (!res.ok) throw new Error(`Server error ${res.status}`);
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

    operatorPerMandor = data.operator_per_mandor || {};
    isAdmin = Boolean(data.is_admin || pin === "9281");
    $('selectProyek').innerHTML = daftarProyek.map(p => `<option value="${esc(p.nama_proyek)}">${esc(p.nama_proyek)}</option>`).join('');

    const labelP = $('labelProyek');
    if (labelP) {
      labelP.textContent = isAdmin ? "1. Pilih Proyek / Lokasi (Admin)" : "1. Lokasi Proyek";
    }
    $('selectProyek').disabled = !isAdmin && daftarProyek.length <= 1;

    // Set deskripsi foto untuk admin vs pelaksana
    const descFoto = $('descFoto');
    if (descFoto) {
      descFoto.textContent = isAdmin
        ? "Ambil foto bersama pekerja grup di lokasi proyek (Opsional untuk Admin)."
        : "Ambil foto bersama pekerja grup terpilih di lokasi proyek.";
    }

    // Set date picker ke hari ini — hanya admin bisa ganti tanggal
    $('inputTanggal').value = getTodayStr();
    updateLabelTanggal();
    const wrapTanggal = $('inputTanggal').parentElement.querySelector('.wrap-tanggal') || $('inputTanggal');
    if (isAdmin) {
      $('inputTanggal').style.display = '';
      $('inputTanggal').previousElementSibling.style.display = '';
    } else {
      $('inputTanggal').style.display = 'none';
      $('inputTanggal').previousElementSibling.style.display = 'none';
    }

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

// Ganti tanggal absensi — reload status absen dari server
async function onTanggalChange() {
  updateLabelTanggal();
  if (!currentPin) return;

  try {
    const tgl = getSelectedTanggal();
    const res = await fetch(`${URL_GAS}?pin=${encodeURIComponent(currentPin)}&tanggal=${tgl}`);
    if (!res.ok) return;
    const data = await res.json();
    if (data.status !== "success") return;

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

    operatorPerMandor = data.operator_per_mandor || {};

    // Pertahankan pilihan proyek & mandor saat ini
    const curProyek = $('selectProyek').value;
    const curMandor = $('selectMandor').value;
    onProyekChange(curMandor);
  } catch (err) {
    console.error("Gagal reload tanggal:", err);
  }
}

// Helper Logout / Keluar & Ganti PIN
function logout() {
  if (confirm("Apakah Anda yakin ingin keluar dari form absensi?")) {
    currentPin = "";
    daftarProyek = [];
    semuaPekerja = [];
    pekerjaTampil = [];
    resetFoto();
    $('inputPin').value = "";
    $('alertBox').style.display = 'none';
    $('mainSection').classList.add('hidden');
    $('pinSection').classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}


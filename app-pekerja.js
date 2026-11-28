// app-pekerja.js - Filter proyek/mandor, urutan keahlian, render & aksi kartu
// 2. Filter Proyek & Mandor
function onProyekChange(overrideMandor = "") {
  resetFoto();
  const proyek = $('selectProyek').value;
  const info = daftarProyek.find(p => p.nama_proyek === proyek);
  $('inputOperator').value = info ? info.pelaksana_lapangan : "-";

  const mandors = [...new Set(semuaPekerja.filter(p => p.proyek_default === proyek && p.nama_mandor).map(p => p.nama_mandor))];
  const sel = $('selectMandor');
  sel.innerHTML = mandors.length
    ? mandors.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('')
    : '<option value="">-- Belum ada mandor (+ Mandor Baru) --</option>';

  if (overrideMandor && mandors.includes(overrideMandor)) sel.value = overrideMandor;
  onMandorChange();
}

// Helper Urutan Keahlian/Jabatan agar sesama jabatan berkumpul rapi
function getBobotKeahlian(keahlian) {
  const k = (keahlian || '').trim().toLowerCase();
  if (k === 'mandor') return 1;
  if (k === 'kepala tukang') return 2;
  if (k.startsWith('tukang')) return 3;
  if (k === 'kenek') return 4;
  return 5;
}

function sortPekerja(a, b) {
  const bobotA = getBobotKeahlian(a.keahlian);
  const bobotB = getBobotKeahlian(b.keahlian);
  if (bobotA !== bobotB) return bobotA - bobotB;

  const kA = (a.keahlian || '').trim().toLowerCase();
  const kB = (b.keahlian || '').trim().toLowerCase();
  if (kA !== kB) return kA.localeCompare(kB);

  return 0;
}

function onMandorChange() {
  resetFoto();
  const proyek = $('selectProyek').value, mandor = $('selectMandor').value;
  pekerjaTampil = semuaPekerja
    .filter(p => p.proyek_default === proyek && p.nama_mandor === mandor)
    .sort(sortPekerja);
  if ($('inputCariPekerja')) $('inputCariPekerja').value = "";

  // Warning jika mandor ini sudah diabsen oleh operator lain
  const key = `${mandor}___${proyek}`;
  const opLain = operatorPerMandor[key];
  const operatorSaya = $('inputOperator').value.trim();
  const warningEl = $('warningOperatorLain');
  if (opLain && opLain !== operatorSaya && opLain !== "-") {
    if (warningEl) {
      warningEl.textContent = `Peringatan: Grup ini sudah diabsen oleh "${opLain}". Jika Anda kirim ulang, data sebelumnya akan tertimpa.`;
      warningEl.style.display = 'block';
    }
  } else {
    if (warningEl) warningEl.style.display = 'none';
  }

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

    // Animasi stagger halus maksimal untuk 15 kartu pertama agar performa tetap 60fps
    const delay = Math.min(i * 0.03, 0.45);
    return `
    <div class="worker-item ${itemClass}" data-idx="${i}" style="animation-delay: ${delay}s;">
      <div class="flex-between">
        <div>
          <span class="worker-name">${esc(p.nama_pekerja)}</span>
          <span class="worker-role">${esc(p.keahlian)}</span>
        </div>
        <span class="badge-status ${badgeClass}">${badgeText}</span>
      </div>
      <div class="status-group">
        <button type="button" class="status-btn ${p.status_hadir === 1 ? 'active-full' : ''}" onclick="setStatus(${i}, 1, this)">Full (1)</button>
        <button type="button" class="status-btn ${p.status_hadir === 0.5 ? 'active-half' : ''}" onclick="setStatus(${i}, 0.5, this)">1/2 Hari</button>
        <button type="button" class="status-btn ${p.status_hadir === 0 ? 'active-absent' : ''}" onclick="setStatus(${i}, 0, this)">Absen (0)</button>
      </div>
      <button type="button" class="meal-btn ${p.uang_makan === 1 ? 'active-meal' : ''}" onclick="toggleMakan(${i}, this)">
        ${p.uang_makan === 1 ? '✓ Dapat Uang Makan (Lembur 7 Jam)' : '+ Centang Uang Makan (Lembur 7 Jam)'}
      </button>

      <!-- Panel Lembur & Catatan Ringkas -->
      <div class="lembur-wrapper">
        <div class="lembur-header">
          <span class="lembur-label">Jam Lembur:</span>
          <div class="lembur-quick-btns">
            <button type="button" class="btn-lembur ${p.jam_lembur === 1 ? 'active' : ''}" data-jam="1" onclick="setLembur(${i}, 1)">+1</button>
            <button type="button" class="btn-lembur ${p.jam_lembur === 2 ? 'active' : ''}" data-jam="2" onclick="setLembur(${i}, 2)">+2</button>
            <button type="button" class="btn-lembur ${p.jam_lembur === 3 ? 'active' : ''}" data-jam="3" onclick="setLembur(${i}, 3)">+3</button>
            <button type="button" class="btn-lembur ${p.jam_lembur === 4 ? 'active' : ''}" data-jam="4" onclick="setLembur(${i}, 4)">+4</button>
            <button type="button" class="btn-lembur ${p.jam_lembur === 5 ? 'active' : ''}" data-jam="5" onclick="setLembur(${i}, 5)">+5</button>
            <button type="button" class="btn-lembur ${p.jam_lembur === 6 ? 'active' : ''}" data-jam="6" onclick="setLembur(${i}, 6)">+6</button>
            <button type="button" class="btn-lembur ${p.jam_lembur === 7 ? 'active' : ''}" data-jam="7" onclick="setLembur(${i}, 7)">+7</button>
            <button type="button" class="btn-lembur btn-reset ${p.jam_lembur === 0 ? 'active' : ''}" data-jam="0" onclick="setLembur(${i}, 0)">✕</button>
          </div>
        </div>
        <div class="extra-inputs">
          <input type="number" class="input-lembur" min="0" max="12" step="0.5" placeholder="Jam" value="${p.jam_lembur || ''}" oninput="onInputLembur(${i}, this.value)">
          <input type="text" placeholder="Catatan singkat (opsional)" value="${esc(p.catatan)}" oninput="pekerjaTampil[${i}].catatan = this.value; updateBadgeKartu(${i});">
        </div>
      </div>
    </div>
  `;
  }).join('');
}

// Tombol Cepat Jam Lembur
function setLembur(i, jam) {
  const p = pekerjaTampil[i];
  if (p.status_hadir === 0) return;
  p.jam_lembur = Number(jam || 0);

  // Otomatis aktifkan uang makan HANYA jika lembur 7 jam ke atas
  if (p.jam_lembur >= 7) {
    p.uang_makan = 1;
  } else {
    p.uang_makan = 0;
  }

  const card = document.querySelector(`.worker-item[data-idx="${i}"]`);
  if (card) {
    const numInput = card.querySelector('.input-lembur');
    if (numInput) numInput.value = p.jam_lembur > 0 ? p.jam_lembur : '';

    const mealBtn = card.querySelector('.meal-btn');
    if (mealBtn) {
      mealBtn.className = `meal-btn ${p.uang_makan ? 'active-meal' : ''}`;
      mealBtn.textContent = p.uang_makan ? '✓ Dapat Uang Makan (Lembur 7 Jam)' : '+ Centang Uang Makan (Lembur 7 Jam)';
    }

    card.querySelectorAll('.btn-lembur').forEach(btn => {
      const bJam = Number(btn.getAttribute('data-jam'));
      if (bJam === p.jam_lembur) btn.classList.add('active');
      else btn.classList.remove('active');
    });
  }

  updateBadgeKartu(i);
}

function onInputLembur(i, val) {
  const p = pekerjaTampil[i];
  p.jam_lembur = Number(val || 0);

  // Otomatis aktifkan uang makan HANYA jika lembur 7 jam ke atas
  if (p.jam_lembur >= 7) {
    p.uang_makan = 1;
  } else {
    p.uang_makan = 0;
  }

  const card = document.querySelector(`.worker-item[data-idx="${i}"]`);
  if (card) {
    const mealBtn = card.querySelector('.meal-btn');
    if (mealBtn) {
      mealBtn.className = `meal-btn ${p.uang_makan ? 'active-meal' : ''}`;
      mealBtn.textContent = p.uang_makan ? '✓ Dapat Uang Makan (Lembur 7 Jam)' : '+ Centang Uang Makan (Lembur 7 Jam)';
    }

    card.querySelectorAll('.btn-lembur').forEach(btn => {
      const bJam = Number(btn.getAttribute('data-jam'));
      if (bJam === p.jam_lembur) btn.classList.add('active');
      else btn.classList.remove('active');
    });
  }

  updateBadgeKartu(i);
}

// Opsi Aksi Cepat: Isi Semua Pekerja Hadir Lembur 7 Jam + Uang Makan / Reset
function setSemuaLembur(jam) {
  if (!pekerjaTampil.length) return notif("Tidak ada pekerja di grup ini.", false);

  const targetJam = Number(jam || 0);
  let count = 0;

  pekerjaTampil.forEach(p => {
    // Lewati pekerja berstatus Absen jika set lembur
    if (targetJam > 0 && p.status_hadir === 0) return;
    p.jam_lembur = targetJam;
    p.uang_makan = targetJam >= 7 ? 1 : 0;
    count++;
  });

  if (targetJam > 0 && count === 0) {
    return notif("Semua pekerja di grup ini berstatus Absen. Ubah status hadir terlebih dahulu.", false);
  }

  renderDaftarPekerja();
  const searchVal = $('inputCariPekerja')?.value;
  if (searchVal) {
    filterPekerja(searchVal);
  }
}

// Shortcut scroll ke area foto & tombol kirim
function scrollToFoto() {
  const el = $('cardFoto') || $('btnKirim');
  if (el) {
    el.scrollIntoView({ behavior: 'smooth' });
  }
}

// Pencarian Cepat Pekerja
function clearCariPekerja() {
  const el = $('inputCariPekerja');
  if (!el) return;
  el.value = "";
  filterPekerja("");
  el.focus();
}

function filterPekerja(keyword) {
  const q = String(keyword || "").toLowerCase().trim();
  const cards = document.querySelectorAll('.worker-item');
  let matchCount = 0;

  cards.forEach(card => {
    const idx = parseInt(card.getAttribute('data-idx'), 10);
    const p = pekerjaTampil[idx];
    if (!p) return;
    const match = !q || (p.nama_pekerja && p.nama_pekerja.toLowerCase().includes(q)) || (p.keahlian && p.keahlian.toLowerCase().includes(q));
    card.style.display = match ? 'block' : 'none';
    if (match) matchCount++;
  });

  $('jumlahPekerja').textContent = q ? `${matchCount} dari ${pekerjaTampil.length}` : pekerjaTampil.length;
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
  mealBtn.textContent = p.uang_makan ? '✓ Dapat Uang Makan (Lembur 7 Jam)' : '+ Centang Uang Makan (Lembur 7 Jam)';

  if (val === 0) {
    const numInput = card.querySelector('.input-lembur');
    if (numInput) numInput.value = '';
    card.querySelectorAll('.btn-lembur').forEach(b => {
      if (b.getAttribute('data-jam') === '0') b.classList.add('active');
      else b.classList.remove('active');
    });
  }

  updateBadgeKartu(i);
}

function toggleMakan(i, btn) {
  const p = pekerjaTampil[i];
  if (p.status_hadir === 0) return;
  p.uang_makan = p.uang_makan === 1 ? 0 : 1;
  btn.className = `meal-btn ${p.uang_makan ? 'active-meal' : ''}`;
  btn.textContent = p.uang_makan ? '✓ Dapat Uang Makan (Lembur 7 Jam)' : '+ Centang Uang Makan (Lembur 7 Jam)';
  updateBadgeKartu(i);
}


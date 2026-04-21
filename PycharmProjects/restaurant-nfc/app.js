const ADMIN_PIN = '1234';
const SHOW_MS   = 4000;

function todayKey() { return 'rc_' + new Date().toISOString().slice(0, 10); }
function loadVisits() {
  try { return JSON.parse(localStorage.getItem(todayKey())) || []; } catch { return []; }
}
function saveVisit(uid) {
  const list = loadVisits();
  list.push({ uid, ts: Date.now(), time: now() });
  localStorage.setItem(todayKey(), JSON.stringify(list));
  return list;
}
function findVisit(uid) { return loadVisits().find(v => v.uid === uid) || null; }
function now() { return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    await navigator.wakeLock.request('screen');
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'visible') await navigator.wakeLock.request('screen');
    });
  } catch (_) {}
}

const audio = new AudioContext();
function playTone(type) {
  if (audio.state === 'suspended') audio.resume();
  if (type === 'ok') {
    [[523.25, 0], [659.25, 0.18]].forEach(([freq, delay]) => {
      const o = audio.createOscillator();
      o.type = 'sine'; o.frequency.value = freq;
      const g = audio.createGain();
      g.gain.setValueAtTime(0, audio.currentTime + delay);
      g.gain.linearRampToValueAtTime(0.28, audio.currentTime + delay + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + delay + 0.5);
      o.connect(g).connect(audio.destination);
      o.start(audio.currentTime + delay);
      o.stop(audio.currentTime + delay + 0.55);
    });
  } else {
    const o = audio.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(180, audio.currentTime);
    o.frequency.exponentialRampToValueAtTime(60, audio.currentTime + 0.3);
    const g = audio.createGain();
    g.gain.setValueAtTime(0.3, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.35);
    o.connect(g).connect(audio.destination);
    o.start(); o.stop(audio.currentTime + 0.4);
  }
}

function vibrate(type) {
  if (!navigator.vibrate) return;
  navigator.vibrate(type === 'ok' ? [60, 40, 60] : [200]);
}

function refreshHeader() {
  document.getElementById('idle-date').textContent =
    new Date().toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  const n = loadVisits().length;
  document.getElementById('idle-count').textContent = n === 0 ? '0 today' : n + ' today';
}
refreshHeader();
setInterval(refreshHeader, 30000);

let resultTimer = null;
function showResult(type, title, sub) {
  const screen = document.getElementById('screen-result');
  screen.className = 'screen ' + type;
  document.getElementById('result-title').textContent = title;
  document.getElementById('result-sub').textContent = sub;
  showScreen('screen-result');
  playTone(type);
  vibrate(type);
  const fill = document.getElementById('result-timer-fill');
  fill.style.transition = 'none';
  fill.style.transform = 'scaleX(1)';
  requestAnimationFrame(() => {
    fill.style.transition = 'transform ' + SHOW_MS + 'ms linear';
    fill.style.transform = 'scaleX(0)';
  });
  clearTimeout(resultTimer);
  resultTimer = setTimeout(() => { showScreen('screen-idle'); refreshHeader(); }, SHOW_MS);
}

function handleScan(uid) {
  const existing = findVisit(uid);
  if (existing) {
    showResult('deny', 'Already checked in', 'Your card was used today at ' + existing.time);
    return;
  }
  const list = saveVisit(uid);
  showResult('ok', 'Welcome!', 'Discount granted - visit #' + list.length + ' today');
}

async function startNFC() {
  const status = document.getElementById('nfc-status');
  if (!('NDEFReader' in window)) {
    status.className = 'error';
    status.textContent = 'Web NFC not available - use Chrome on Android';
    return;
  }
  try {
    const reader = new NDEFReader();
    await reader.scan();
    status.className = 'ready';
    status.textContent = 'Ready - waiting for card';
    reader.addEventListener('reading', ({ serialNumber }) => {
      if (serialNumber) handleScan(serialNumber);
    });
    reader.addEventListener('readingerror', () => {
      status.className = 'error';
      status.textContent = 'Could not read card - try again';
      setTimeout(() => { status.className = 'ready'; status.textContent = 'Ready - waiting for card'; }, 2500);
    });
  } catch (err) {
    status.className = 'error';
    status.textContent = err.name === 'NotAllowedError'
      ? 'NFC permission denied - tap icon to retry'
      : 'NFC error: ' + err.message;
    document.getElementById('nfc-core').addEventListener('click', startNFC, { once: true });
  }
}

function openAdmin() {
  const visits = loadVisits();
  document.getElementById('stat-total').textContent = visits.length;
  document.getElementById('stat-last').textContent = visits.length ? visits.at(-1).time : '-';
  const tbody = document.getElementById('admin-tbody');
  tbody.innerHTML = '';
  const empty = document.getElementById('admin-empty');
  const table = document.getElementById('admin-table');
  if (visits.length === 0) {
    empty.classList.remove('hidden'); table.style.display = 'none';
  } else {
    empty.classList.add('hidden'); table.style.display = '';
    [...visits].reverse().forEach((v, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td>' + (visits.length - i) + '</td>' +
        '<td style="font-family:monospace">' + v.uid.toUpperCase() + '</td>' +
        '<td>' + v.time + '</td>';
      tbody.appendChild(tr);
    });
  }
  showScreen('screen-admin');
}

document.getElementById('btn-back').addEventListener('click', () => { showScreen('screen-idle'); refreshHeader(); });
document.getElementById('btn-reset').addEventListener('click', () => {
  if (confirm('Reset all check-ins for today?')) { localStorage.removeItem(todayKey()); openAdmin(); refreshHeader(); }
});

let pin = '';
function updateDots() {
  document.querySelectorAll('#pin-dots span').forEach((s, i) => s.classList.toggle('filled', i < pin.length));
}
function tryPin() {
  if (pin === ADMIN_PIN) {
    document.getElementById('pin-overlay').classList.add('hidden');
    pin = ''; updateDots(); openAdmin();
  } else {
    document.getElementById('pin-err').classList.remove('hidden');
    pin = ''; updateDots();
  }
}
document.getElementById('btn-admin-idle').addEventListener('click', () => {
  pin = ''; updateDots();
  document.getElementById('pin-err').classList.add('hidden');
  document.getElementById('pin-overlay').classList.remove('hidden');
});
document.getElementById('pin-cancel-btn').addEventListener('click', () => {
  document.getElementById('pin-overlay').classList.add('hidden');
});
document.querySelectorAll('#numpad button').forEach(btn => {
  btn.addEventListener('click', () => {
    const v = btn.dataset.v;
    if (v === 'del') { pin = pin.slice(0, -1); }
    else if (v === 'ok') { tryPin(); return; }
    else if (pin.length < 4) { pin += v; if (pin.length === 4) setTimeout(tryPin, 250); }
    updateDots();
    document.getElementById('pin-err').classList.add('hidden');
  });
});

requestWakeLock();
startNFC();

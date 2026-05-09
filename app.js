'use strict';

/* ── IndexedDB setup ── */
let db;
const DB_NAME = 'VoiceDiary';
const STORE = 'entries';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = e => {
      const store = e.target.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      store.createIndex('date', 'date', { unique: false });
    };
    req.onsuccess = e => { db = e.target.result; resolve(); };
    req.onerror = reject;
  });
}

function dbAll() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result.reverse());
    req.onerror = reject;
  });
}

function dbGet(id) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = reject;
  });
}

function dbPut(entry) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).add(entry);
    req.onsuccess = () => resolve(req.result);
    req.onerror = reject;
  });
}

function dbDelete(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).delete(id);
    req.onsuccess = resolve;
    req.onerror = reject;
  });
}

/* ── Navigation ── */
let history = ['home'];
let currentPage = 'home';

function showPage(name, opts = {}) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');

  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const navBtn = document.getElementById('nav-' + name);
  if (navBtn) navBtn.classList.add('active');

  const backBtn = document.getElementById('backBtn');
  const headerSearchBtn = document.getElementById('headerSearchBtn');
  if (name === 'home') {
    backBtn.classList.add('hidden');
    headerSearchBtn.classList.remove('hidden');
  } else {
    backBtn.classList.remove('hidden');
    headerSearchBtn.classList.add('hidden');
  }

  const titles = {
    'home': 'My Diary ✨',
    'new-entry': 'New Entry 🖊️',
    'entry-detail': 'My Entry 📖',
    'calendar': 'Calendar 📅',
    'search': 'Search 🔍',
  };
  document.getElementById('pageTitle').textContent = titles[name] || 'My Diary ✨';

  if (name !== currentPage) history.push(name);
  currentPage = name;

  if (name === 'home') renderHome();
  if (name === 'new-entry') initNewEntry();
  if (name === 'calendar') renderCalendar();
  if (name === 'search') { document.getElementById('searchInput').value = ''; document.getElementById('searchResults').innerHTML = ''; }
  if (name === 'entry-detail' && opts.id) renderDetail(opts.id);
}

function goBack() {
  history.pop();
  const prev = history[history.length - 1] || 'home';
  history = history.slice(0, history.length); // keep trimmed
  showPage(prev);
}

/* ── Home ── */
async function renderHome() {
  const greetings = ['Good morning! ☀️', 'Hey there! 🌈', 'Hello, star! ⭐', 'Hi! How\'s your day? 🌸'];
  const hour = new Date().getHours();
  const g = hour < 12 ? 'Good morning! ☀️' : hour < 17 ? 'Good afternoon! 🌤️' : 'Good evening! 🌙';
  document.getElementById('homeGreeting').textContent = g;

  const entries = await dbAll();
  const list = document.getElementById('recentEntries');
  if (!entries.length) {
    list.innerHTML = '<div style="color:var(--muted);text-align:center;margin-top:20px;">No entries yet — tap New to start! 🌟</div>';
    return;
  }
  list.innerHTML = entries.slice(0, 15).map(entryCard).join('');
}

function entryCard(e) {
  const preview = (e.text || '').slice(0, 60) + ((e.text || '').length > 60 ? '…' : '');
  const d = new Date(e.date);
  const dateStr = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const photoIcon = e.photo ? '<span class="entry-card-has-photo">📷</span>' : '';
  return `<div class="entry-card" onclick="showPage('entry-detail', {id:${e.id}})">
    ${photoIcon}
    <div class="entry-card-header">
      <span class="entry-card-mood">${e.mood || '😊'}</span>
      <span class="entry-card-date">${dateStr}</span>
    </div>
    <div class="entry-card-preview">${preview || '(no text)'}</div>
  </div>`;
}

/* ── New Entry ── */
let selectedMood = '😊';
let pendingPhotoData = null;

function initNewEntry() {
  const now = new Date();
  document.getElementById('entryDateLabel').textContent =
    now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  document.getElementById('entryText').value = '';
  document.getElementById('photoPreview').innerHTML = '';
  document.getElementById('photoPreview').classList.add('hidden');
  document.getElementById('recordingIndicator').classList.add('hidden');
  pendingPhotoData = null;
  selectedMood = '😊';
  document.querySelectorAll('.mood-btn').forEach(b => {
    b.classList.toggle('selected', b.dataset.mood === selectedMood);
  });
}

function selectMood(btn) {
  document.querySelectorAll('.mood-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  selectedMood = btn.dataset.mood;
}

/* ── Voice Recording ── */
let recognition = null;
let isRecording = false;

function toggleRecording() {
  if (isRecording) {
    stopRecording();
  } else {
    startRecording();
  }
}

function startRecording() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    showToast('Voice not supported in this browser 😢 Try Chrome!');
    return;
  }

  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  const existing = document.getElementById('entryText').value;
  let interim = '';

  recognition.onresult = event => {
    interim = '';
    let final = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) {
        final += event.results[i][0].transcript + ' ';
      } else {
        interim += event.results[i][0].transcript;
      }
    }
    document.getElementById('entryText').value = existing + final + interim;
  };

  recognition.onerror = e => {
    if (e.error !== 'aborted') showToast('Mic error: ' + e.error);
    stopRecording();
  };

  recognition.onend = () => stopRecording();

  recognition.start();
  isRecording = true;
  document.getElementById('micBtn').classList.add('recording');
  document.getElementById('micLabel').textContent = 'Tap to Stop';
  document.getElementById('recordingIndicator').classList.remove('hidden');
}

function stopRecording() {
  if (recognition) { try { recognition.stop(); } catch (_) {} recognition = null; }
  isRecording = false;
  document.getElementById('micBtn').classList.remove('recording');
  document.getElementById('micLabel').textContent = 'Hold to Speak';
  document.getElementById('recordingIndicator').classList.add('hidden');
}

/* ── Photo ── */
function handlePhoto(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    pendingPhotoData = e.target.result;
    const preview = document.getElementById('photoPreview');
    preview.innerHTML = `<img src="${pendingPhotoData}" alt="photo" />`;
    preview.classList.remove('hidden');
  };
  reader.readAsDataURL(file);
}

/* ── Save Entry ── */
async function saveEntry() {
  const text = document.getElementById('entryText').value.trim();
  if (!text && !pendingPhotoData) {
    showToast('Write or speak something first! 🖊️');
    return;
  }
  const entry = {
    text,
    mood: selectedMood,
    date: new Date().toISOString(),
    photo: pendingPhotoData || null,
  };
  await dbPut(entry);
  showToast('Saved! Great job! 🌟');
  initNewEntry();
  showPage('home');
}

/* ── Entry Detail ── */
let currentDetailId = null;

async function renderDetail(id) {
  currentDetailId = id;
  const e = await dbGet(id);
  if (!e) return;
  document.getElementById('detailMood').textContent = e.mood || '😊';
  const d = new Date(e.date);
  document.getElementById('detailDate').textContent =
    d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) +
    ' · ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  document.getElementById('detailText').textContent = e.text || '(no text)';
  const photoWrap = document.getElementById('detailPhoto');
  photoWrap.innerHTML = e.photo ? `<img src="${e.photo}" alt="photo" />` : '';
}

async function deleteCurrentEntry() {
  if (!currentDetailId) return;
  if (!confirm('Delete this entry? 🗑️')) return;
  await dbDelete(currentDetailId);
  showToast('Entry deleted!');
  goBack();
}

/* ── Calendar ── */
let calYear, calMonth;

function renderCalendar() {
  const now = new Date();
  if (calYear === undefined) { calYear = now.getFullYear(); calMonth = now.getMonth(); }
  drawCalendar();
}

function changeMonth(delta) {
  calMonth += delta;
  if (calMonth < 0) { calMonth = 11; calYear--; }
  if (calMonth > 11) { calMonth = 0; calYear++; }
  drawCalendar();
  document.getElementById('calDayEntries').innerHTML = '';
}

async function drawCalendar() {
  const entries = await dbAll();
  const entryDates = new Set(entries.map(e => e.date.slice(0, 10)));

  const months = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];
  document.getElementById('calMonthLabel').textContent = `${months[calMonth]} ${calYear}`;

  const grid = document.getElementById('calGrid');
  const days = ['Su','Mo','Tu','We','Th','Fr','Sa'];
  let html = days.map(d => `<div class="cal-day-name">${d}</div>`).join('');

  const first = new Date(calYear, calMonth, 1).getDay();
  for (let i = 0; i < first; i++) html += '<div class="cal-day empty"></div>';

  const total = new Date(calYear, calMonth + 1, 0).getDate();
  const todayStr = new Date().toISOString().slice(0, 10);

  for (let d = 1; d <= total; d++) {
    const dateStr = `${calYear}-${String(calMonth + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const cls = [
      'cal-day',
      dateStr === todayStr ? 'today' : '',
      entryDates.has(dateStr) ? 'has-entry' : '',
    ].filter(Boolean).join(' ');
    html += `<div class="${cls}" onclick="calDayClick('${dateStr}')">${d}</div>`;
  }
  grid.innerHTML = html;
}

async function calDayClick(dateStr) {
  document.querySelectorAll('.cal-day').forEach(d => d.classList.remove('selected'));
  event.target.classList.add('selected');

  const entries = await dbAll();
  const dayEntries = entries.filter(e => e.date.startsWith(dateStr));
  const list = document.getElementById('calDayEntries');
  if (!dayEntries.length) {
    list.innerHTML = '<div style="color:var(--muted);text-align:center;">No entries on this day 🌿</div>';
    return;
  }
  list.innerHTML = dayEntries.map(entryCard).join('');
}

/* ── Search ── */
async function doSearch() {
  const q = document.getElementById('searchInput').value.trim().toLowerCase();
  const results = document.getElementById('searchResults');
  if (!q) { results.innerHTML = ''; return; }

  const entries = await dbAll();
  const matches = entries.filter(e =>
    (e.text || '').toLowerCase().includes(q) || (e.mood || '').includes(q)
  );

  if (!matches.length) {
    results.innerHTML = '<div style="color:var(--muted);text-align:center;">Nothing found 🔍</div>';
    return;
  }

  results.innerHTML = matches.map(e => {
    const preview = (e.text || '').slice(0, 80);
    const highlighted = preview.replace(
      new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
      m => `<mark class="search-highlight">${m}</mark>`
    );
    const d = new Date(e.date);
    const dateStr = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    return `<div class="entry-card" onclick="showPage('entry-detail', {id:${e.id}})">
      <div class="entry-card-header">
        <span class="entry-card-mood">${e.mood || '😊'}</span>
        <span class="entry-card-date">${dateStr}</span>
      </div>
      <div class="entry-card-preview">${highlighted}</div>
    </div>`;
  }).join('');
}

/* ── Toast ── */
let toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2500);
}

/* ── Service Worker ── */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () =>
    navigator.serviceWorker.register('./sw.js').catch(() => {})
  );
}

/* ── Boot ── */
openDB().then(() => {
  showPage('home');
}).catch(err => {
  document.body.innerHTML = '<p style="padding:20px;font-family:sans-serif">Could not open storage: ' + err + '</p>';
});

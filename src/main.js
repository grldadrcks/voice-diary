'use strict';

import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';

const IS_NATIVE = Capacitor.isNativePlatform();
const IS_IOS    = Capacitor.getPlatform() === 'ios';

/* ════════════════════════════════
   Profiles
════════════════════════════════ */
const PROFILES = {
  mali: { name: 'Mali', emoji: '🐣', color: 'blossom' },
  asha: { name: 'Asha', emoji: '🌸', color: 'grape'   },
};

function getActiveProfile() {
  return localStorage.getItem('diary-profile') || 'mali';
}

function prefKey(k) {
  return `diary-${getActiveProfile()}-${k}`;
}

function updateProfileUI() {
  const p   = PROFILES[getActiveProfile()];
  const btn = document.getElementById('profileBtn');
  btn.textContent = p.emoji;
  btn.title = `${p.name}'s Diary — tap to switch`;
}

function openProfilePicker() {
  document.getElementById('profileOverlay').classList.remove('hidden');
  document.getElementById('profilePicker').classList.remove('hidden');
  const ap = getActiveProfile();
  document.querySelectorAll('.profile-card').forEach(c =>
    c.classList.toggle('active', c.id === 'profileCard' + ap.charAt(0).toUpperCase() + ap.slice(1))
  );
}

function closeProfilePicker() {
  document.getElementById('profileOverlay').classList.add('hidden');
  document.getElementById('profilePicker').classList.add('hidden');
}

function selectProfile(name) {
  closeProfilePicker();
  if (name === getActiveProfile()) return;
  const pin = getPin(name);
  if (pin) {
    showPinOverlay('enter', name, () => doSwitchProfile(name));
  } else {
    doSwitchProfile(name);
  }
}

async function doSwitchProfile(name) {
  localStorage.setItem('diary-profile', name);
  db = null;
  await openDB();
  updateProfileUI();
  applyProfilePrefs();
  showPage('home');
  showToast(`Switched to ${PROFILES[name].name}'s diary ${PROFILES[name].emoji}`);
}

/* ════════════════════════════════
   PIN Lock
════════════════════════════════ */
function getPin(profile) {
  const p = profile || getActiveProfile();
  return localStorage.getItem(`diary-${p}-pin`) || '';
}

let pinMode = 'enter'; // 'enter' | 'set' | 'confirm'
let pinTarget = '';
let pinOnSuccess = null;
let pinBuffer = '';
let pinFirst = '';

function showPinOverlay(mode, targetProfile, onSuccess) {
  pinMode      = mode;
  pinTarget    = targetProfile;
  pinOnSuccess = onSuccess;
  pinBuffer    = '';
  pinFirst     = '';
  const p      = PROFILES[targetProfile];
  document.getElementById('pinEmoji').textContent  = p.emoji;
  document.getElementById('pinTitle').textContent  =
    mode === 'enter' ? `${p.name}'s PIN` : 'Choose a 4-digit PIN';
  document.getElementById('pinError').classList.add('hidden');
  document.getElementById('pinCancelBtn').classList.toggle('hidden', mode !== 'enter');
  updatePinDots();
  document.getElementById('pinOverlay').classList.remove('hidden');
}

function closePinOverlay() {
  document.getElementById('pinOverlay').classList.add('hidden');
  pinBuffer = ''; pinFirst = '';
}

function updatePinDots() {
  for (let i = 0; i < 4; i++)
    document.getElementById('pd' + i).classList.toggle('filled', i < pinBuffer.length);
}

function pinDigit(d) {
  if (pinBuffer.length >= 4) return;
  pinBuffer += d;
  updatePinDots();
  if (pinBuffer.length === 4) setTimeout(handlePinComplete, 150);
}

function pinBackspace() { pinBuffer = pinBuffer.slice(0, -1); updatePinDots(); }
function pinClear()     { pinBuffer = ''; updatePinDots(); }

function handlePinComplete() {
  if (pinMode === 'enter') {
    const stored = getPin(pinTarget);
    if (pinBuffer === stored) {
      closePinOverlay();
      pinOnSuccess && pinOnSuccess();
    } else {
      pinBuffer = '';
      updatePinDots();
      const err = document.getElementById('pinError');
      err.classList.remove('hidden');
      setTimeout(() => err.classList.add('hidden'), 2000);
    }
  } else if (pinMode === 'set') {
    pinFirst = pinBuffer;
    pinBuffer = '';
    updatePinDots();
    pinMode = 'confirm';
    document.getElementById('pinTitle').textContent = 'Confirm your PIN';
  } else if (pinMode === 'confirm') {
    if (pinBuffer === pinFirst) {
      localStorage.setItem(`diary-${pinTarget}-pin`, pinFirst);
      closePinOverlay();
      updatePinSettingsUI();
      showToast('PIN set! 🔒');
    } else {
      pinBuffer = ''; pinFirst = ''; pinMode = 'set';
      updatePinDots();
      document.getElementById('pinTitle').textContent = 'Choose a 4-digit PIN';
      const err = document.getElementById('pinError');
      err.textContent = "PINs didn't match, try again";
      err.classList.remove('hidden');
      setTimeout(() => err.classList.add('hidden'), 2000);
    }
  }
}

function startSetPin() {
  closeSettings();
  showPinOverlay('set', getActiveProfile(), null);
}

function removePin() {
  localStorage.removeItem(prefKey('pin'));
  updatePinSettingsUI();
  showToast('PIN removed 🔓');
}

function updatePinSettingsUI() {
  const has = !!getPin();
  document.getElementById('pinStatusLabel').textContent = has ? 'PIN is set 🔒' : 'No PIN set';
  document.getElementById('removePinBtn').classList.toggle('hidden', !has);
  document.getElementById('setPinBtn').textContent = has ? 'Change PIN' : 'Set PIN';
}

/* ════════════════════════════════
   IndexedDB
════════════════════════════════ */
let db;
const STORE = 'entries';

function dbName() { return 'VoiceDiary_' + getActiveProfile(); }

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName(), 1);
    req.onupgradeneeded = e =>
      e.target.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true })
                     .createIndex('date', 'date', { unique: false });
    req.onsuccess = e => { db = e.target.result; resolve(); };
    req.onerror   = reject;
  });
}

const idb      = (mode) => db.transaction(STORE, mode).objectStore(STORE);
const dbAll    = () => new Promise((r,j) => { const q = idb('readonly').getAll(); q.onsuccess = () => r(q.result.reverse()); q.onerror = j; });
const dbGet    = id => new Promise((r,j) => { const q = idb('readonly').get(id);  q.onsuccess = () => r(q.result);           q.onerror = j; });
const dbAdd    = e  => new Promise((r,j) => { const q = idb('readwrite').add(e);  q.onsuccess = () => r(q.result);           q.onerror = j; });
const dbDelete = id => new Promise((r,j) => { const q = idb('readwrite').delete(id); q.onsuccess = r; q.onerror = j; });
const dbUpdate = e  => new Promise((r,j) => { const q = idb('readwrite').put(e);     q.onsuccess = r; q.onerror = j; });

/* ════════════════════════════════
   Helpers
════════════════════════════════ */
function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function entryLocalDate(e) { return e.localDate || e.date.slice(0,10); }
function escapeHtml(s)     { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

/* ════════════════════════════════
   Tags
════════════════════════════════ */
const TAGS = [
  { id: 'school',   label: '📚 School'  },
  { id: 'family',   label: '👨‍👩‍👧 Family'  },
  { id: 'sport',    label: '⚽ Sport'   },
  { id: 'holiday',  label: '🎉 Holiday' },
  { id: 'friends',  label: '👫 Friends' },
  { id: 'food',     label: '🍕 Food'    },
  { id: 'other',    label: '🌟 Other'   },
];

let newEntryTags = [];
let editEntryTags = [];
let searchTagFilter = '';

function renderTagChips(containerId, selectedArr, onToggle) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = TAGS.map(t =>
    `<button class="tag-chip${selectedArr.includes(t.id) ? ' selected' : ''}"
      onclick="${onToggle}('${t.id}')">${t.label}</button>`
  ).join('');
}

function toggleNewTag(id) {
  newEntryTags = newEntryTags.includes(id)
    ? newEntryTags.filter(x => x !== id)
    : [...newEntryTags, id];
  renderTagChips('newEntryTagsRow', newEntryTags, 'toggleNewTag');
}

function toggleEditTag(id) {
  editEntryTags = editEntryTags.includes(id)
    ? editEntryTags.filter(x => x !== id)
    : [...editEntryTags, id];
  renderTagChips('editEntryTagsRow', editEntryTags, 'toggleEditTag');
}

function renderTagFilter() {
  const el = document.getElementById('tagFilterRow');
  if (!el) return;
  el.innerHTML = `<button class="tag-chip tag-filter-all${!searchTagFilter ? ' selected' : ''}" onclick="setTagFilter('')">All</button>` +
    TAGS.map(t =>
      `<button class="tag-chip${searchTagFilter === t.id ? ' selected' : ''}"
        onclick="setTagFilter('${t.id}')">${t.label}</button>`
    ).join('');
}

function setTagFilter(id) {
  searchTagFilter = id;
  renderTagFilter();
  doSearch();
}

function tagBadges(tags) {
  if (!tags || !tags.length) return '';
  return tags.map(id => {
    const t = TAGS.find(x => x.id === id);
    return t ? `<span class="tag-badge">${t.label}</span>` : '';
  }).join('');
}

/* ════════════════════════════════
   Settings / Prefs
════════════════════════════════ */
function loadPrefs() {
  applyProfilePrefs();
  const ls = document.getElementById('langSelect');
  if (ls) { ls.value = getLang(); if (!ls.value) ls.value = 'en-US'; }
  updatePinSettingsUI();
}

function applyProfilePrefs() {
  const dark   = localStorage.getItem(prefKey('dark'))   === 'true';
  const color  = localStorage.getItem(prefKey('color'))  || PROFILES[getActiveProfile()].color;
  const fs     = parseInt(localStorage.getItem(prefKey('fs')) || '20', 10);
  const font   = localStorage.getItem(prefKey('font'))   || 'Caveat';
  const remind = localStorage.getItem(prefKey('reminder')) === 'true';
  const rtime  = localStorage.getItem(prefKey('reminder-time')) || '20:00';

  applyDark(dark);
  applyColor(color);
  applyFontSize(fs);
  applyFont(font);

  const dt = document.getElementById('darkToggle');
  if (dt) dt.checked = dark;
  const rt = document.getElementById('reminderToggle');
  if (rt) rt.checked = remind;
  const rtv = document.getElementById('reminderTime');
  if (rtv) rtv.value = rtime;

  document.querySelectorAll('.fs-btn').forEach(b =>
    b.classList.toggle('active', parseInt(b.dataset.size) === fs));
  document.querySelectorAll('.swatch').forEach(s =>
    s.classList.toggle('selected', s.dataset.color === color));
  document.querySelectorAll('.font-opt').forEach(o =>
    o.classList.toggle('selected', o.dataset.font === font));
}

function applyDark(on)     { document.documentElement.setAttribute('data-theme', on ? 'dark' : 'light'); }
function applyColor(c)     { document.documentElement.setAttribute('data-color', c); }
function applyFontSize(px) { document.documentElement.style.setProperty('--fs', px + 'px'); }
function applyFont(name) {
  document.documentElement.style.setProperty('--font-main', `'${name}',cursive`);
  let s = document.getElementById('font-override');
  if (!s) { s = document.createElement('style'); s.id = 'font-override'; document.head.appendChild(s); }
  s.textContent = `html,body,input,textarea,select,.diary-textarea,.search-input,.todo-input,.prompt-chip,.tag-chip{font-family:'${name}',cursive!important}`;
}

function setDarkMode(on)  { applyDark(on); localStorage.setItem(prefKey('dark'), on); }
function setFontSize(px)  {
  applyFontSize(px);
  localStorage.setItem(prefKey('fs'), px);
  document.querySelectorAll('.fs-btn').forEach(b => b.classList.toggle('active', parseInt(b.dataset.size) === px));
}
function setTheme(name)   {
  applyColor(name);
  localStorage.setItem(prefKey('color'), name);
  document.querySelectorAll('.swatch').forEach(s => s.classList.toggle('selected', s.dataset.color === name));
}
function setFont(name)    { applyFont(name); localStorage.setItem(prefKey('font'), name);
  document.querySelectorAll('.font-opt').forEach(o => o.classList.toggle('selected', o.dataset.font === name)); }

function isIOSBrowser() {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const standalone = !!window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
  return ios && !standalone;
}

async function setReminder(on) {
  if (on) {
    if (IS_NATIVE) {
      const perm = await LocalNotifications.requestPermissions();
      if (perm.display !== 'granted') {
        showToast('Allow notifications in Settings → Apps → Mali&Asha Diary 🔔');
        document.getElementById('reminderToggle').checked = false; return;
      }
    } else if (isIOSBrowser()) {
      showToast('Add to Home Screen first to enable reminders on iOS 📲');
      document.getElementById('reminderToggle').checked = false; return;
    } else if (!('Notification' in window)) {
      showToast('Notifications not supported on this browser 😢');
      document.getElementById('reminderToggle').checked = false; return;
    } else {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        showToast('Allow notifications in your browser first 🔔');
        document.getElementById('reminderToggle').checked = false; return;
      }
    }
  }
  localStorage.setItem(prefKey('reminder'), on);
  if (IS_NATIVE) await syncNativeReminder(on);
}

async function syncNativeReminder(on) {
  try { await LocalNotifications.cancel({ notifications: [{ id: 101 }] }); } catch (_) {}
  if (!on) return;
  const rtime   = localStorage.getItem(prefKey('reminder-time')) || '20:00';
  const [rh,rm] = rtime.split(':').map(Number);
  const fireAt  = new Date();
  fireAt.setHours(rh, rm, 0, 0);
  if (fireAt <= new Date()) fireAt.setDate(fireAt.getDate() + 1);
  const p = PROFILES[getActiveProfile()];
  await LocalNotifications.schedule({ notifications: [{
    title: `${p.name}'s Diary 📖`,
    body:  "Don't forget to write in your diary today! 🌟",
    id: 101, schedule: { at: fireAt, repeats: true }, iconColor: '#ff6b9d',
  }]});
}

function saveReminderTime() {
  localStorage.setItem(prefKey('reminder-time'), document.getElementById('reminderTime').value);
  showToast('Reminder time saved! ✅');
  if (IS_NATIVE && localStorage.getItem(prefKey('reminder')) === 'true') syncNativeReminder(true);
}
function getLang()     { return localStorage.getItem(prefKey('lang')) || navigator.language || 'en-US'; }
function saveLang(v)   { localStorage.setItem(prefKey('lang'), v); showToast('Language saved! 🗣️'); }

function openSettings() {
  applyProfilePrefs();
  document.getElementById('settingsOverlay').classList.remove('hidden');
  document.getElementById('settingsSheet').classList.remove('hidden');
}
function closeSettings() {
  document.getElementById('settingsOverlay').classList.add('hidden');
  document.getElementById('settingsSheet').classList.add('hidden');
}

async function checkReminder() {
  if (IS_NATIVE) return;
  if (localStorage.getItem(prefKey('reminder')) !== 'true') return;
  const rtime   = localStorage.getItem(prefKey('reminder-time')) || '20:00';
  const [rh,rm] = rtime.split(':').map(Number);
  const now     = new Date();
  const target  = new Date(now); target.setHours(rh, rm, 0, 0);
  if (now < target) return;
  const todayStr     = localDateStr(now);
  const lastReminder = localStorage.getItem(prefKey('last-reminder'));
  if (lastReminder === todayStr) return;
  const entries    = await dbAll();
  const wroteToday = entries.some(e => entryLocalDate(e) === todayStr);
  if (!wroteToday) {
    localStorage.setItem(prefKey('last-reminder'), todayStr);
    if ('Notification' in window && Notification.permission === 'granted') {
      try { new Notification("Mali&Asha Diary 📖", { body: "Don't forget to write in your diary today! 🌟", icon: '/icons/icon-192.png' }); return; } catch(_) {}
    }
    showToast("Time to write in your diary! 🌟");
  }
}

/* ════════════════════════════════
   Navigation
════════════════════════════════ */
let navHistory  = ['home'];
let currentPage = 'home';

const PAGE_TITLES = {
  'home':         'Mali&Asha Diary ✨',
  'new-entry':    'New Entry 🖊️',
  'entry-detail': 'My Entry 📖',
  'calendar':     'Calendar 📅',
  'search':       'Search 🔍',
  'todo':         'My Tasks ✅',
  'memories':     'Memory Jar ⭐',
  'stats':        'My Stats 📊',
};
const SUB_PAGES  = new Set(['new-entry', 'entry-detail']);
const MAIN_PAGES = new Set(['home', 'calendar', 'search', 'todo', 'memories', 'stats']);

function showPage(name, opts={}, isBack=false) {
  stopReadAloud();
  stopTodoMic();
  stopRecording();
  stopAudioRecording();
  closeEdit();

  const prev = document.querySelector('.page.active');
  const next = document.getElementById('page-' + name);
  if (!next) return;

  if (prev === next) { if (name === 'home') renderHome(); return; }

  next.classList.add('active');
  if (prev) prev.classList.remove('active');
  next.classList.add(isBack ? 'slide-in-left' : 'slide-in-right');
  setTimeout(() => next.classList.remove('slide-in-right', 'slide-in-left'), 280);

  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const nb = document.getElementById('nav-' + name);
  if (nb) nb.classList.add('active');

  const isSubPage = SUB_PAGES.has(name);
  document.getElementById('backBtn').classList.toggle('hidden', !isSubPage);
  document.getElementById('profileBtn').classList.toggle('hidden', isSubPage);
  document.getElementById('settingsBtn').classList.toggle('hidden', isSubPage);
  document.getElementById('pageTitle').textContent = PAGE_TITLES[name] || 'Mali&Asha Diary ✨';

  if (MAIN_PAGES.has(name)) navHistory = [name];
  else navHistory.push(name);
  currentPage = name;

  if (name === 'home')         renderHome();
  if (name === 'new-entry')    initNewEntry();
  if (name === 'calendar')     renderCalendar();
  if (name === 'entry-detail') renderDetail(opts.id);
  if (name === 'todo')         renderTodos();
  if (name === 'memories')     renderMemories();
  if (name === 'stats')        renderStats();
  if (name === 'search') {
    document.getElementById('searchInput').value = '';
    document.getElementById('searchResults').innerHTML = '';
    searchTagFilter = '';
    renderTagFilter();
    setTimeout(() => document.getElementById('searchInput').focus(), 300);
  }
}

function goBack() {
  navHistory.pop();
  showPage(navHistory[navHistory.length - 1] || 'home', {}, true);
}

/* ════════════════════════════════
   Streak
════════════════════════════════ */
function calcStreak(entries) {
  if (!entries.length) return 0;
  const dates     = [...new Set(entries.map(entryLocalDate))].sort().reverse();
  const today     = localDateStr();
  const yesterday = localDateStr(new Date(Date.now()-864e5));
  if (dates[0] !== today && dates[0] !== yesterday) return 0;
  let streak = 1;
  for (let i = 1; i < dates.length; i++) {
    const a = new Date(dates[i-1]), b = new Date(dates[i]);
    if ((a - b) / 864e5 === 1) streak++;
    else break;
  }
  return streak;
}

/* ════════════════════════════════
   Mood Chart
════════════════════════════════ */
const MOOD_COLORS = {
  '😊': '#ffe066', '😢': '#72b7ff', '😠': '#ff6b6b',
  '😴': '#c77dff', '🤩': '#ff9f43', '😌': '#6bdaa8',
};

function renderMoodChart(entries) {
  const el = document.getElementById('moodChart');
  if (!el) return;
  const days = 14;
  const today = new Date();
  let html = '';
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const ds = localDateStr(d);
    const dayEntries = entries.filter(e => entryLocalDate(e) === ds);
    const mood = dayEntries.length ? (dayEntries[0].mood || '😊') : null;
    const color = mood ? (MOOD_COLORS[mood] || '#e0d0ff') : 'var(--border)';
    const isToday = i === 0;
    const label = d.toLocaleDateString(undefined, { weekday: 'short' }).charAt(0);
    html += `<div class="mood-bar-wrap${isToday ? ' today' : ''}">
      <div class="mood-bar-dot" style="background:${color}" title="${mood || 'no entry'}">${mood || ''}</div>
      <div class="mood-bar-day">${label}</div>
    </div>`;
  }
  el.innerHTML = html;
  document.getElementById('moodChartWrap').classList.toggle('hidden', !entries.length);
}

/* ════════════════════════════════
   Home
════════════════════════════════ */
async function renderHome() {
  const h = new Date().getHours();
  const p = PROFILES[getActiveProfile()];
  document.getElementById('homeGreeting').textContent =
    h < 12 ? `Good morning, ${p.name}! ☀️` :
    h < 17 ? `Good afternoon, ${p.name}! 🌤️` :
              `Good evening, ${p.name}! 🌙`;

  const entries = await dbAll();
  const streak  = calcStreak(entries);
  const badge   = document.getElementById('streakBadge');
  const zero    = document.getElementById('streakZero');

  if (streak >= 2) {
    badge.innerHTML = `<div class="streak-badge">${streak >= 7 ? '🔥' : '⭐'} ${streak} day streak!</div>`;
    badge.classList.remove('hidden'); zero.classList.add('hidden');
  } else if (streak === 1) {
    badge.innerHTML = `<div class="streak-badge">🌱 You wrote today!</div>`;
    badge.classList.remove('hidden'); zero.classList.add('hidden');
  } else {
    badge.classList.add('hidden');
    zero.textContent = 'Write today to start your streak! ✍️';
    zero.classList.remove('hidden');
  }

  renderMoodChart(entries);

  document.getElementById('recentEntries').innerHTML = entries.length
    ? entries.slice(0,15).map(entryCard).join('')
    : '<div class="empty-state">No entries yet — tap New to start! 🌟</div>';
}

function entryCard(e) {
  const raw      = e.text || '';
  const preview  = escapeHtml(raw.slice(0,60)) + (raw.length > 60 ? '…' : '');
  const dateStr  = new Date(e.date).toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'});
  const icons    = [
    e.photo    ? '📷' : '',
    e.drawing  ? '✏️' : '',
    e.audio    ? '🎤' : '',
    e.starred  ? '⭐' : '',
  ].filter(Boolean).join('');
  const tagsHtml = e.tags && e.tags.length
    ? `<div class="entry-card-tags">${tagBadges(e.tags)}</div>` : '';
  return `<div class="entry-card" onclick="showPage('entry-detail',{id:${e.id}})">
    ${icons ? `<div class="entry-card-icons">${icons}</div>` : ''}
    <div class="entry-card-header">
      <span class="entry-card-mood">${escapeHtml(e.mood||'😊')}</span>
      <span class="entry-card-date">${dateStr}</span>
    </div>
    <div class="entry-card-preview">${preview||'(no text)'}</div>
    ${tagsHtml}
  </div>`;
}

/* ════════════════════════════════
   Writing Prompts
════════════════════════════════ */
const PROMPTS = [
  "What made you smile today? 😊","What was the best part of your day? 🌟",
  "Did anything funny happen? 😂","What did you learn today? 🧠",
  "Who did you spend time with? 🤝","What yummy food did you eat? 🍕",
  "If you had a superpower today, what would it be? 🦸",
  "What was the hardest thing you did? 💪",
  "What are you looking forward to tomorrow? 🌈",
  "What made you feel proud today? 🏆","Did you help someone today? 🤗",
  "What was your favourite moment? ⭐",
  "If today was a colour, what colour would it be? 🎨",
  "What's something you want to remember forever? 💎",
  "What made you feel grumpy today? 😤 (it's ok!)",
  "What book, show or game did you enjoy? 🎮",
  "What's a secret you can tell your diary? 🤫",
  "What would make tomorrow even better? 🚀",
  "Describe today in just three words! 💬",
  "What are you thankful for today? 🙏",
];

function shufflePrompts() {
  const pool  = [...PROMPTS].sort(() => Math.random() - .5);
  const chips = document.getElementById('promptsChips');
  chips.innerHTML = pool.slice(0,3).map(p =>
    `<button class="prompt-chip" onclick="usePrompt(this)">${p}</button>`
  ).join('');
}

function usePrompt(btn) {
  const ta = document.getElementById('entryText');
  const txt = btn.textContent;
  ta.value = ta.value ? ta.value + '\n' + txt + ' ' : txt + ' ';
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
}

/* ════════════════════════════════
   New Entry
════════════════════════════════ */
let selectedMood = '😊', pendingPhoto = null;

function initNewEntry() {
  document.getElementById('entryDateLabel').textContent =
    new Date().toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric',year:'numeric'});
  document.getElementById('entryText').value       = '';
  document.getElementById('photoPreview').innerHTML = '';
  document.getElementById('photoPreview').classList.add('hidden');
  document.getElementById('photoInput').value      = '';
  document.getElementById('removeNewPhotoBtn').classList.add('hidden');
  document.getElementById('recordingIndicator').classList.add('hidden');
  document.getElementById('micBtn').classList.remove('recording');
  document.getElementById('micLabel').textContent  = 'Tap to Speak';
  pendingPhoto = null; selectedMood = '😊';
  newEntryTags = [];
  stopRecording();
  resetDoodle();
  resetAudioRecording();
  document.querySelectorAll('#page-new-entry .mood-btn').forEach(b =>
    b.classList.toggle('selected', b.dataset.mood === selectedMood));
  renderTagChips('newEntryTagsRow', newEntryTags, 'toggleNewTag');
  shufflePrompts();
}

function selectMood(btn) {
  btn.closest('.mood-options').querySelectorAll('.mood-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  selectedMood = btn.dataset.mood;
}

/* ════════════════════════════════
   Voice Recording (speech-to-text)
════════════════════════════════ */
let recognition = null, isRecording = false, finalText = '';
let nativeSpeechListeners = [];
let usingNativeSpeech = false;
let micTimeout = null;

function toggleRecording() { isRecording ? stopRecording() : startRecording(); }

async function startRecording() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SR) { usingNativeSpeech = false; startWebSpeech(SR); }
  else if (IS_NATIVE) { usingNativeSpeech = true; await startNativeSpeech(); }
  else { showToast('Voice not supported on this device 😢'); }
}

async function startNativeSpeech() {
  try {
    const { available } = await SpeechRecognition.available();
    if (!available) { showToast('Speech recognition not available 😢'); return; }
    const perm = await SpeechRecognition.requestPermissions();
    if (perm.speechRecognition !== 'granted' && perm.speechRecognition !== 'prompt') {
      showToast('Microphone permission denied — check App Settings 🎙️'); return;
    }
  } catch { showToast('Could not start voice — try typing instead 🖊️'); return; }

  finalText = document.getElementById('entryText').value;
  isRecording = true;
  document.getElementById('micBtn').classList.add('recording');
  document.getElementById('micLabel').textContent = 'Listening…';
  document.getElementById('recordingIndicator').classList.remove('hidden');
  micTimeout = setTimeout(() => stopRecording(), 30000);

  try {
    const result = await SpeechRecognition.start({ language: getLang(), maxResults: 5, popup: false, partialResults: false });
    const match  = result?.matches?.[0]?.trim();
    if (match) { const ta = document.getElementById('entryText'); ta.value = (ta.value + (ta.value ? ' ' : '') + match); }
    else { showToast("Didn't catch that — try again 🎙️"); }
  } catch (_) {}
  stopRecording();
}

function startWebSpeech(SR) {
  const rec = new SR();
  recognition = rec;
  finalText   = document.getElementById('entryText').value;
  rec.continuous = true; rec.interimResults = true; rec.lang = getLang();
  rec.onresult = event => {
    let interim = '', newFinal = '';
    for (let i = event.resultIndex; i < event.results.length; i++)
      event.results[i].isFinal ? (newFinal += event.results[i][0].transcript + ' ') : (interim += event.results[i][0].transcript);
    if (newFinal) finalText += newFinal;
    document.getElementById('entryText').value = finalText + interim;
  };
  rec.onerror = e => {
    if (e.error === 'not-allowed') { showToast('Microphone blocked — check App Permissions in Android Settings'); stopRecording(); return; }
    if (e.error === 'aborted') return;
    if (isRecording && recognition === rec) { try { rec.start(); } catch(_) { stopRecording(); } }
  };
  rec.onend = () => { if (isRecording && recognition === rec) { try { rec.start(); } catch(_) { stopRecording(); } } };
  try { rec.start(); } catch { recognition = null; showToast('Could not start mic — try again 🎙️'); return; }
  isRecording = true;
  document.getElementById('micBtn').classList.add('recording');
  document.getElementById('micLabel').textContent = 'Tap to Stop';
  document.getElementById('recordingIndicator').classList.remove('hidden');
  micTimeout = setTimeout(() => stopRecording(), 120000);
}

async function stopRecording() {
  clearTimeout(micTimeout); micTimeout = null;
  const wasRecording = isRecording; isRecording = false;
  if (wasRecording && usingNativeSpeech) {
    try { await SpeechRecognition.stop(); } catch (_) {}
    nativeSpeechListeners.forEach(l => { try { l.remove(); } catch(_){} });
    nativeSpeechListeners = [];
  }
  if (recognition) { try { recognition.stop(); } catch(_){} recognition = null; }
  usingNativeSpeech = false;
  document.getElementById('micBtn')?.classList.remove('recording');
  const lbl = document.getElementById('micLabel');
  if (lbl) lbl.textContent = 'Tap to Speak';
  document.getElementById('recordingIndicator')?.classList.add('hidden');
}

/* ════════════════════════════════
   Audio Clip Recording
════════════════════════════════ */
let mediaRecorder = null, audioChunks = [], recordedAudioB64 = null;
let audioRecording = false, audioRecTimerInt = null, audioRecSeconds = 0;

async function toggleAudioRecording() {
  audioRecording ? stopAudioRecording() : await startAudioRecording();
}

async function startAudioRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(audioChunks, { type: 'audio/webm' });
      recordedAudioB64 = await blobToB64(blob);
      const prev = document.getElementById('newAudioPreview');
      prev.innerHTML = `<audio controls src="${recordedAudioB64}" class="detail-audio"></audio>
        <button class="remove-photo-btn" onclick="clearAudioClip()">✕ Remove clip</button>`;
      prev.classList.remove('hidden');
    };
    mediaRecorder.start();
    audioRecording = true;
    audioRecSeconds = 0;
    document.getElementById('audioRecBtn').classList.add('recording');
    document.getElementById('audioRecLabel').textContent = 'Stop';
    document.getElementById('audioRecIcon').textContent = '⏹';
    document.getElementById('audioRecIndicator').classList.remove('hidden');
    audioRecTimerInt = setInterval(() => {
      audioRecSeconds++;
      document.getElementById('audioRecTimer').textContent = `Recording ${audioRecSeconds}s`;
      if (audioRecSeconds >= 120) stopAudioRecording();
    }, 1000);
  } catch (_) {
    showToast('Microphone not available for clip recording 😢');
  }
}

function stopAudioRecording() {
  if (!audioRecording) return;
  clearInterval(audioRecTimerInt);
  audioRecording = false;
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  document.getElementById('audioRecBtn')?.classList.remove('recording');
  const lbl = document.getElementById('audioRecLabel');
  if (lbl) lbl.textContent = 'Clip';
  const icon = document.getElementById('audioRecIcon');
  if (icon) icon.textContent = '🔴';
  document.getElementById('audioRecIndicator')?.classList.add('hidden');
}

function clearAudioClip() {
  recordedAudioB64 = null;
  const prev = document.getElementById('newAudioPreview');
  prev.innerHTML = ''; prev.classList.add('hidden');
}

function resetAudioRecording() {
  stopAudioRecording();
  recordedAudioB64 = null;
  const prev = document.getElementById('newAudioPreview');
  if (prev) { prev.innerHTML = ''; prev.classList.add('hidden'); }
}

function blobToB64(blob) {
  return new Promise(resolve => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.readAsDataURL(blob);
  });
}

/* ════════════════════════════════
   Doodle / Drawing
════════════════════════════════ */
let doodleActive = false, doodleDrawing = false;
let doodleColor = '#3a2a4d', doodleSize = 4;
const DOODLE_COLORS = ['#3a2a4d','#ff6b9d','#c77dff','#72b7ff','#6bdaa8','#ffb347','#ff4757','#fff'];

function initDoodle() {
  const canvas = document.getElementById('doodleCanvas');
  if (!canvas || canvas._initialized) return;
  canvas._initialized = true;
  const ctx = canvas.getContext('2d');

  const resize = () => {
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    canvas.width  = canvas.offsetWidth;
    canvas.height = 220;
    ctx.putImageData(data, 0, 0);
    ctx.fillStyle   = '#fffbf5';
    ctx.lineWidth   = doodleSize;
    ctx.lineCap     = 'round';
    ctx.strokeStyle = doodleColor;
  };

  canvas.width  = canvas.offsetWidth || 300;
  canvas.height = 220;
  ctx.fillStyle = '#fffbf5';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.lineWidth   = doodleSize;
  ctx.lineCap     = 'round';
  ctx.strokeStyle = doodleColor;

  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return { x: t.clientX - r.left, y: t.clientY - r.top };
  };

  const down = (e) => { e.preventDefault(); doodleDrawing = true; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); };
  const move = (e) => { e.preventDefault(); if (!doodleDrawing) return; const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); };
  const up   = () => { doodleDrawing = false; };

  canvas.addEventListener('mousedown', down);
  canvas.addEventListener('mousemove', move);
  canvas.addEventListener('mouseup',   up);
  canvas.addEventListener('mouseleave', up);
  canvas.addEventListener('touchstart', down, { passive: false });
  canvas.addEventListener('touchmove',  move, { passive: false });
  canvas.addEventListener('touchend',   up);

  // Color swatches
  const colorEl = document.getElementById('doodleColors');
  colorEl.innerHTML = DOODLE_COLORS.map(c =>
    `<button class="doodle-color-btn${c === doodleColor ? ' active' : ''}"
      style="background:${c};${c==='#fff'?'border-color:#ccc':''}"
      onclick="setDoodleColor('${c}',this)"></button>`
  ).join('');
}

function setDoodleColor(c, btn) {
  doodleColor = c;
  const canvas = document.getElementById('doodleCanvas');
  canvas.getContext('2d').strokeStyle = c;
  document.querySelectorAll('.doodle-color-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

function setDoodleSize(btn) {
  doodleSize = parseInt(btn.dataset.size);
  const canvas = document.getElementById('doodleCanvas');
  canvas.getContext('2d').lineWidth = doodleSize;
  document.querySelectorAll('.doodle-size-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

function toggleDoodle() {
  doodleActive = !doodleActive;
  const wrap = document.getElementById('doodleWrap');
  const btn  = document.getElementById('doodleToggleBtn');
  const clr  = document.getElementById('clearDoodleBtn');
  wrap.classList.toggle('hidden', !doodleActive);
  clr.classList.toggle('hidden', !doodleActive);
  btn.textContent = doodleActive ? '✏️ Hide drawing' : '✏️ Draw something';
  if (doodleActive) {
    setTimeout(() => initDoodle(), 50);
  }
}

function clearDoodle() {
  const canvas = document.getElementById('doodleCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fffbf5';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = doodleColor;
}

function getDoodleDataURL() {
  if (!doodleActive) return null;
  const canvas = document.getElementById('doodleCanvas');
  if (!canvas) return null;
  return canvas.toDataURL('image/png');
}

function resetDoodle() {
  doodleActive = false;
  const wrap = document.getElementById('doodleWrap');
  const btn  = document.getElementById('doodleToggleBtn');
  const clr  = document.getElementById('clearDoodleBtn');
  if (wrap) wrap.classList.add('hidden');
  if (clr) clr.classList.add('hidden');
  if (btn) btn.textContent = '✏️ Draw something';
  const canvas = document.getElementById('doodleCanvas');
  if (canvas) { canvas._initialized = false; }
}

/* ════════════════════════════════
   Photo
════════════════════════════════ */
function compressImage(file, maxPx=800, quality=0.75) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onerror = () => resolve(null);
    reader.onload  = ev => {
      const img = new Image();
      img.onerror = () => resolve(null);
      img.onload  = () => {
        let w = img.width, h = img.height;
        if (w > maxPx || h > maxPx) {
          if (w >= h) { h = Math.round(h * maxPx / w); w = maxPx; }
          else        { w = Math.round(w * maxPx / h); h = maxPx; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function handlePhoto(event) {
  const file = event.target.files[0]; if (!file) return;
  showToast('Compressing photo… 📷');
  const data = await compressImage(file);
  if (!data) { showToast('Could not read image 😢'); return; }
  pendingPhoto = data;
  const p = document.getElementById('photoPreview');
  p.innerHTML = `<img src="${data}" alt="photo" />`;
  p.classList.remove('hidden');
  document.getElementById('removeNewPhotoBtn').classList.remove('hidden');
}

function removeNewPhoto() {
  pendingPhoto = null;
  document.getElementById('photoInput').value = '';
  const p = document.getElementById('photoPreview');
  p.innerHTML = ''; p.classList.add('hidden');
  document.getElementById('removeNewPhotoBtn').classList.add('hidden');
}

/* ════════════════════════════════
   Save + Confetti
════════════════════════════════ */
async function saveEntry() {
  const text    = document.getElementById('entryText').value.trim();
  const drawing = getDoodleDataURL();
  if (!text && !pendingPhoto && !drawing && !recordedAudioB64) {
    showToast('Add some words, a photo, or a drawing first! 🖊️'); return;
  }
  await dbAdd({
    text, mood: selectedMood, tags: newEntryTags,
    date: new Date().toISOString(), localDate: localDateStr(),
    photo: pendingPhoto, drawing, audio: recordedAudioB64, starred: false,
  });
  launchConfetti();
  showToast('Saved! Amazing job! 🌟');
  showPage('home');
}

function launchConfetti() {
  const style  = getComputedStyle(document.documentElement);
  const colors = ['--p1','--p2','--blue','--green','--yellow','--orange']
    .map(v => style.getPropertyValue(v).trim());
  for (let i = 0; i < 90; i++) {
    const el    = document.createElement('div');
    const color = colors[Math.floor(Math.random() * colors.length)];
    const size  = 6 + Math.random() * 9;
    el.className = 'confetti-piece';
    el.style.cssText = `width:${size}px;height:${size}px;background:${color};
      border-radius:${Math.random()>.4?'50%':'2px'};left:${10+Math.random()*80}%;top:-12px;`;
    document.body.appendChild(el);
    const dur  = 1100 + Math.random() * 900;
    const drift = (Math.random()-.5) * 220;
    const rot   = Math.random() * 720 - 360;
    el.animate([
      { transform:`translateY(0) translateX(0) rotate(0deg)`, opacity:1 },
      { transform:`translateY(${window.innerHeight+60}px) translateX(${drift}px) rotate(${rot}deg)`, opacity:0 }
    ], { duration:dur, easing:'ease-in', delay:Math.random()*500 }).onfinish = () => el.remove();
  }
}

/* ════════════════════════════════
   Entry Detail + Read Aloud
════════════════════════════════ */
let currentDetailId = null, isSpeaking = false;

async function renderDetail(id) {
  if (!id) return;
  currentDetailId = id;
  resetDeleteBtn();
  const e = await dbGet(id); if (!e) return;
  document.getElementById('detailMood').textContent = e.mood || '😊';
  const d = new Date(e.date);
  document.getElementById('detailDate').textContent =
    d.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric',year:'numeric'}) +
    ' · ' + d.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'});
  document.getElementById('detailText').textContent      = e.text || '(no text)';
  document.getElementById('detailPhoto').innerHTML       = e.photo ? `<img src="${e.photo}" alt="photo" />` : '';
  document.getElementById('detailDrawing').innerHTML     = e.drawing ? `<img src="${e.drawing}" alt="drawing" class="drawing-img" />` : '';
  document.getElementById('detailTags').innerHTML        = tagBadges(e.tags);
  const audioWrap = document.getElementById('detailAudioWrap');
  if (e.audio) {
    document.getElementById('detailAudio').src = e.audio;
    audioWrap.classList.remove('hidden');
  } else {
    audioWrap.classList.add('hidden');
  }
  const starBtn = document.getElementById('starBtn');
  starBtn.textContent = e.starred ? '⭐ Starred' : '☆ Star';
  starBtn.classList.toggle('starred', !!e.starred);
  stopReadAloud();
}

function toggleReadAloud() { isSpeaking ? stopReadAloud() : startReadAloud(); }

function startReadAloud() {
  if (!window.speechSynthesis) { showToast('Text-to-speech not supported 😢'); return; }
  const text = document.getElementById('detailText').textContent;
  if (!text || text === '(no text)') { showToast('Nothing to read! 🤷'); return; }
  const utt  = new SpeechSynthesisUtterance(text);
  utt.rate   = 0.9; utt.pitch = 1.1;
  utt.onend  = stopReadAloud; utt.onerror = stopReadAloud;
  speechSynthesis.speak(utt);
  isSpeaking = true;
  const btn = document.getElementById('ttsBtn');
  btn.textContent = '⏹ Stop'; btn.classList.add('speaking');
}

function stopReadAloud() {
  if (window.speechSynthesis) speechSynthesis.cancel();
  isSpeaking = false;
  const btn = document.getElementById('ttsBtn');
  if (btn) { btn.textContent = '🔊 Read'; btn.classList.remove('speaking'); }
}

async function toggleFavorite() {
  if (!currentDetailId) return;
  const e = await dbGet(currentDetailId);
  if (!e) return;
  e.starred = !e.starred;
  await dbUpdate(e);
  const starBtn = document.getElementById('starBtn');
  starBtn.textContent = e.starred ? '⭐ Starred' : '☆ Star';
  starBtn.classList.toggle('starred', e.starred);
  showToast(e.starred ? 'Added to Memory Jar! ⭐' : 'Removed from Memory Jar');
}

let deleteConfirmTimer = null;
function resetDeleteBtn() {
  clearTimeout(deleteConfirmTimer);
  const btn = document.getElementById('deleteBtn');
  if (btn) { btn.classList.remove('confirming'); btn.textContent = '🗑️'; }
}
async function deleteCurrentEntry() {
  const btn = document.getElementById('deleteBtn');
  if (!btn.classList.contains('confirming')) {
    btn.classList.add('confirming'); btn.textContent = 'Sure?';
    deleteConfirmTimer = setTimeout(resetDeleteBtn, 3000); return;
  }
  resetDeleteBtn();
  if (!currentDetailId) return;
  await dbDelete(currentDetailId);
  showToast('Entry deleted!');
  goBack();
}

/* ── Edit Entry ── */
let editMood = '😊', editPhoto = null;

async function openEdit() {
  if (!currentDetailId) return;
  const e = await dbGet(currentDetailId); if (!e) return;
  editMood  = e.mood || '😊';
  editPhoto = null;
  editEntryTags = [...(e.tags || [])];
  document.getElementById('editText').value = e.text || '';
  document.getElementById('editPhotoInput').value = '';
  document.querySelectorAll('#editMoodOptions .mood-btn').forEach(b =>
    b.classList.toggle('selected', b.dataset.mood === editMood));
  const preview   = document.getElementById('editPhotoPreview');
  const removeBtn = document.getElementById('removePhotoBtn');
  if (e.photo) {
    preview.innerHTML = `<img src="${e.photo}" alt="photo" />`; preview.classList.remove('hidden');
    removeBtn.style.display = '';
  } else {
    preview.innerHTML = ''; preview.classList.add('hidden'); removeBtn.style.display = 'none';
  }
  renderTagChips('editEntryTagsRow', editEntryTags, 'toggleEditTag');
  document.getElementById('editOverlay').classList.remove('hidden');
  document.getElementById('editSheet').classList.remove('hidden');
  document.getElementById('editText').focus();
}

function closeEdit() {
  document.getElementById('editOverlay').classList.add('hidden');
  document.getElementById('editSheet').classList.add('hidden');
}

function selectEditMood(btn) {
  document.querySelectorAll('#editMoodOptions .mood-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected'); editMood = btn.dataset.mood;
}

async function handleEditPhoto(event) {
  const file = event.target.files[0]; if (!file) return;
  showToast('Compressing photo… 📷');
  const data = await compressImage(file);
  if (!data) { showToast('Could not read image 😢'); return; }
  editPhoto = data;
  const preview = document.getElementById('editPhotoPreview');
  preview.innerHTML = `<img src="${data}" alt="photo" />`; preview.classList.remove('hidden');
  document.getElementById('removePhotoBtn').style.display = '';
}

function removeEditPhoto() {
  editPhoto = false;
  document.getElementById('editPhotoPreview').innerHTML = '';
  document.getElementById('editPhotoPreview').classList.add('hidden');
  document.getElementById('removePhotoBtn').style.display = 'none';
}

async function saveEdit() {
  const text   = document.getElementById('editText').value.trim();
  const e      = await dbGet(currentDetailId); if (!e) return;
  const result = editPhoto === false ? null : (editPhoto || e.photo);
  if (!text && !result) { showToast('Add some words or a photo first! 🖊️'); return; }
  e.text = text; e.mood = editMood; e.tags = editEntryTags;
  if (editPhoto === false) e.photo = null;
  else if (editPhoto)      e.photo = editPhoto;
  await dbUpdate(e);
  closeEdit();
  renderDetail(currentDetailId);
  showToast('Entry updated! ✏️');
}

/* ════════════════════════════════
   Memories (Starred entries)
════════════════════════════════ */
async function renderMemories() {
  const entries  = await dbAll();
  const starred  = entries.filter(e => e.starred);
  const el       = document.getElementById('memoriesList');
  el.innerHTML   = starred.length
    ? starred.map(entryCard).join('')
    : '<div class="empty-state">Star your favourite entries to save them here! ⭐</div>';
}

/* ════════════════════════════════
   Stats / Year in Review
════════════════════════════════ */
async function renderStats() {
  const entries = await dbAll();
  const now = new Date();
  const thisYear = now.getFullYear();
  const yearEntries = entries.filter(e => new Date(e.date).getFullYear() === thisYear);

  const totalWords = yearEntries.reduce((n, e) => n + (e.text || '').split(/\s+/).filter(Boolean).length, 0);
  const streak     = calcStreak(entries);
  const longestStreak = calcLongestStreak(entries);

  document.getElementById('statsHero').innerHTML = `
    <div class="stats-hero-name">${PROFILES[getActiveProfile()].emoji} ${PROFILES[getActiveProfile()].name}'s ${thisYear}</div>
    <div class="stats-hero-sub">${yearEntries.length} entries written ✨</div>`;

  document.getElementById('statsGrid').innerHTML = `
    <div class="stat-box"><div class="stat-num">${yearEntries.length}</div><div class="stat-label">Entries this year</div></div>
    <div class="stat-box"><div class="stat-num">${totalWords.toLocaleString()}</div><div class="stat-label">Words written</div></div>
    <div class="stat-box"><div class="stat-num">${streak}</div><div class="stat-label">Current streak</div></div>
    <div class="stat-box"><div class="stat-num">${longestStreak}</div><div class="stat-label">Longest streak</div></div>
    <div class="stat-box"><div class="stat-num">${yearEntries.filter(e=>e.starred).length}</div><div class="stat-label">Starred entries</div></div>
    <div class="stat-box"><div class="stat-num">${yearEntries.filter(e=>e.photo).length}</div><div class="stat-label">Photos</div></div>`;

  // Mood breakdown
  const moodCount = {};
  yearEntries.forEach(e => { const m = e.mood || '😊'; moodCount[m] = (moodCount[m]||0)+1; });
  const sorted = Object.entries(moodCount).sort((a,b)=>b[1]-a[1]);
  document.getElementById('statsMoods').innerHTML = `
    <div class="stats-section-title">Mood breakdown 🎭</div>
    <div class="mood-breakdown">
      ${sorted.map(([m,c])=>`<div class="mood-stat-item"><span class="mood-stat-emoji">${m}</span><span class="mood-stat-count">${c}</span></div>`).join('')}
    </div>`;

  // Entries per month
  const monthCounts = Array(12).fill(0);
  yearEntries.forEach(e => { monthCounts[new Date(e.date).getMonth()]++; });
  const maxMonth = Math.max(...monthCounts, 1);
  const monthNames = ['J','F','M','A','M','J','J','A','S','O','N','D'];
  document.getElementById('statsMonths').innerHTML = `
    <div class="stats-section-title">Entries by month 📅</div>
    <div class="month-bars">
      ${monthCounts.map((c,i)=>`
        <div class="month-bar-wrap">
          <div class="month-bar" style="height:${Math.round(c/maxMonth*60)+4}px;background:${c?'var(--p1)':'var(--border)'}"></div>
          <div class="month-bar-num">${c||''}</div>
          <div class="month-bar-label">${monthNames[i]}</div>
        </div>`).join('')}
    </div>`;
}

function calcLongestStreak(entries) {
  if (!entries.length) return 0;
  const dates = [...new Set(entries.map(entryLocalDate))].sort();
  let max = 1, cur = 1;
  for (let i = 1; i < dates.length; i++) {
    const a = new Date(dates[i-1]), b = new Date(dates[i]);
    if ((b - a) / 864e5 === 1) { cur++; max = Math.max(max, cur); }
    else cur = 1;
  }
  return max;
}

/* ════════════════════════════════
   Export
════════════════════════════════ */
async function exportDiary() {
  const entries = await dbAll();
  if (!entries.length) { showToast('No entries to export yet! 📭'); return; }
  const SEP  = '━'.repeat(38);
  const date = new Date().toLocaleDateString(undefined,{day:'numeric',month:'long',year:'numeric'});
  const p    = PROFILES[getActiveProfile()];
  let text   = `${p.name.toUpperCase()}'S DIARY 📖\nExported: ${date}\n${'═'.repeat(38)}\n\n`;
  [...entries].reverse().forEach(e => {
    const d = new Date(e.date);
    text += SEP + '\n';
    text += `📅  ${d.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric',year:'numeric'})}`;
    text += `  ·  ${d.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})}\n`;
    text += `Mood: ${e.mood || '😊'}\n`;
    if (e.tags && e.tags.length) text += `Tags: ${e.tags.join(', ')}\n`;
    text += '\n' + (e.text || '(no text)') + '\n\n';
    if (e.photo)   text += '[📷 Photo attached]\n\n';
    if (e.drawing) text += '[✏️ Drawing attached]\n\n';
    if (e.audio)   text += '[🎤 Voice clip attached]\n\n';
  });
  const todos = loadTodos();
  if (todos.length) {
    text += SEP + '\nMY TASKS\n\n';
    todos.forEach(t => { text += `${t.done ? '☑' : '☐'} ${t.text}\n`; });
    text += '\n';
  }
  if (IS_NATIVE) {
    try {
      const filename = `${p.name.toLowerCase()}-diary-${localDateStr()}.txt`;
      const result = await Filesystem.writeFile({ path: filename, data: text, directory: Directory.Cache, encoding: Encoding.UTF8 });
      await Share.share({ title: `${p.name}'s Diary`, url: result.uri, dialogTitle: 'Save or share your diary' });
    } catch (_) { showToast('Could not share diary 😢'); }
    return;
  }
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `my-diary-${localDateStr()}.txt`;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  showToast('Diary downloaded! 📥');
}

async function exportDiaryJSON() {
  const entries = await dbAll();
  const todos   = loadTodos();
  if (!entries.length && !todos.length) { showToast('Nothing to export yet! 📭'); return; }
  const payload = { profile: getActiveProfile(), entries: entries.map(({ id: _id, ...rest }) => rest), todos };
  const jsonStr = JSON.stringify(payload, null, 2);
  const p       = PROFILES[getActiveProfile()];
  if (IS_NATIVE) {
    try {
      const filename = `${p.name.toLowerCase()}-diary-backup-${localDateStr()}.json`;
      const result = await Filesystem.writeFile({ path: filename, data: jsonStr, directory: Directory.Cache, encoding: Encoding.UTF8 });
      await Share.share({ title: `${p.name}'s Diary Backup`, url: result.uri, dialogTitle: 'Save your backup' });
    } catch (_) { showToast('Could not save backup 😢'); }
    return;
  }
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `my-diary-backup-${localDateStr()}.json`;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  showToast(`Backup saved (${entries.length} entries)! 📦`);
}

async function importDiary(event) {
  const file = event.target.files[0]; if (!file) return;
  event.target.value = '';
  try {
    const raw  = await file.text();
    const data = JSON.parse(raw);
    const incoming      = Array.isArray(data) ? data : (data.entries || []);
    const incomingTodos = Array.isArray(data) ? [] : (data.todos || []);
    const existing      = await dbAll();
    const fingerprints  = new Set(existing.map(e => entryLocalDate(e) + '|' + (e.text||'').trim().slice(0,120)));
    let added = 0, skipped = 0;
    for (const e of incoming) {
      if (!e.date) continue;
      const fp = (e.localDate || e.date.slice(0,10)) + '|' + (e.text||'').trim().slice(0,120);
      if (fingerprints.has(fp)) { skipped++; continue; }
      const { id: _id, ...clean } = e;
      await dbAdd(clean); fingerprints.add(fp); added++;
    }
    if (incomingTodos.length) {
      const et = loadTodos(); const eids = new Set(et.map(t => t.id));
      saveTodos([...et, ...incomingTodos.filter(t => !eids.has(t.id))]);
    }
    showToast(`Restored ${added} entries${skipped ? `, skipped ${skipped} dupes` : ''}! 🎉`);
    renderHome();
  } catch { showToast('Could not read backup file 😢'); }
}

/* ════════════════════════════════
   Calendar
════════════════════════════════ */
let calYear, calMonth;

function renderCalendar() {
  if (calYear === undefined) { const n = new Date(); calYear = n.getFullYear(); calMonth = n.getMonth(); }
  drawCalendar();
}
function changeMonth(d) {
  calMonth += d;
  if (calMonth < 0)  { calMonth = 11; calYear--; }
  if (calMonth > 11) { calMonth = 0;  calYear++; }
  drawCalendar();
  document.getElementById('calDayEntries').innerHTML = '';
}
async function drawCalendar() {
  const entries    = await dbAll();
  const entryDates = new Set(entries.map(entryLocalDate));
  const MONTHS     = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  document.getElementById('calMonthLabel').textContent = `${MONTHS[calMonth]} ${calYear}`;
  const todayStr  = localDateStr();
  const firstDay  = new Date(calYear, calMonth, 1).getDay();
  const totalDays = new Date(calYear, calMonth+1, 0).getDate();
  let html = ['Su','Mo','Tu','We','Th','Fr','Sa'].map(d=>`<div class="cal-day-name">${d}</div>`).join('');
  for (let i=0; i<firstDay; i++) html += '<div class="cal-day empty"></div>';
  for (let d=1; d<=totalDays; d++) {
    const ds  = `${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const cls = ['cal-day', ds===todayStr?'today':'', entryDates.has(ds)?'has-entry':''].filter(Boolean).join(' ');
    html += `<div class="${cls}" onclick="calDayClick(event,'${ds}')">${d}</div>`;
  }
  document.getElementById('calGrid').innerHTML = html;
}
async function calDayClick(ev, dateStr) {
  document.querySelectorAll('.cal-day').forEach(d => d.classList.remove('selected'));
  ev.currentTarget.classList.add('selected');
  const entries    = await dbAll();
  const dayEntries = entries.filter(e => entryLocalDate(e) === dateStr);
  document.getElementById('calDayEntries').innerHTML = dayEntries.length
    ? dayEntries.map(entryCard).join('')
    : '<div class="empty-state">No entries on this day 🌿</div>';
}

/* ════════════════════════════════
   Search
════════════════════════════════ */
async function doSearch() {
  const q       = document.getElementById('searchInput').value.trim().toLowerCase();
  const results = document.getElementById('searchResults');
  const entries = await dbAll();
  let matches   = entries;
  if (searchTagFilter) matches = matches.filter(e => (e.tags||[]).includes(searchTagFilter));
  if (q) matches = matches.filter(e => (e.text||'').toLowerCase().includes(q)||(e.mood||'').includes(q));
  if (!q && !searchTagFilter) { results.innerHTML = ''; return; }
  if (!matches.length) { results.innerHTML='<div class="empty-state">Nothing found 🔍</div>'; return; }
  const safeQ = q ? escapeHtml(q).replace(/[.*+?^${}()|[\]\\]/g,'\\$&') : null;
  const re    = safeQ ? new RegExp(safeQ,'gi') : null;
  results.innerHTML = matches.map(e => {
    const preview     = escapeHtml((e.text||'').slice(0,80));
    const highlighted = re ? preview.replace(re, m=>`<mark class="search-highlight">${m}</mark>`) : preview;
    const dateStr     = new Date(e.date).toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'});
    return `<div class="entry-card" onclick="showPage('entry-detail',{id:${e.id}})">
      <div class="entry-card-header">
        <span class="entry-card-mood">${escapeHtml(e.mood||'😊')}</span>
        <span class="entry-card-date">${dateStr}</span>
      </div>
      <div class="entry-card-preview">${highlighted||'(no text)'}</div>
      ${tagBadges(e.tags) ? `<div class="entry-card-tags">${tagBadges(e.tags)}</div>` : ''}
    </div>`;
  }).join('');
}

/* ════════════════════════════════
   To-Do List
════════════════════════════════ */
function loadTodos()   { try { return JSON.parse(localStorage.getItem(prefKey('todos')) || '[]'); } catch(_){ return []; } }
function saveTodos(ts) { localStorage.setItem(prefKey('todos'), JSON.stringify(ts)); }
function uid()         { return Date.now().toString(36) + Math.random().toString(36).slice(2,6); }

function renderTodos() {
  const todos  = loadTodos();
  const active = todos.filter(t => !t.done);
  const done   = todos.filter(t => t.done);
  const total  = todos.length, doneCount = done.length;
  document.getElementById('todoProgressLabel').textContent =
    total ? `${doneCount} of ${total} done` : 'No tasks yet — add one below! 🌟';
  document.getElementById('todoProgressFill').style.width = total ? (doneCount/total*100)+'%' : '0%';
  document.getElementById('todoActiveLabel').textContent = active.length ? `Tasks (${active.length})` : 'Tasks';
  document.getElementById('todoActiveList').innerHTML = active.length
    ? active.map(todoItem).join('')
    : '<div class="empty-state" style="margin-top:0;padding:12px 0">All done! 🎉</div>';
  const doneLabel = document.getElementById('todoDoneLabel');
  const doneList  = document.getElementById('todoDoneList');
  const clearBtn  = document.getElementById('todoClearBtn');
  if (done.length) {
    doneLabel.style.display = ''; doneList.innerHTML = done.map(todoItem).join(''); clearBtn.style.display = '';
  } else {
    doneLabel.style.display = 'none'; doneList.innerHTML = ''; clearBtn.style.display = 'none';
  }
}

function todoItem(t) {
  return `<div class="todo-item${t.done?' done':''}" id="todo-${t.id}">
    <button class="todo-check${t.done?' checked':''}" onclick="toggleTodo('${t.id}')">${t.done?'✓':''}</button>
    <span class="todo-text">${escapeHtml(t.text)}</span>
    <button class="todo-del" onclick="deleteTodo('${t.id}')" aria-label="Delete">✕</button>
  </div>`;
}

function addTodo() {
  const input = document.getElementById('todoInput');
  const text  = input.value.trim(); if (!text) { input.focus(); return; }
  const todos = loadTodos();
  todos.push({ id: uid(), text, done: false, createdAt: new Date().toISOString() });
  saveTodos(todos); input.value = ''; renderTodos(); stopTodoMic();
}
function toggleTodo(id) { const todos = loadTodos(); const t = todos.find(x => x.id===id); if (t) { t.done=!t.done; saveTodos(todos); renderTodos(); } }
function deleteTodo(id) { saveTodos(loadTodos().filter(t=>t.id!==id)); renderTodos(); }
function clearDoneTodos() { saveTodos(loadTodos().filter(t=>!t.done)); renderTodos(); }

let todoRecognition = null, isTodoRecording = false;
function toggleTodoMic() { isTodoRecording ? stopTodoMic() : startTodoMic(); }
function startTodoMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { showToast('Voice not supported — try Chrome! 😢'); return; }
  todoRecognition = new SR();
  todoRecognition.lang = getLang(); todoRecognition.interimResults = true;
  todoRecognition.onresult = e => {
    let txt = '';
    for (let i = e.resultIndex; i < e.results.length; i++) txt += e.results[i][0].transcript;
    document.getElementById('todoInput').value = txt;
    if (e.results[e.results.length-1].isFinal) { addTodo(); stopTodoMic(); }
  };
  todoRecognition.onerror = () => stopTodoMic();
  todoRecognition.onend   = () => stopTodoMic();
  todoRecognition.start();
  isTodoRecording = true;
  document.getElementById('todoMicBtn').classList.add('recording');
}
function stopTodoMic() {
  if (todoRecognition) { try { todoRecognition.stop(); } catch(_){} todoRecognition = null; }
  isTodoRecording = false;
  const btn = document.getElementById('todoMicBtn');
  if (btn) btn.classList.remove('recording');
}

/* ════════════════════════════════
   Toast
════════════════════════════════ */
let toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2600);
}

/* ════════════════════════════════
   Expose to HTML onclick
════════════════════════════════ */
Object.assign(window, {
  goBack, showPage, openSettings, closeSettings, openProfilePicker, closeProfilePicker, selectProfile,
  pinDigit, pinBackspace, pinClear, closePinOverlay, startSetPin, removePin,
  setDarkMode, setFontSize, setTheme, setFont, setReminder, saveReminderTime, saveLang,
  selectMood, toggleRecording, shufflePrompts, usePrompt,
  handlePhoto, removeNewPhoto, saveEntry,
  toggleReadAloud, toggleFavorite, openEdit, closeEdit, deleteCurrentEntry,
  selectEditMood, handleEditPhoto, removeEditPhoto, saveEdit,
  exportDiary, exportDiaryJSON, importDiary,
  changeMonth, calDayClick,
  doSearch, setTagFilter,
  toggleNewTag, toggleEditTag,
  toggleDoodle, clearDoodle, setDoodleColor, setDoodleSize,
  toggleAudioRecording, clearAudioClip,
  addTodo, toggleTodo, deleteTodo, clearDoneTodos, toggleTodoMic,
});

/* ════════════════════════════════
   Boot
════════════════════════════════ */
openDB()
  .then(() => {
    loadPrefs();
    updateProfileUI();
    // Show PIN on boot if active profile has one
    const ap  = getActiveProfile();
    const pin = getPin(ap);
    if (pin) {
      showPinOverlay('enter', ap, () => { showPage('home'); checkReminder(); });
      document.getElementById('pinCancelBtn').classList.add('hidden');
    } else {
      showPage('home');
      checkReminder();
    }
  })
  .catch(err => {
    document.body.innerHTML = `<p style="padding:20px;font-family:sans-serif">Could not open storage: ${err}</p>`;
  });

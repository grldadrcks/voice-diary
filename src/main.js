'use strict';

import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';

const IS_NATIVE = Capacitor.isNativePlatform();
const IS_IOS    = Capacitor.getPlatform() === 'ios';

/* ════════════════════════════════
   IndexedDB
════════════════════════════════ */
let db;
const DB_NAME = 'VoiceDiary', STORE = 'entries';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = e =>
      e.target.result.createObjectStore(STORE, { keyPath:'id', autoIncrement:true })
                     .createIndex('date','date',{unique:false});
    req.onsuccess = e => { db = e.target.result; resolve(); };
    req.onerror   = reject;
  });
}
const idb      = (mode) => db.transaction(STORE, mode).objectStore(STORE);
const dbAll    = () => new Promise((r,j)=>{ const q=idb('readonly').getAll(); q.onsuccess=()=>r(q.result.reverse()); q.onerror=j; });
const dbGet    = id => new Promise((r,j)=>{ const q=idb('readonly').get(id);  q.onsuccess=()=>r(q.result);          q.onerror=j; });
const dbAdd    = e  => new Promise((r,j)=>{ const q=idb('readwrite').add(e);  q.onsuccess=()=>r(q.result);          q.onerror=j; });
const dbDelete = id => new Promise((r,j)=>{ const q=idb('readwrite').delete(id); q.onsuccess=r; q.onerror=j; });
const dbUpdate = e  => new Promise((r,j)=>{ const q=idb('readwrite').put(e);    q.onsuccess=r; q.onerror=j; });

/* ════════════════════════════════
   Helpers
════════════════════════════════ */
function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function entryLocalDate(e) { return e.localDate || e.date.slice(0,10); }

function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/* ════════════════════════════════
   Settings / Prefs
════════════════════════════════ */
function loadPrefs() {
  const dark   = localStorage.getItem('diary-dark')   === 'true';
  const color  = localStorage.getItem('diary-color')  || 'blossom';
  const fs     = parseInt(localStorage.getItem('diary-fs') || '20', 10);
  const font   = localStorage.getItem('diary-font')   || 'Caveat';
  const remind = localStorage.getItem('diary-reminder') === 'true';
  const rtime  = localStorage.getItem('diary-reminder-time') || '20:00';

  applyDark(dark);
  applyColor(color);
  applyFontSize(fs);
  applyFont(font);

  document.getElementById('darkToggle').checked     = dark;
  document.getElementById('reminderToggle').checked = remind;
  document.getElementById('reminderTime').value     = rtime;
  const ls = document.getElementById('langSelect');
  if (ls) { ls.value = getLang(); if (!ls.value) ls.value = 'en-US'; }

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
  s.textContent = `html,body,input,textarea,select,.diary-textarea,.search-input,.todo-input,.prompt-chip{font-family:'${name}',cursive!important}`;
}

function setDarkMode(on) { applyDark(on); localStorage.setItem('diary-dark', on); }
function setFontSize(px) {
  applyFontSize(px);
  localStorage.setItem('diary-fs', px);
  document.querySelectorAll('.fs-btn').forEach(b =>
    b.classList.toggle('active', parseInt(b.dataset.size) === px));
}
function setTheme(name) {
  applyColor(name);
  localStorage.setItem('diary-color', name);
  document.querySelectorAll('.swatch').forEach(s =>
    s.classList.toggle('selected', s.dataset.color === name));
}
function setFont(name) {
  applyFont(name);
  localStorage.setItem('diary-font', name);
  document.querySelectorAll('.font-opt').forEach(o =>
    o.classList.toggle('selected', o.dataset.font === name));
}

function isIOSBrowser() {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const standalone = !!window.navigator.standalone ||
                     window.matchMedia('(display-mode: standalone)').matches;
  return ios && !standalone;
}

/* ── Reminder: native (Capacitor) or web ── */
async function setReminder(on) {
  if (on) {
    if (IS_NATIVE) {
      const perm = await LocalNotifications.requestPermissions();
      if (perm.display !== 'granted') {
        showToast('Allow notifications in Settings → Apps → Mali&Asha Diary 🔔');
        document.getElementById('reminderToggle').checked = false;
        return;
      }
    } else if (isIOSBrowser()) {
      showToast('Add to Home Screen first to enable reminders on iOS 📲');
      document.getElementById('reminderToggle').checked = false;
      return;
    } else if (!('Notification' in window)) {
      showToast('Notifications not supported on this browser 😢');
      document.getElementById('reminderToggle').checked = false;
      return;
    } else {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        showToast('Allow notifications in your browser first 🔔');
        document.getElementById('reminderToggle').checked = false;
        return;
      }
    }
  }
  localStorage.setItem('diary-reminder', on);
  if (IS_NATIVE) await syncNativeReminder(on);
}

async function syncNativeReminder(on) {
  try { await LocalNotifications.cancel({ notifications: [{ id: 101 }] }); } catch (_) {}
  if (!on) return;
  const rtime = localStorage.getItem('diary-reminder-time') || '20:00';
  const [rh, rm] = rtime.split(':').map(Number);
  const fireAt = new Date();
  fireAt.setHours(rh, rm, 0, 0);
  if (fireAt <= new Date()) fireAt.setDate(fireAt.getDate() + 1);
  await LocalNotifications.schedule({
    notifications: [{
      title: 'Mali&Asha Diary 📖',
      body:  "Don't forget to write in your diary today! 🌟",
      id:    101,
      schedule: { at: fireAt, repeats: true },
      iconColor: '#ff6b9d',
    }]
  });
}

function saveReminderTime() {
  localStorage.setItem('diary-reminder-time', document.getElementById('reminderTime').value);
  showToast('Reminder time saved! ✅');
  if (IS_NATIVE && localStorage.getItem('diary-reminder') === 'true') syncNativeReminder(true);
}
function getLang() { return localStorage.getItem('diary-lang') || navigator.language || 'en-US'; }
function saveLang(v) { localStorage.setItem('diary-lang', v); showToast('Language saved! 🗣️'); }

function openSettings() {
  loadPrefs();
  document.getElementById('settingsOverlay').classList.remove('hidden');
  document.getElementById('settingsSheet').classList.remove('hidden');
}
function closeSettings() {
  document.getElementById('settingsOverlay').classList.add('hidden');
  document.getElementById('settingsSheet').classList.add('hidden');
}

/* ── Web-only: check reminder on open ── */
async function checkReminder() {
  if (IS_NATIVE) return; // native app uses scheduled LocalNotifications
  if (localStorage.getItem('diary-reminder') !== 'true') return;

  const rtime   = localStorage.getItem('diary-reminder-time') || '20:00';
  const [rh,rm] = rtime.split(':').map(Number);
  const now     = new Date();
  const target  = new Date(now); target.setHours(rh, rm, 0, 0);
  if (now < target) return;

  const todayStr     = localDateStr(now);
  const lastReminder = localStorage.getItem('diary-last-reminder');
  if (lastReminder === todayStr) return;

  const entries    = await dbAll();
  const wroteToday = entries.some(e => entryLocalDate(e) === todayStr);
  if (!wroteToday) {
    localStorage.setItem('diary-last-reminder', todayStr);
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification('Mali&Asha Diary 📖', {
          body: "Don't forget to write in your diary today! 🌟",
          icon: '/icons/icon-192.png'
        });
        return;
      } catch(_) {}
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
  'home':'Mali&Asha Diary ✨', 'new-entry':'New Entry 🖊️',
  'entry-detail':'My Entry 📖', 'calendar':'Calendar 📅',
  'search':'Search 🔍', 'todo':'My Tasks ✅',
};
const SUB_PAGES  = new Set(['new-entry', 'entry-detail']);
const MAIN_PAGES = new Set(['home', 'calendar', 'search', 'todo']);

function showPage(name, opts={}, isBack=false) {
  stopReadAloud();
  stopTodoMic();
  stopRecording();
  closeEdit();

  const prev = document.querySelector('.page.active');
  const next = document.getElementById('page-' + name);

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
  document.getElementById('settingsBtn').classList.toggle('hidden', isSubPage);
  document.getElementById('pageTitle').textContent = PAGE_TITLES[name] || 'Mali&Asha Diary ✨';

  if (MAIN_PAGES.has(name)) navHistory = [name];
  else                       navHistory.push(name);
  currentPage = name;

  if (name === 'home')         renderHome();
  if (name === 'new-entry')    initNewEntry();
  if (name === 'calendar')     renderCalendar();
  if (name === 'entry-detail') renderDetail(opts.id);
  if (name === 'todo')         renderTodos();
  if (name === 'search') {
    document.getElementById('searchInput').value = '';
    document.getElementById('searchResults').innerHTML = '';
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
  const dates = [...new Set(entries.map(entryLocalDate))].sort().reverse();
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
   Home
════════════════════════════════ */
async function renderHome() {
  const h = new Date().getHours();
  document.getElementById('homeGreeting').textContent =
    h < 12 ? 'Good morning! ☀️' : h < 17 ? 'Good afternoon! 🌤️' : 'Good evening! 🌙';

  const entries = await dbAll();
  const streak  = calcStreak(entries);
  const badge   = document.getElementById('streakBadge');
  const zero    = document.getElementById('streakZero');

  if (streak >= 2) {
    badge.innerHTML = `<div class="streak-badge">${streak >= 7?'🔥':'⭐'} ${streak} day streak!</div>`;
    badge.classList.remove('hidden'); zero.classList.add('hidden');
  } else if (streak === 1) {
    badge.innerHTML = `<div class="streak-badge">🌱 You wrote today!</div>`;
    badge.classList.remove('hidden'); zero.classList.add('hidden');
  } else {
    badge.classList.add('hidden');
    zero.textContent = 'Write today to start your streak! ✍️';
    zero.classList.remove('hidden');
  }

  document.getElementById('recentEntries').innerHTML = entries.length
    ? entries.slice(0,15).map(entryCard).join('')
    : '<div class="empty-state">No entries yet — tap New to start! 🌟</div>';
}

function entryCard(e) {
  const raw     = e.text || '';
  const preview = escapeHtml(raw.slice(0,60)) + (raw.length > 60 ? '…' : '');
  const dateStr = new Date(e.date).toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'});
  const photoIcon = e.photo ? '<span class="entry-card-has-photo">📷</span>' : '';
  return `<div class="entry-card" onclick="showPage('entry-detail',{id:${e.id}})">
    ${photoIcon}
    <div class="entry-card-header">
      <span class="entry-card-mood">${escapeHtml(e.mood||'😊')}</span>
      <span class="entry-card-date">${dateStr}</span>
    </div>
    <div class="entry-card-preview">${preview||'(no text)'}</div>
  </div>`;
}

/* ════════════════════════════════
   Writing Prompts
════════════════════════════════ */
const PROMPTS = [
  "What made you smile today? 😊",
  "What was the best part of your day? 🌟",
  "Did anything funny happen? 😂",
  "What did you learn today? 🧠",
  "Who did you spend time with? 🤝",
  "What yummy food did you eat? 🍕",
  "If you had a superpower today, what would it be? 🦸",
  "What was the hardest thing you did? 💪",
  "What are you looking forward to tomorrow? 🌈",
  "What made you feel proud today? 🏆",
  "Did you help someone today? 🤗",
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
  chips.innerHTML = pool.slice(0, 3).map(p =>
    `<button class="prompt-chip" onclick="usePrompt(this)">${p}</button>`
  ).join('');
}

function usePrompt(btn) {
  const ta  = document.getElementById('entryText');
  const txt = btn.textContent;
  ta.value  = ta.value ? ta.value + '\n' + txt + ' ' : txt + ' ';
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
  document.getElementById('entryText').value = '';
  document.getElementById('photoPreview').innerHTML = '';
  document.getElementById('photoPreview').classList.add('hidden');
  document.getElementById('photoInput').value = '';
  document.getElementById('recordingIndicator').classList.add('hidden');
  document.getElementById('micBtn').classList.remove('recording');
  document.getElementById('micLabel').textContent = 'Tap to Speak';
  pendingPhoto = null; selectedMood = '😊';
  stopRecording();
  document.querySelectorAll('#page-new-entry .mood-btn').forEach(b =>
    b.classList.toggle('selected', b.dataset.mood === selectedMood));
  shufflePrompts();
}

function selectMood(btn) {
  btn.closest('.mood-options').querySelectorAll('.mood-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  selectedMood = btn.dataset.mood;
}

/* ════════════════════════════════
   Voice Recording
════════════════════════════════ */
let recognition = null, isRecording = false, finalText = '';
let nativeSpeechListeners = [];

function toggleRecording() { isRecording ? stopRecording() : startRecording(); }

async function startRecording() {
  if (IS_NATIVE) {
    await startNativeSpeech();
  } else {
    startWebSpeech();
  }
}

async function startNativeSpeech() {
  try {
    const { available } = await SpeechRecognition.available();
    if (!available) { showToast('Speech recognition not available on this device 😢'); return; }
    const perm = await SpeechRecognition.requestPermissions();
    if (perm.speechRecognition !== 'granted') { showToast('Microphone permission denied 🎙️'); return; }
  } catch (err) {
    showToast('Could not start voice — try typing instead 🖊️');
    return;
  }

  finalText   = document.getElementById('entryText').value;
  isRecording = true;
  document.getElementById('micBtn').classList.add('recording');
  document.getElementById('micLabel').textContent = 'Tap to Stop';
  document.getElementById('recordingIndicator').classList.remove('hidden');

  const listener = await SpeechRecognition.addListener('partialResults', data => {
    if (data.matches?.length) {
      document.getElementById('entryText').value = finalText + data.matches[0];
    }
  });
  nativeSpeechListeners.push(listener);

  try {
    await SpeechRecognition.start({
      language: getLang(),
      maxResults: 1,
      popup: false,
      partialResults: true,
    });
  } catch (_) {
    stopRecording();
  }
}

function startWebSpeech() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { showToast('Voice not supported — try Chrome! 😢'); return; }
  finalText   = document.getElementById('entryText').value;
  recognition = new SR();
  recognition.continuous = true; recognition.interimResults = true; recognition.lang = getLang();
  recognition.onresult = event => {
    let interim = '', newFinal = '';
    for (let i = event.resultIndex; i < event.results.length; i++)
      event.results[i].isFinal ? (newFinal += event.results[i][0].transcript+' ') : (interim += event.results[i][0].transcript);
    if (newFinal) finalText += newFinal;
    document.getElementById('entryText').value = finalText + interim;
  };
  recognition.onerror = e => { if (e.error!=='aborted') showToast('Mic error: '+e.error); stopRecording(); };
  recognition.onend   = () => { if (isRecording) stopRecording(); };
  recognition.start();
  isRecording = true;
  document.getElementById('micBtn').classList.add('recording');
  document.getElementById('micLabel').textContent = 'Tap to Stop';
  document.getElementById('recordingIndicator').classList.remove('hidden');
}

async function stopRecording() {
  if (IS_NATIVE && isRecording) {
    try { await SpeechRecognition.stop(); } catch (_) {}
    nativeSpeechListeners.forEach(l => { try { l.remove(); } catch(_){} });
    nativeSpeechListeners = [];
    finalText = document.getElementById('entryText').value;
  }
  if (recognition) { try { recognition.stop(); } catch(_){} recognition = null; }
  isRecording = false;
  document.getElementById('micBtn')?.classList.remove('recording');
  const lbl = document.getElementById('micLabel');
  if (lbl) lbl.textContent = 'Tap to Speak';
  document.getElementById('recordingIndicator')?.classList.add('hidden');
}

/* ════════════════════════════════
   Photo
════════════════════════════════ */
function compressImage(file, maxPx=800, quality=0.75) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onerror = () => resolve(null);
    reader.onload = ev => {
      const img = new Image();
      img.onerror = () => resolve(null);
      img.onload = () => {
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
}

/* ════════════════════════════════
   Save + Confetti
════════════════════════════════ */
async function saveEntry() {
  const text = document.getElementById('entryText').value.trim();
  if (!text && !pendingPhoto) { showToast('Add some words or a photo first! 🖊️'); return; }
  await dbAdd({ text, mood: selectedMood, date: new Date().toISOString(), localDate: localDateStr(), photo: pendingPhoto });
  launchConfetti();
  showToast('Saved! Amazing job! 🌟');
  showPage('home');
}

function launchConfetti() {
  const style  = getComputedStyle(document.documentElement);
  const colors = [
    style.getPropertyValue('--p1').trim(),
    style.getPropertyValue('--p2').trim(),
    style.getPropertyValue('--blue').trim(),
    style.getPropertyValue('--green').trim(),
    style.getPropertyValue('--yellow').trim(),
    style.getPropertyValue('--orange').trim(),
  ];
  for (let i = 0; i < 90; i++) {
    const el     = document.createElement('div');
    const color  = colors[Math.floor(Math.random() * colors.length)];
    const size   = 6 + Math.random() * 9;
    const isCirc = Math.random() > .4;
    el.className = 'confetti-piece';
    el.style.cssText = `width:${size}px;height:${size}px;background:${color};
      border-radius:${isCirc?'50%':'2px'};left:${10+Math.random()*80}%;top:-12px;`;
    document.body.appendChild(el);
    const dur   = 1100 + Math.random() * 900;
    const drift = (Math.random() - .5) * 220;
    const rot   = Math.random() * 720 - 360;
    el.animate([
      { transform:`translateY(0) translateX(0) rotate(0deg)`,     opacity: 1 },
      { transform:`translateY(${window.innerHeight+60}px) translateX(${drift}px) rotate(${rot}deg)`, opacity: 0 }
    ], { duration: dur, easing:'ease-in', delay: Math.random() * 500 })
      .onfinish = () => el.remove();
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
  document.getElementById('detailText').textContent = e.text || '(no text)';
  document.getElementById('detailPhoto').innerHTML  = e.photo ? `<img src="${e.photo}" alt="photo" />` : '';
  stopReadAloud();
}

function toggleReadAloud() { isSpeaking ? stopReadAloud() : startReadAloud(); }

function startReadAloud() {
  if (!window.speechSynthesis) { showToast('Text-to-speech not supported 😢'); return; }
  const text = document.getElementById('detailText').textContent;
  if (!text || text === '(no text)') { showToast('Nothing to read! 🤷'); return; }
  const utt   = new SpeechSynthesisUtterance(text);
  utt.rate    = 0.9; utt.pitch = 1.1;
  utt.onend   = stopReadAloud;
  utt.onerror = stopReadAloud;
  speechSynthesis.speak(utt);
  isSpeaking = true;
  const btn = document.getElementById('ttsBtn');
  btn.textContent = '⏹ Stop Reading';
  btn.classList.add('speaking');
}

function stopReadAloud() {
  if (window.speechSynthesis) speechSynthesis.cancel();
  isSpeaking = false;
  const btn = document.getElementById('ttsBtn');
  if (btn) { btn.textContent = '🔊 Read Aloud'; btn.classList.remove('speaking'); }
}

let deleteConfirmTimer = null;
function resetDeleteBtn() {
  clearTimeout(deleteConfirmTimer);
  const btn = document.getElementById('deleteBtn');
  if (btn) { btn.classList.remove('confirming'); btn.textContent = '🗑️ Delete'; }
}
async function deleteCurrentEntry() {
  const btn = document.getElementById('deleteBtn');
  if (!btn.classList.contains('confirming')) {
    btn.classList.add('confirming');
    btn.textContent = 'Tap again to confirm';
    deleteConfirmTimer = setTimeout(resetDeleteBtn, 3000);
    return;
  }
  resetDeleteBtn();
  if (!currentDetailId) return;
  await dbDelete(currentDetailId);
  showToast('Entry deleted!');
  goBack();
}

/* ── Edit Entry ── */
let editMood = '😊';
let editPhoto = null;

async function openEdit() {
  if (!currentDetailId) return;
  const e = await dbGet(currentDetailId);
  if (!e) return;
  editMood  = e.mood || '😊';
  editPhoto = null;
  document.getElementById('editText').value = e.text || '';
  document.getElementById('editPhotoInput').value = '';
  document.querySelectorAll('#editMoodOptions .mood-btn').forEach(b => {
    b.classList.toggle('selected', b.dataset.mood === editMood);
  });
  const preview   = document.getElementById('editPhotoPreview');
  const removeBtn = document.getElementById('removePhotoBtn');
  if (e.photo) {
    preview.innerHTML = `<img src="${e.photo}" alt="photo" />`;
    preview.classList.remove('hidden');
    removeBtn.style.display = '';
  } else {
    preview.innerHTML = '';
    preview.classList.add('hidden');
    removeBtn.style.display = 'none';
  }
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
  btn.classList.add('selected');
  editMood = btn.dataset.mood;
}

async function handleEditPhoto(event) {
  const file = event.target.files[0]; if (!file) return;
  showToast('Compressing photo… 📷');
  const data = await compressImage(file);
  if (!data) { showToast('Could not read image 😢'); return; }
  editPhoto  = data;
  const preview = document.getElementById('editPhotoPreview');
  preview.innerHTML = `<img src="${data}" alt="photo" />`;
  preview.classList.remove('hidden');
  document.getElementById('removePhotoBtn').style.display = '';
}

function removeEditPhoto() {
  editPhoto = false;
  document.getElementById('editPhotoPreview').innerHTML = '';
  document.getElementById('editPhotoPreview').classList.add('hidden');
  document.getElementById('removePhotoBtn').style.display = 'none';
}

async function saveEdit() {
  const text = document.getElementById('editText').value.trim();
  const e    = await dbGet(currentDetailId);
  if (!e) return;
  const resultPhoto = editPhoto === false ? null : (editPhoto || e.photo);
  if (!text && !resultPhoto) { showToast('Add some words or a photo first! 🖊️'); return; }
  e.text = text;
  e.mood = editMood;
  if (editPhoto === false) e.photo = null;
  else if (editPhoto)      e.photo = editPhoto;
  await dbUpdate(e);
  closeEdit();
  renderDetail(currentDetailId);
  showToast('Entry updated! ✏️');
}

/* ════════════════════════════════
   Export  — native uses Share, web uses download
════════════════════════════════ */
async function exportDiary() {
  const entries = await dbAll();
  if (!entries.length) { showToast('No entries to export yet! 📭'); return; }

  const SEP  = '━'.repeat(38);
  const date = new Date().toLocaleDateString(undefined,{day:'numeric',month:'long',year:'numeric'});
  let text   = `MALI&ASHA DIARY 📖\nExported: ${date}\n${'═'.repeat(38)}\n\n`;

  [...entries].reverse().forEach(e => {
    const d = new Date(e.date);
    text += SEP + '\n';
    text += `📅  ${d.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric',year:'numeric'})}`;
    text += `  ·  ${d.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})}\n`;
    text += `Mood: ${e.mood || '😊'}\n\n`;
    text += (e.text || '(no text)') + '\n\n';
    if (e.photo) text += '[📷 Photo attached]\n\n';
  });

  const todos = loadTodos();
  if (todos.length) {
    text += SEP + '\nMY TASKS\n\n';
    todos.forEach(t => { text += `${t.done ? '☑' : '☐'} ${t.text}\n`; });
    text += '\n';
  }

  if (IS_NATIVE) {
    try {
      const filename = `my-diary-${localDateStr()}.txt`;
      const result = await Filesystem.writeFile({
        path: filename, data: text,
        directory: Directory.Cache, encoding: Encoding.UTF8,
      });
      await Share.share({ title: 'Mali&Asha Diary', url: result.uri, dialogTitle: 'Save or share your diary' });
    } catch (_) { showToast('Could not share diary 😢'); }
    return;
  }

  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `my-diary-${localDateStr()}.txt`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  showToast('Diary downloaded! 📥');
}

async function exportDiaryJSON() {
  const entries = await dbAll();
  const todos   = loadTodos();
  if (!entries.length && !todos.length) { showToast('Nothing to export yet! 📭'); return; }
  const payload = { entries: entries.map(({ id: _id, ...rest }) => rest), todos };
  const jsonStr = JSON.stringify(payload, null, 2);

  if (IS_NATIVE) {
    try {
      const filename = `my-diary-backup-${localDateStr()}.json`;
      const result = await Filesystem.writeFile({
        path: filename, data: jsonStr,
        directory: Directory.Cache, encoding: Encoding.UTF8,
      });
      await Share.share({ title: 'Mali&Asha Diary Backup', url: result.uri, dialogTitle: 'Save your backup' });
    } catch (_) { showToast('Could not save backup 😢'); }
    return;
  }

  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `my-diary-backup-${localDateStr()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  showToast(`Backup saved (${entries.length} entries, ${todos.length} tasks)! 📦`);
}

async function importDiary(event) {
  const file = event.target.files[0]; if (!file) return;
  event.target.value = '';
  try {
    const raw  = await file.text();
    const data = JSON.parse(raw);

    const incoming      = Array.isArray(data) ? data : (data.entries || []);
    const incomingTodos = Array.isArray(data) ? [] : (data.todos || []);

    const existing     = await dbAll();
    const fingerprints = new Set(existing.map(e =>
      entryLocalDate(e) + '|' + (e.text || '').trim().slice(0, 120)
    ));

    let added = 0, skipped = 0;
    for (const e of incoming) {
      if (!e.date) continue;
      const fp = (e.localDate || e.date.slice(0,10)) + '|' + (e.text || '').trim().slice(0, 120);
      if (fingerprints.has(fp)) { skipped++; continue; }
      const { id: _id, ...clean } = e;
      await dbAdd(clean);
      fingerprints.add(fp);
      added++;
    }

    if (incomingTodos.length) {
      const existingTodos = loadTodos();
      const existingIds   = new Set(existingTodos.map(t => t.id));
      saveTodos([...existingTodos, ...incomingTodos.filter(t => !existingIds.has(t.id))]);
    }

    const dupMsg = skipped ? `, skipped ${skipped} duplicates` : '';
    showToast(`Restored ${added} entries${dupMsg}! 🎉`);
    renderHome();
  } catch {
    showToast('Could not read backup file 😢');
  }
}

/* ════════════════════════════════
   Calendar
════════════════════════════════ */
let calYear, calMonth;

function renderCalendar() {
  if (calYear === undefined) {
    const n = new Date(); calYear = n.getFullYear(); calMonth = n.getMonth();
  }
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
  const MONTHS     = ['January','February','March','April','May','June',
                      'July','August','September','October','November','December'];
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
  if (!q) { results.innerHTML=''; return; }
  const entries = await dbAll();
  const matches = entries.filter(e => (e.text||'').toLowerCase().includes(q)||(e.mood||'').includes(q));
  if (!matches.length) { results.innerHTML='<div class="empty-state">Nothing found 🔍</div>'; return; }
  const safeQ = escapeHtml(q).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const re    = new RegExp(safeQ,'gi');
  results.innerHTML = matches.map(e => {
    const preview     = escapeHtml((e.text||'').slice(0,80));
    const highlighted = preview.replace(re, m=>`<mark class="search-highlight">${m}</mark>`);
    const dateStr     = new Date(e.date).toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'});
    return `<div class="entry-card" onclick="showPage('entry-detail',{id:${e.id}})">
      <div class="entry-card-header">
        <span class="entry-card-mood">${escapeHtml(e.mood||'😊')}</span>
        <span class="entry-card-date">${dateStr}</span>
      </div>
      <div class="entry-card-preview">${highlighted}</div>
    </div>`;
  }).join('');
}

/* ════════════════════════════════
   To-Do List
════════════════════════════════ */
function loadTodos()   { try { return JSON.parse(localStorage.getItem('diary-todos') || '[]'); } catch(_){ return []; } }
function saveTodos(ts) { localStorage.setItem('diary-todos', JSON.stringify(ts)); }
function uid()         { return Date.now().toString(36) + Math.random().toString(36).slice(2,6); }

function renderTodos() {
  const todos  = loadTodos();
  const active = todos.filter(t => !t.done);
  const done   = todos.filter(t => t.done);

  const total = todos.length, doneCount = done.length;
  document.getElementById('todoProgressLabel').textContent =
    total ? `${doneCount} of ${total} done` : 'No tasks yet — add one below! 🌟';
  document.getElementById('todoProgressFill').style.width =
    total ? (doneCount / total * 100) + '%' : '0%';

  document.getElementById('todoActiveLabel').textContent =
    active.length ? `Tasks (${active.length})` : 'Tasks';
  document.getElementById('todoActiveList').innerHTML = active.length
    ? active.map(todoItem).join('')
    : '<div class="empty-state" style="margin-top:0;padding:12px 0">All done! 🎉</div>';

  const doneLabel = document.getElementById('todoDoneLabel');
  const doneList  = document.getElementById('todoDoneList');
  const clearBtn  = document.getElementById('todoClearBtn');
  if (done.length) {
    doneLabel.style.display = '';
    doneList.innerHTML = done.map(todoItem).join('');
    clearBtn.style.display = '';
  } else {
    doneLabel.style.display = 'none';
    doneList.innerHTML = '';
    clearBtn.style.display = 'none';
  }
}

function todoItem(t) {
  const checked  = t.done ? 'checked' : '';
  const doneClass = t.done ? 'done' : '';
  return `<div class="todo-item ${doneClass}" id="todo-${t.id}">
    <button class="todo-check ${checked}" onclick="toggleTodo('${t.id}')">${t.done ? '✓' : ''}</button>
    <span class="todo-text">${escapeHtml(t.text)}</span>
    <button class="todo-del" onclick="deleteTodo('${t.id}')" aria-label="Delete">✕</button>
  </div>`;
}

function addTodo() {
  const input = document.getElementById('todoInput');
  const text  = input.value.trim();
  if (!text) { input.focus(); return; }
  const todos = loadTodos();
  todos.push({ id: uid(), text, done: false, createdAt: new Date().toISOString() });
  saveTodos(todos);
  input.value = '';
  renderTodos();
  stopTodoMic();
}

function toggleTodo(id) {
  const todos = loadTodos();
  const t = todos.find(x => x.id === id);
  if (t) { t.done = !t.done; saveTodos(todos); renderTodos(); }
}

function deleteTodo(id) {
  saveTodos(loadTodos().filter(t => t.id !== id));
  renderTodos();
}

function clearDoneTodos() {
  saveTodos(loadTodos().filter(t => !t.done));
  renderTodos();
}

/* ── Voice input for todos ── */
let todoRecognition = null, isTodoRecording = false;

function toggleTodoMic() { isTodoRecording ? stopTodoMic() : startTodoMic(); }

function startTodoMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { showToast('Voice not supported — try Chrome! 😢'); return; }
  todoRecognition = new SR();
  todoRecognition.lang = getLang(); todoRecognition.interimResults = true;
  todoRecognition.onresult = e => {
    let txt = '';
    for (let i = e.resultIndex; i < e.results.length; i++)
      txt += e.results[i][0].transcript;
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
   Expose functions to HTML onclick handlers
════════════════════════════════ */
Object.assign(window, {
  goBack, showPage, openSettings, closeSettings,
  setDarkMode, setFontSize, setTheme, setFont,
  setReminder, saveReminderTime, saveLang,
  selectMood, toggleRecording, shufflePrompts, usePrompt,
  handlePhoto, saveEntry,
  toggleReadAloud, openEdit, closeEdit, deleteCurrentEntry,
  selectEditMood, handleEditPhoto, removeEditPhoto, saveEdit,
  exportDiary, exportDiaryJSON, importDiary,
  changeMonth, calDayClick,
  doSearch, addTodo, toggleTodo, deleteTodo, clearDoneTodos, toggleTodoMic,
});

/* ════════════════════════════════
   Boot
════════════════════════════════ */
openDB()
  .then(() => { loadPrefs(); showPage('home'); checkReminder(); })
  .catch(err => {
    document.body.innerHTML = `<p style="padding:20px;font-family:sans-serif">Could not open storage: ${err}</p>`;
  });

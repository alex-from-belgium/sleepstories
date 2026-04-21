/* =====================================================
   Sleepstories — Bedtime Stories PWA
   All API calls route through the Cloudflare Worker.
   ===================================================== */

const LS_KEYS = {
  workerUrl: 'ss_worker_url',
  password: 'ss_pw',
  familyContext: 'ss_family_ctx',
  promptHistory: 'ss_prompt_history',
  lastLang: 'ss_last_lang',
  lastName: 'ss_last_name'
};

const DEFAULT_WORKER_URL = window.SLEEPSTORIES_WORKER_URL || window.LULLABY_WORKER_URL || '';

const DB_NAME = 'sleepstories_db';
const DB_VERSION = 1;
const STORE_STORIES = 'stories';
const STORE_AUDIO = 'audio_blobs';

// ---------- THEME LIBRARY ----------
// Each theme is a set of randomized About prompts so "Random surprise" and
// thematic clicks produce varied output, not the same text every time.
const THEMES = {
  random: {
    en: [
      'A dreamy journey through a quiet forest where the animals are getting ready for bed.',
      'A tiny fox who discovers a glowing stone that leads to a hidden meadow of stars.',
      'A sleepy turtle carrying the moon on its back across a still, silvery lake.',
      'A little cloud who helps the sun say goodnight to all the mountains.',
      'An owl and a rabbit who become friends and share their favorite bedtime secrets.',
      'A gentle dragon who only breathes out soft, warm clouds to tuck the world in.'
    ],
    nl: [
      'Een droomreis door een stil bos waar de dieren zich klaarmaken om te slapen.',
      'Een klein vosje dat een gloeiende steen vindt die leidt naar een verborgen weide vol sterren.',
      'Een slaperige schildpad die de maan op zijn rug over een stil, zilverkleurig meer draagt.',
      'Een wolkje dat de zon helpt welterusten te zeggen tegen alle bergen.',
      'Een uil en een konijn die vrienden worden en hun favoriete slaapgeheimen delen.'
    ]
  },
  forest: {
    en: [
      'A gentle adventure with forest friends — a rabbit, an owl, and a fox who share a quiet evening together under the trees.',
      'A tiny hedgehog wandering through a mossy forest, meeting kind animals who show the way home before bedtime.',
      'A wise old owl tells a story to all the young woodland creatures as the moon rises above the pines.'
    ],
    nl: [
      'Een zacht avontuur met vrienden uit het bos — een konijn, een uil en een vos die samen een stille avond doorbrengen onder de bomen.',
      'Een klein egeltje dat door een bemoste bos dwaalt en lieve dieren ontmoet die de weg naar huis wijzen voor bedtijd.'
    ]
  },
  kindergarten: {
    en: [
      'A warm day at kindergarten, full of coloring, building blocks, songs with friends, and a peaceful walk home at the end.',
      'A story about making a new friend on the first day of kindergarten and how kindness makes everything feel safe.',
      'A sweet kindergarten adventure where a lost teddy bear is found by the whole class and brought back to its owner.'
    ],
    nl: [
      'Een warme dag op de kleuterschool, vol kleuren, bouwblokken, liedjes met vriendjes, en een vredige wandeling naar huis aan het einde.',
      'Een verhaal over een nieuw vriendje maken op de eerste dag van de kleuterschool en hoe vriendelijkheid alles veilig laat voelen.'
    ]
  },
  cosmos: {
    en: [
      'The moon and the stars softly lighting the world at night, whispering goodnight to every rooftop and every sleeping creature.',
      'A curious little star who comes down to see the world and learns that bedtime is the most magical time of all.',
      'The sun saying goodnight to the moon, and the moon gently taking over to watch over everyone until morning.'
    ],
    nl: [
      'De maan en de sterren die de wereld zachtjes verlichten in de nacht, welterusten fluisterend tegen elk dak en elk slapend wezen.',
      'Een nieuwsgierig sterretje dat naar beneden komt om de wereld te zien en leert dat bedtijd het meest magische moment is.'
    ]
  },
  affirmations: {
    en: [
      'A quiet, gentle story woven entirely from positive affirmations — "you are safe", "you are loved", "you are enough" — repeated like a soft lullaby in a dreamlike world of soft clouds, warm light, and kind friends.',
      'A calming story where every page is a gentle affirmation: brave, kind, curious, gentle, loved, enough — spoken as a bedtime prayer by the moon to all sleeping children.'
    ],
    nl: [
      'Een stil, zacht verhaal dat volledig is geweven uit positieve affirmaties — "je bent veilig", "je bent geliefd", "je bent genoeg" — herhaald als een zachte slaapliedje in een droomwereld vol zachte wolken en warm licht.'
    ]
  },
  ocean: {
    en: [
      'A gentle underwater adventure where a little fish meets a sleepy octopus, a wise sea turtle, and a whale who sings lullabies.',
      'A quiet swim through a coral garden where everyone is getting ready for the ocean to go to sleep.'
    ],
    nl: [
      'Een rustig onderwateravontuur waar een klein visje een slaperige octopus ontmoet, een wijze zeeschildpad en een walvis die slaapliedjes zingt.'
    ]
  },
  garden: {
    en: [
      'A secret garden where flowers glow softly at dusk and friendly bees are humming sleepy tunes as they fly home.',
      'A little girl who finds a hidden garden behind her grandmother\'s house where every plant whispers a kind bedtime wish.'
    ],
    nl: [
      'Een geheime tuin waar bloemen zacht gloeien in de schemering en vriendelijke bijen slaperige wijsjes zoemen op weg naar huis.'
    ]
  },
  farm: {
    en: [
      'A cozy farm at sunset — the cows are settling in, the chickens are tucked in, and a little lamb is being sung to sleep by its mother.',
      'A friendly farm where all the animals — pig, horse, sheep, duck, dog — take turns saying goodnight.'
    ],
    nl: [
      'Een gezellige boerderij bij zonsondergang — de koeien worden rustig, de kippen zijn ingestopt, en een klein lammetje wordt in slaap gezongen door zijn moeder.'
    ]
  }
};

// ---------- Helpers ----------
const $ = (id) => document.getElementById(id);
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function fmtTime(seconds) {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function fmtDate(ts) {
  const d = new Date(ts);
  const now = new Date();
  const diffDays = Math.floor((now - d) / 86400000);
  if (diffDays === 0) return 'Today, ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function toast(msg, type = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => {
    t.style.opacity = '0';
    t.style.transition = 'opacity 0.3s';
    setTimeout(() => t.remove(), 300);
  }, 3000);
}

function escapeHtml(s) {
  return (s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ---------- Worker calls ----------
function getWorkerUrl() {
  return (localStorage.getItem(LS_KEYS.workerUrl) || DEFAULT_WORKER_URL || '').replace(/\/+$/, '');
}

function getPassword() {
  return localStorage.getItem(LS_KEYS.password) || '';
}

async function workerPost(path, body, isFormData = false) {
  const url = getWorkerUrl();
  if (!url) throw new Error('Server not configured — set the Worker URL in Settings');

  const headers = { 'X-App-Password': getPassword() };
  let fetchBody;
  if (isFormData) {
    fetchBody = body;
  } else {
    headers['Content-Type'] = 'application/json';
    fetchBody = JSON.stringify(body);
  }

  return fetch(url + path, { method: 'POST', headers, body: fetchBody });
}

// ---------- Starfield ----------
function makeStars() {
  const container = $('stars');
  const count = window.innerWidth < 500 ? 40 : 70;
  for (let i = 0; i < count; i++) {
    const s = document.createElement('div');
    s.className = 'star-dot';
    s.style.left = Math.random() * 100 + '%';
    s.style.top = Math.random() * 100 + '%';
    s.style.animationDelay = Math.random() * 4 + 's';
    s.style.animationDuration = (3 + Math.random() * 3) + 's';
    if (Math.random() > 0.8) { s.style.width = '3px'; s.style.height = '3px'; }
    container.appendChild(s);
  }
}

// ---------- IndexedDB ----------
let db;
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => { db = req.result; resolve(db); };
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains(STORE_STORIES)) d.createObjectStore(STORE_STORIES, { keyPath: 'id' });
      if (!d.objectStoreNames.contains(STORE_AUDIO)) d.createObjectStore(STORE_AUDIO, { keyPath: 'id' });
    };
  });
}
function dbPut(store, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
function dbGet(store, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function dbGetAll(store) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function dbDelete(store, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------- Auth ----------
async function handleLogin(e) {
  e.preventDefault();
  const pw = $('login-password').value.trim();
  if (!pw) return;

  if (!getWorkerUrl()) {
    localStorage.setItem(LS_KEYS.password, pw);
    toast('Worker URL not set — configure in Settings', 'error');
    enterApp();
    return;
  }

  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    const res = await fetch(getWorkerUrl() + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-App-Password': pw },
      body: '{}'
    });
    if (res.ok) {
      localStorage.setItem(LS_KEYS.password, pw);
      enterApp();
    } else if (res.status === 401) {
      toast('Wrong password', 'error');
      $('login-password').value = '';
    } else {
      const err = await res.text();
      toast('Login failed: ' + err.slice(0, 100), 'error');
    }
  } catch {
    toast('Could not reach the server', 'error');
  } finally {
    btn.disabled = false;
  }
}

function enterApp() {
  $('login-screen').classList.add('hidden');
  $('main-app').classList.remove('hidden');
  $('login-password').value = '';
  loadSettingsIntoForm();
  renderLibrary();
  renderRecents();
  switchScreen('create-screen');
}

function lockApp() {
  $('main-app').classList.add('hidden');
  $('login-screen').classList.remove('hidden');
  const audio = $('audio-el');
  if (audio) audio.pause();
  clearSleepTimer();
}

// ---------- Screens ----------
function switchScreen(id) {
  ['create-screen', 'library-screen', 'settings-screen', 'generating-screen', 'player-screen'].forEach(s => {
    $(s).classList.add('hidden');
  });
  $(id).classList.remove('hidden');

  $$('.nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.screen === id);
  });

  const nav = $('bottom-nav');
  nav.style.display = (id === 'player-screen' || id === 'generating-screen') ? 'none' : '';

  if (id === 'library-screen') renderLibrary();
  if (id === 'create-screen') renderRecents();
}

// ---------- Settings ----------
function loadSettingsIntoForm() {
  $('family-context').value = localStorage.getItem(LS_KEYS.familyContext) || '';
  $('worker-url').value = localStorage.getItem(LS_KEYS.workerUrl) || '';
  if (DEFAULT_WORKER_URL) {
    $('worker-url').placeholder = `Default: ${DEFAULT_WORKER_URL}`;
  }
}

function saveSettings() {
  localStorage.setItem(LS_KEYS.familyContext, $('family-context').value.trim());
  const newUrl = $('worker-url').value.trim().replace(/\/+$/, '');
  if (newUrl) localStorage.setItem(LS_KEYS.workerUrl, newUrl);
  else localStorage.removeItem(LS_KEYS.workerUrl);
  toast('Settings saved', 'success');
}

function wipeDevice() {
  if (!confirm('Delete all stories, audio, and settings from this device? Server settings are not affected.')) return;
  Object.values(LS_KEYS).forEach(k => localStorage.removeItem(k));
  indexedDB.deleteDatabase(DB_NAME);
  setTimeout(() => location.reload(), 300);
}

// ---------- Prompt history ----------
function getPromptHistory() {
  try { return JSON.parse(localStorage.getItem(LS_KEYS.promptHistory) || '[]'); }
  catch { return []; }
}
function savePromptHistory(list) {
  localStorage.setItem(LS_KEYS.promptHistory, JSON.stringify(list.slice(0, 50)));
}
function recordPromptUsage({ recipient, subject }) {
  const history = getPromptHistory();
  const key = normalizePrompt(recipient, subject);
  const existing = history.find(h => h.key === key);
  if (existing) {
    existing.count += 1;
    existing.lastUsed = Date.now();
    existing.recipient = recipient;
    existing.subject = subject;
  } else {
    history.unshift({ key, recipient, subject, count: 1, lastUsed: Date.now() });
  }
  savePromptHistory(history);
}
function normalizePrompt(r, s) {
  return (r + '|' + s).toLowerCase().replace(/\s+/g, ' ').trim();
}

function renderRecents() {
  const field = $('recents-field');
  const strip = $('recents-strip');
  const history = getPromptHistory();
  if (history.length === 0) { field.style.display = 'none'; return; }

  const now = Date.now();
  const scored = history.map(h => ({
    ...h,
    score: h.count * 2 + (1 - Math.min(1, (now - h.lastUsed) / (14 * 86400000)))
  }));
  scored.sort((a, b) => b.score - a.score);

  const top = scored.slice(0, 8);
  field.style.display = '';
  strip.innerHTML = '';

  top.forEach(h => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip' + (h.count >= 3 ? ' popular' : '');
    const preview = h.subject.length > 40 ? h.subject.slice(0, 40) + '…' : h.subject;
    chip.innerHTML = `<span>${escapeHtml(h.recipient)}: ${escapeHtml(preview)}</span>` +
      (h.count > 1 ? `<span class="chip-count">${h.count}×</span>` : '');
    chip.title = `${h.recipient} — ${h.subject}`;
    chip.addEventListener('click', () => {
      $('recipient').value = h.recipient;
      $('subject').value = h.subject;
      $('subject').focus();
    });
    strip.appendChild(chip);
  });
}

// ---------- Story generation ----------
async function generateStoryText({ provider, recipient, subject, targetChars, language }) {
  const familyContext = localStorage.getItem(LS_KEYS.familyContext) || '';
  const res = await workerPost('/api/story', {
    provider, recipient, subject, targetChars, language, familyContext
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Story API failed (${res.status})`);
  }
  const data = await res.json();
  return data.text;
}

async function generateVoiceAudio({ text }) {
  const res = await workerPost('/api/voice', { text });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Voice API failed (${res.status})`);
  }
  return await res.blob();
}

function extractTitle(text, fallback) {
  const firstSentence = text.split(/[.!?\n]/).find(s => s.trim().length > 5) || fallback;
  const words = firstSentence.trim().split(/\s+/).slice(0, 7).join(' ');
  return words.length > 60 ? words.slice(0, 60).trim() + '…' : words;
}

async function runGeneration(params) {
  const { recipient, subject, targetChars, provider, language } = params;

  if (!getWorkerUrl()) {
    toast('Worker URL not set', 'error');
    switchScreen('settings-screen');
    return;
  }

  localStorage.setItem(LS_KEYS.lastLang, language);
  localStorage.setItem(LS_KEYS.lastName, recipient);
  switchScreen('generating-screen');

  try {
    $('generating-text').textContent = language === 'nl' ? 'Een verhaal verzinnen…' : 'Dreaming up a story…';
    $('generating-step').textContent = `${provider === 'openai' ? 'ChatGPT' : 'Claude'} is writing`;

    const storyText = await generateStoryText({ provider, recipient, subject, targetChars, language });
    if (!storyText || storyText.length < 50) throw new Error('Story came back empty or too short');

    $('generating-text').textContent = language === 'nl' ? 'Je stem vinden…' : 'Finding your voice…';
    $('generating-step').textContent = `ElevenLabs is reading ${storyText.length.toLocaleString()} characters`;

    const audioBlob = await generateVoiceAudio({ text: storyText });

    $('generating-text').textContent = language === 'nl' ? 'Instoppen…' : 'Tucking it in…';
    $('generating-step').textContent = 'Saving to your library';

    const id = 'story_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const title = extractTitle(storyText, subject);
    const story = {
      id, recipient, subject, title,
      text: storyText, provider, language,
      chars: storyText.length, createdAt: Date.now()
    };

    await dbPut(STORE_STORIES, story);
    await dbPut(STORE_AUDIO, { id, blob: audioBlob });

    recordPromptUsage({ recipient, subject });

    await sleep(400);
    openStory(story);
    toast('Story ready', 'success');
  } catch (err) {
    console.error(err);
    toast(err.message || 'Something went wrong', 'error');
    switchScreen('create-screen');
  }
}

// ---------- Library (with select mode) ----------
let selectMode = false;
let selectedIds = []; // ordered list — order = play order

async function renderLibrary() {
  const list = $('library-list');
  const toolbar = $('library-toolbar');
  list.innerHTML = '';
  const stories = await dbGetAll(STORE_STORIES);
  stories.sort((a, b) => b.createdAt - a.createdAt);

  // Toolbar state
  toolbar.innerHTML = '';
  if (stories.length > 0) {
    if (selectMode) {
      const info = document.createElement('div');
      info.className = 'selection-info';
      info.innerHTML = selectedIds.length > 0
        ? `<strong>${selectedIds.length}</strong> selected — tap to reorder`
        : 'Tap stories to queue them';
      toolbar.appendChild(info);

      const playBtn = document.createElement('button');
      playBtn.className = 'btn btn-primary';
      playBtn.innerHTML = `<svg viewBox="0 0 20 20" fill="currentColor" style="width:16px;height:16px;"><path d="M5 3.5v13L16 10z"/></svg><span>Play queue</span>`;
      playBtn.disabled = selectedIds.length === 0;
      playBtn.addEventListener('click', playQueue);
      toolbar.appendChild(playBtn);

      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'btn btn-ghost';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', exitSelectMode);
      toolbar.appendChild(cancelBtn);
    } else {
      const selBtn = document.createElement('button');
      selBtn.className = 'btn btn-ghost';
      selBtn.id = 'select-mode-btn';
      selBtn.innerHTML = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="14" height="14" rx="2"/><path d="M7 10l2 2 4-4" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Select multiple</span>`;
      selBtn.addEventListener('click', enterSelectMode);
      toolbar.appendChild(selBtn);
    }
  }

  if (stories.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M52 32a20 20 0 11-20-20 16 16 0 0020 20z" stroke-linejoin="round"/>
        </svg>
        <p>No stories yet.<br>Head to <em>Create</em> and weave the first one.</p>
      </div>`;
    return;
  }

  stories.forEach(story => {
    const card = document.createElement('div');
    card.className = 'story-card';
    const selIndex = selectedIds.indexOf(story.id);
    if (selIndex !== -1) card.classList.add('selected');

    const numBadge = (selectMode && selIndex !== -1)
      ? `<span class="story-select-num">${selIndex + 1}</span>` : '';

    card.innerHTML = `
      <div class="story-card-header">
        <span class="story-recipient">${numBadge}for ${escapeHtml(story.recipient)}</span>
        <span class="story-date">${fmtDate(story.createdAt)}</span>
      </div>
      <div class="story-title">${escapeHtml(story.title)}</div>
      <div class="story-preview">${escapeHtml(story.subject)}</div>
    `;
    card.addEventListener('click', () => {
      if (selectMode) {
        toggleSelected(story.id);
      } else {
        openStory(story);
      }
    });
    list.appendChild(card);
  });
}

function enterSelectMode() {
  selectMode = true;
  selectedIds = [];
  renderLibrary();
}

function exitSelectMode() {
  selectMode = false;
  selectedIds = [];
  renderLibrary();
}

function toggleSelected(id) {
  const idx = selectedIds.indexOf(id);
  if (idx === -1) selectedIds.push(id);
  else selectedIds.splice(idx, 1);
  renderLibrary();
}

async function playQueue() {
  if (selectedIds.length === 0) return;
  // Load all selected stories
  const queue = [];
  for (const id of selectedIds) {
    const story = await dbGet(STORE_STORIES, id);
    if (story) queue.push(story);
  }
  if (queue.length === 0) { toast('Could not load queue', 'error'); return; }

  currentQueue = queue;
  currentQueueIndex = 0;
  exitSelectMode();
  openStory(queue[0]);
  // Auto-start playback
  setTimeout(() => {
    const audio = $('audio-el');
    if (audio) audio.play().catch(() => {});
  }, 500);
}

// ---------- Player ----------
let currentStory = null;
let currentAudioUrl = null;
let currentQueue = [];      // list of stories currently queued
let currentQueueIndex = 0;  // index into currentQueue
let loopMode = false;
let sleepTimerId = null;
let sleepTimerExpiresAt = 0;
let sleepTimerDisplayInterval = null;

async function openStory(story, opts = {}) {
  currentStory = story;
  // If we're opening a single story (not from queue), reset the queue
  if (!opts.fromQueue) {
    currentQueue = [story];
    currentQueueIndex = 0;
  }
  updateQueueInfo();

  $('player-recipient').textContent = `for ${story.recipient}`;
  $('player-title').textContent = story.title;
  $('story-text').textContent = story.text;

  const audioRec = await dbGet(STORE_AUDIO, story.id);
  const audio = $('audio-el');

  if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);

  if (audioRec && audioRec.blob) {
    currentAudioUrl = URL.createObjectURL(audioRec.blob);
    audio.src = currentAudioUrl;
    audio.load();
  } else {
    toast('Audio missing — you can still read the text', 'error');
  }

  buildWaveform();
  updatePrevNextButtons();
  switchScreen('player-screen');
}

function updateQueueInfo() {
  const info = $('queue-info');
  if (currentQueue.length > 1) {
    info.classList.remove('hidden');
    $('queue-info-text').textContent = `Story ${currentQueueIndex + 1} of ${currentQueue.length}`;
  } else {
    info.classList.add('hidden');
  }
}

function updatePrevNextButtons() {
  const prev = $('prev-btn');
  const next = $('next-btn');
  prev.classList.toggle('disabled', currentQueueIndex === 0);
  next.classList.toggle('disabled', currentQueueIndex >= currentQueue.length - 1);
}

function buildWaveform() {
  const wf = $('waveform');
  wf.innerHTML = '';
  const n = 48;
  for (let i = 0; i < n; i++) {
    const bar = document.createElement('div');
    bar.className = 'bar';
    const h = 10 + Math.abs(Math.sin(i * 0.4)) * 24 + Math.random() * 10;
    bar.style.height = h + 'px';
    wf.appendChild(bar);
  }
}

function updateWaveformPlayhead(ratio) {
  const bars = $$('.bar', $('waveform'));
  const idx = Math.floor(ratio * bars.length);
  bars.forEach((b, i) => { b.classList.toggle('active', i <= idx); });
}

async function playNextInQueue() {
  if (currentQueueIndex < currentQueue.length - 1) {
    currentQueueIndex++;
    await openStory(currentQueue[currentQueueIndex], { fromQueue: true });
    setTimeout(() => $('audio-el').play().catch(() => {}), 300);
  }
}

async function playPrevInQueue() {
  if (currentQueueIndex > 0) {
    currentQueueIndex--;
    await openStory(currentQueue[currentQueueIndex], { fromQueue: true });
    setTimeout(() => $('audio-el').play().catch(() => {}), 300);
  }
}

function wirePlayer() {
  const audio = $('audio-el');
  const playBtn = $('play-btn');
  const playIcon = $('play-icon');
  const pauseIcon = $('pause-icon');
  const progFill = $('progress-fill');
  const track = $('progress-track');

  playBtn.addEventListener('click', () => {
    if (audio.paused) audio.play(); else audio.pause();
  });

  audio.addEventListener('play', () => {
    playIcon.classList.add('hidden');
    pauseIcon.classList.remove('hidden');
    $$('.bar', $('waveform')).forEach(b => b.classList.add('playing'));
  });

  audio.addEventListener('pause', () => {
    playIcon.classList.remove('hidden');
    pauseIcon.classList.add('hidden');
    $$('.bar', $('waveform')).forEach(b => b.classList.remove('playing'));
  });

  audio.addEventListener('ended', async () => {
    playIcon.classList.remove('hidden');
    pauseIcon.classList.add('hidden');
    $$('.bar', $('waveform')).forEach(b => b.classList.remove('playing'));

    // Loop mode — replay current story
    if (loopMode) {
      audio.currentTime = 0;
      audio.play().catch(() => {});
      return;
    }

    // Queue mode — advance to next
    if (currentQueueIndex < currentQueue.length - 1) {
      await playNextInQueue();
    }
  });

  audio.addEventListener('loadedmetadata', () => {
    $('total-time').textContent = fmtTime(audio.duration);
  });

  audio.addEventListener('timeupdate', () => {
    const ratio = audio.duration ? audio.currentTime / audio.duration : 0;
    progFill.style.width = (ratio * 100) + '%';
    $('current-time').textContent = fmtTime(audio.currentTime);
    updateWaveformPlayhead(ratio);
  });

  track.addEventListener('click', (e) => {
    if (!audio.duration) return;
    const rect = track.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    audio.currentTime = ratio * audio.duration;
  });

  $('rewind-btn').addEventListener('click', () => {
    audio.currentTime = Math.max(0, audio.currentTime - 15);
  });
  $('forward-btn').addEventListener('click', () => {
    audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 15);
  });
  $('prev-btn').addEventListener('click', playPrevInQueue);
  $('next-btn').addEventListener('click', playNextInQueue);

  $('back-from-player').addEventListener('click', () => {
    audio.pause();
    clearSleepTimer();
    switchScreen('library-screen');
  });

  $('download-btn').addEventListener('click', async () => {
    if (!currentStory) return;
    const rec = await dbGet(STORE_AUDIO, currentStory.id);
    if (!rec) { toast('No audio to download', 'error'); return; }
    const url = URL.createObjectURL(rec.blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = currentStory.title.replace(/[^a-z0-9]+/gi, '_').slice(0, 40);
    a.download = `sleepstory_${currentStory.recipient}_${safeName}.mp3`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  $('delete-btn').addEventListener('click', async () => {
    if (!currentStory) return;
    if (!confirm(`Delete "${currentStory.title}"?`)) return;
    audio.pause();
    await dbDelete(STORE_STORIES, currentStory.id);
    await dbDelete(STORE_AUDIO, currentStory.id);
    if (currentAudioUrl) { URL.revokeObjectURL(currentAudioUrl); currentAudioUrl = null; }
    currentStory = null;
    switchScreen('library-screen');
    toast('Deleted', 'success');
  });

  // Loop toggle
  $('loop-btn').addEventListener('click', () => {
    loopMode = !loopMode;
    $('loop-btn').classList.toggle('active', loopMode);
    toast(loopMode ? 'Loop on — story will repeat' : 'Loop off', 'success');
  });

  // Sleep timer button opens modal
  $('sleep-timer-btn').addEventListener('click', openSleepModal);
}

// ---------- Sleep timer ----------
function openSleepModal() {
  const modal = $('sleep-modal');
  modal.classList.remove('hidden');
  $('sleep-custom').value = '';
}
function closeSleepModal() {
  $('sleep-modal').classList.add('hidden');
}

function setSleepTimer(minutes) {
  clearSleepTimer();
  if (minutes <= 0) return;

  const durationMs = minutes * 60 * 1000;
  sleepTimerExpiresAt = Date.now() + durationMs;

  sleepTimerId = setTimeout(() => {
    // Fade audio out over the last 5 seconds, then pause
    const audio = $('audio-el');
    fadeOutAndPause(audio, 3000);
    clearSleepTimer();
    toast('Sleep timer — story paused. Sweet dreams.', 'success');
  }, durationMs);

  // Update button label with remaining time
  updateSleepTimerLabel();
  sleepTimerDisplayInterval = setInterval(updateSleepTimerLabel, 30000); // update every 30s

  $('sleep-timer-btn').classList.add('active');
  toast(`Sleep timer set for ${minutes} min`, 'success');
}

function clearSleepTimer() {
  if (sleepTimerId) clearTimeout(sleepTimerId);
  if (sleepTimerDisplayInterval) clearInterval(sleepTimerDisplayInterval);
  sleepTimerId = null;
  sleepTimerExpiresAt = 0;
  sleepTimerDisplayInterval = null;
  $('sleep-timer-btn').classList.remove('active');
  $('sleep-timer-label').textContent = 'Timer';
}

function updateSleepTimerLabel() {
  if (!sleepTimerExpiresAt) return;
  const remainingMs = sleepTimerExpiresAt - Date.now();
  if (remainingMs <= 0) return;
  const mins = Math.ceil(remainingMs / 60000);
  $('sleep-timer-label').textContent = `${mins} min`;
}

function fadeOutAndPause(audio, durationMs) {
  if (!audio || audio.paused) return;
  const startVol = audio.volume;
  const steps = 30;
  const interval = durationMs / steps;
  let i = 0;
  const fade = setInterval(() => {
    i++;
    audio.volume = Math.max(0, startVol * (1 - i / steps));
    if (i >= steps) {
      clearInterval(fade);
      audio.pause();
      audio.volume = startVol; // reset for next play
    }
  }, interval);
}

function wireSleepModal() {
  $$('#sleep-options .modal-option').forEach(b => {
    b.addEventListener('click', () => {
      const mins = parseInt(b.dataset.mins, 10);
      setSleepTimer(mins);
      closeSleepModal();
    });
  });
  $('sleep-custom-set').addEventListener('click', () => {
    const mins = parseInt($('sleep-custom').value, 10);
    if (isNaN(mins) || mins < 1 || mins > 180) {
      toast('Enter a number between 1 and 180', 'error');
      return;
    }
    setSleepTimer(mins);
    closeSleepModal();
  });
  $('sleep-cancel').addEventListener('click', closeSleepModal);
  $('sleep-clear').addEventListener('click', () => {
    clearSleepTimer();
    closeSleepModal();
    toast('Sleep timer off', 'success');
  });
}

// ---------- Voice input ----------
let mediaRecorder = null;
let audioChunks = [];
let recordStartTime = 0;
let recordTimerInterval = null;

async function startRecording() {
  if (!getWorkerUrl()) { toast('Worker URL not set', 'error'); return; }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    let mimeType = '';
    for (const m of ['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/mpeg','audio/ogg']) {
      if (MediaRecorder.isTypeSupported(m)) { mimeType = m; break; }
    }
    mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    audioChunks = [];

    mediaRecorder.addEventListener('dataavailable', (e) => {
      if (e.data && e.data.size > 0) audioChunks.push(e.data);
    });

    mediaRecorder.addEventListener('stop', async () => {
      stream.getTracks().forEach(t => t.stop());
      clearInterval(recordTimerInterval);
      const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
      if (blob.size < 500) {
        setMicStatus('Nothing recorded. Hold longer next time.', false);
        setMicState('idle');
        return;
      }
      await transcribeBlob(blob);
    });

    mediaRecorder.start();
    recordStartTime = Date.now();
    setMicState('recording');

    recordTimerInterval = setInterval(() => {
      const secs = Math.floor((Date.now() - recordStartTime) / 1000);
      setMicStatus(`Recording… ${secs}s — tap mic to stop`, true);
      if (secs >= 90) stopRecording();
    }, 500);

    setMicStatus('Recording… 0s — tap mic to stop', true);
  } catch (err) {
    if (err.name === 'NotAllowedError') toast('Microphone access denied. Enable it in iOS Settings → Safari.', 'error');
    else toast('Could not start recording: ' + err.message, 'error');
    setMicState('idle');
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
    setMicState('transcribing');
    setMicStatus('Transcribing…', true);
  }
}

async function transcribeBlob(blob) {
  const lang = $$('.lang-option.active')[0]?.dataset.lang || 'en';
  try {
    const ext = (blob.type.includes('mp4') ? 'mp4' : blob.type.includes('mpeg') ? 'mp3' : blob.type.includes('ogg') ? 'ogg' : 'webm');
    const form = new FormData();
    form.append('file', blob, `recording.${ext}`);
    form.append('language', lang);

    const res = await workerPost('/api/transcribe', form, true);
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Transcribe ${res.status}: ${errText.slice(0, 150)}`);
    }

    const data = await res.json();
    const text = (data.text || '').trim();
    if (!text) { setMicStatus('No speech detected', false); setMicState('idle'); return; }

    const subjectEl = $('subject');
    subjectEl.value = subjectEl.value.trim() ? subjectEl.value.trim() + ' ' + text : text;
    subjectEl.focus();
    subjectEl.setSelectionRange(subjectEl.value.length, subjectEl.value.length);
    setMicStatus('', false);
    setMicState('idle');
    toast('Transcribed', 'success');
  } catch (err) {
    setMicStatus('Transcription failed — try again', false);
    setMicState('idle');
    toast(err.message || 'Transcription failed', 'error');
  }
}

function setMicState(state) {
  const btn = $('mic-btn');
  const idleIcon = $('mic-icon-idle');
  const recIcon = $('mic-icon-rec');
  btn.classList.remove('recording', 'transcribing');
  if (state === 'recording') {
    btn.classList.add('recording');
    idleIcon.classList.add('hidden');
    recIcon.classList.remove('hidden');
  } else if (state === 'transcribing') {
    btn.classList.add('transcribing');
    idleIcon.classList.remove('hidden');
    recIcon.classList.add('hidden');
  } else {
    idleIcon.classList.remove('hidden');
    recIcon.classList.add('hidden');
  }
}

function setMicStatus(text, active) {
  $('mic-status').textContent = text;
  $('mic-status').classList.toggle('active', !!active);
}

function wireMicButton() {
  const btn = $('mic-btn');
  if (!btn) return;
  if (!navigator.mediaDevices || !window.MediaRecorder) { btn.style.display = 'none'; return; }
  btn.addEventListener('click', () => {
    if (btn.classList.contains('recording')) stopRecording();
    else if (btn.classList.contains('transcribing')) return;
    else startRecording();
  });
}

// ---------- Create form ----------
function wireCreateForm() {
  // Length pills
  $$('#length-pills .pill').forEach(p => {
    p.addEventListener('click', () => {
      $$('#length-pills .pill').forEach(x => x.classList.remove('active'));
      p.classList.add('active');
    });
  });

  // Provider toggle
  $$('.provider-option').forEach(b => {
    b.addEventListener('click', () => {
      $$('.provider-option').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
    });
  });

  // Language toggle
  const savedLang = localStorage.getItem(LS_KEYS.lastLang) || 'en';
  $$('.lang-option').forEach(b => {
    b.classList.toggle('active', b.dataset.lang === savedLang);
    b.addEventListener('click', () => {
      $$('.lang-option').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
    });
  });

  // Name chips
  $$('#name-chips .chip').forEach(c => {
    c.addEventListener('click', () => {
      const n = c.dataset.name;
      $$('#name-chips .chip').forEach(x => x.classList.remove('active'));
      c.classList.add('active');
      if (n === '__other__') {
        $('recipient').value = '';
        $('recipient').focus();
      } else {
        $('recipient').value = n;
      }
    });
  });
  // Pre-select last used name if applicable
  const lastName = localStorage.getItem(LS_KEYS.lastName);
  if (lastName) {
    const match = $$('#name-chips .chip').find(c => c.dataset.name === lastName);
    if (match) { match.classList.add('active'); $('recipient').value = lastName; }
  }

  // Theme chips
  $$('#theme-chips .chip').forEach(c => {
    c.addEventListener('click', () => {
      const theme = c.dataset.theme;
      const lang = $$('.lang-option.active')[0]?.dataset.lang || 'en';
      const pool = THEMES[theme]?.[lang] || THEMES[theme]?.en || [];
      if (pool.length === 0) return;
      const pick = randomFrom(pool);
      $('subject').value = pick;

      // Visual feedback
      $$('#theme-chips .chip').forEach(x => x.classList.remove('active'));
      c.classList.add('active');
      setTimeout(() => c.classList.remove('active'), 1200);
    });
  });

  $('create-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const recipient = $('recipient').value.trim();
    const subject = $('subject').value.trim();
    const targetChars = parseInt($$('#length-pills .pill.active')[0].dataset.chars, 10);
    const provider = $$('.provider-option.active')[0].dataset.provider;
    const language = $$('.lang-option.active')[0].dataset.lang;
    if (!recipient) { toast('Please enter a name — who is the story for?', 'error'); $('recipient').focus(); return; }
    if (!subject) { toast('Please enter what the story is about — or pick a theme', 'error'); $('subject').focus(); return; }
    runGeneration({ recipient, subject, targetChars, provider, language });
  });
}

// ---------- Init ----------
async function init() {
  makeStars();
  await openDB();

  // Try auto-login
  const storedPw = getPassword();
  const url = getWorkerUrl();
  if (storedPw && url) {
    try {
      const res = await fetch(url + '/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-App-Password': storedPw },
        body: '{}'
      });
      if (res.ok) enterApp();
    } catch {}
  }

  $('login-form').addEventListener('submit', handleLogin);
  $('lock-btn').addEventListener('click', lockApp);

  $$('.nav-btn').forEach(b => {
    b.addEventListener('click', () => switchScreen(b.dataset.screen));
  });

  $('save-settings').addEventListener('click', saveSettings);
  $('wipe-btn').addEventListener('click', wipeDevice);

  wireCreateForm();
  wireMicButton();
  wirePlayer();
  wireSleepModal();
}

document.addEventListener('DOMContentLoaded', init);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

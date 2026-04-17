/* =====================================================
   Lullaby — Bedtime Stories PWA
   All data stays on-device. Keys never leave the phone
   except to call the APIs directly.
   ===================================================== */

// ---------- Constants ----------
const LS_KEYS = {
  passwordHash: 'll_pw_hash',
  elevenKey: 'll_el_key',
  elevenVoice: 'll_el_voice',
  elevenModel: 'll_el_model',
  openaiKey: 'll_oa_key',
  openaiModel: 'll_oa_model',
  anthropicKey: 'll_an_key',
  defaultLength: 'll_len',
  defaultProvider: 'll_provider'
};

const DB_NAME = 'lullaby_db';
const DB_VERSION = 1;
const STORE_STORIES = 'stories';
const STORE_AUDIO = 'audio_blobs';

// ---------- Tiny helpers ----------
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

async function sha256(text) {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
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
    if (Math.random() > 0.8) {
      s.style.width = '3px';
      s.style.height = '3px';
    }
    container.appendChild(s);
  }
}

// ---------- IndexedDB for audio blobs ----------
let db;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => { db = req.result; resolve(db); };
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains(STORE_STORIES)) {
        d.createObjectStore(STORE_STORIES, { keyPath: 'id' });
      }
      if (!d.objectStoreNames.contains(STORE_AUDIO)) {
        d.createObjectStore(STORE_AUDIO, { keyPath: 'id' });
      }
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

// ---------- AUTH ----------
async function handleLogin(e) {
  e.preventDefault();
  const pw = $('login-password').value.trim();
  if (!pw) return;

  const existing = localStorage.getItem(LS_KEYS.passwordHash);
  const hash = await sha256(pw);

  if (!existing) {
    // First time — set this as the password
    localStorage.setItem(LS_KEYS.passwordHash, hash);
    toast('Password set. Welcome.', 'success');
    enterApp();
  } else if (existing === hash) {
    enterApp();
  } else {
    toast('Wrong password', 'error');
    $('login-password').value = '';
  }
}

function enterApp() {
  $('login-screen').classList.add('hidden');
  $('main-app').classList.remove('hidden');
  $('login-password').value = '';
  loadSettingsIntoForm();
  renderLibrary();
  // Put user on Create by default
  switchScreen('create-screen');
}

function lockApp() {
  $('main-app').classList.add('hidden');
  $('login-screen').classList.remove('hidden');
  // Stop any playing audio
  const audio = $('audio-el');
  if (audio) { audio.pause(); }
}

// ---------- SCREEN NAV ----------
function switchScreen(id) {
  ['create-screen', 'library-screen', 'settings-screen', 'generating-screen', 'player-screen'].forEach(s => {
    $(s).classList.add('hidden');
  });
  $(id).classList.remove('hidden');

  // Update nav highlights (only for main 3 screens)
  $$('.nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.screen === id);
  });

  // Hide bottom nav on player
  const nav = $('bottom-nav');
  if (id === 'player-screen' || id === 'generating-screen') {
    nav.style.display = 'none';
  } else {
    nav.style.display = '';
  }

  // Refresh library when entering
  if (id === 'library-screen') renderLibrary();
}

// ---------- SETTINGS ----------
function loadSettingsIntoForm() {
  $('el-key').value = localStorage.getItem(LS_KEYS.elevenKey) || '';
  $('el-voice').value = localStorage.getItem(LS_KEYS.elevenVoice) || '';
  $('el-model').value = localStorage.getItem(LS_KEYS.elevenModel) || 'eleven_multilingual_v2';
  $('oa-key').value = localStorage.getItem(LS_KEYS.openaiKey) || '';
  $('oa-model').value = localStorage.getItem(LS_KEYS.openaiModel) || 'gpt-4o';
  $('an-key').value = localStorage.getItem(LS_KEYS.anthropicKey) || '';
}

async function saveSettings() {
  localStorage.setItem(LS_KEYS.elevenKey, $('el-key').value.trim());
  localStorage.setItem(LS_KEYS.elevenVoice, $('el-voice').value.trim());
  localStorage.setItem(LS_KEYS.elevenModel, $('el-model').value);
  localStorage.setItem(LS_KEYS.openaiKey, $('oa-key').value.trim());
  localStorage.setItem(LS_KEYS.openaiModel, $('oa-model').value);
  localStorage.setItem(LS_KEYS.anthropicKey, $('an-key').value.trim());

  const newPw = $('new-password').value.trim();
  if (newPw) {
    const h = await sha256(newPw);
    localStorage.setItem(LS_KEYS.passwordHash, h);
    $('new-password').value = '';
  }
  toast('Settings saved', 'success');
}

function wipeEverything() {
  if (!confirm('Delete all stories, audio, settings, and password from this device? This cannot be undone.')) return;
  Object.values(LS_KEYS).forEach(k => localStorage.removeItem(k));
  indexedDB.deleteDatabase(DB_NAME);
  setTimeout(() => location.reload(), 300);
}

// ---------- STORY GENERATION ----------

function buildStoryPrompt({ recipient, subject, targetChars }) {
  return `You are writing a calming, original bedtime story for a child named ${recipient}.

The story should be about: ${subject}

Length: Approximately ${targetChars} characters (this is important — please aim as close to this as possible without padding).

Guidelines:
- Write in warm, soothing, storybook prose — the kind that can be read aloud at bedtime.
- Use gentle rhythm and soft imagery. Slow the pace toward the end.
- Mention ${recipient} by name naturally a few times so it feels personal.
- End on a quiet, peaceful note that gently invites sleep (soft fade, drifting off, stars, warmth).
- No scary or stressful content, no cliffhangers, no dialogue-heavy action.
- Write ONLY the story itself — no title, no preamble like "Here is a story", no meta commentary. Just the story text, flowing as continuous prose.`;
}

async function generateStoryTextOpenAI({ apiKey, model, recipient, subject, targetChars }) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'You are a gentle, skilled children\'s bedtime story writer.' },
        { role: 'user', content: buildStoryPrompt({ recipient, subject, targetChars }) }
      ],
      temperature: 0.85,
      max_tokens: Math.min(Math.ceil(targetChars / 2.5), 8000)
    })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI error: ${res.status} — ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.choices[0].message.content.trim();
}

async function generateStoryTextAnthropic({ apiKey, recipient, subject, targetChars }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: Math.min(Math.ceil(targetChars / 2.5), 8000),
      messages: [
        { role: 'user', content: buildStoryPrompt({ recipient, subject, targetChars }) }
      ]
    })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic error: ${res.status} — ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.content[0].text.trim();
}

async function generateVoiceAudio({ apiKey, voiceId, model, text }) {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Accept': 'audio/mpeg',
      'Content-Type': 'application/json',
      'xi-api-key': apiKey
    },
    body: JSON.stringify({
      text,
      model_id: model,
      voice_settings: {
        stability: 0.6,
        similarity_boost: 0.75,
        style: 0.2,
        use_speaker_boost: true
      }
    })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`ElevenLabs error: ${res.status} — ${err.slice(0, 200)}`);
  }
  return await res.blob();
}

function extractTitle(text, fallback) {
  // Pick the first vivid phrase as a title, max ~7 words
  const firstSentence = text.split(/[.!?\n]/).find(s => s.trim().length > 5) || fallback;
  const words = firstSentence.trim().split(/\s+/).slice(0, 7).join(' ');
  return words.length > 60 ? words.slice(0, 60).trim() + '…' : words;
}

async function runGeneration(params) {
  const { recipient, subject, targetChars, provider } = params;

  // Validate keys
  const elKey = localStorage.getItem(LS_KEYS.elevenKey);
  const voiceId = localStorage.getItem(LS_KEYS.elevenVoice);
  const elModel = localStorage.getItem(LS_KEYS.elevenModel) || 'eleven_multilingual_v2';
  if (!elKey || !voiceId) {
    toast('Please set your ElevenLabs key and voice ID in Settings', 'error');
    switchScreen('settings-screen');
    return;
  }

  let writerKey, writerModel;
  if (provider === 'openai') {
    writerKey = localStorage.getItem(LS_KEYS.openaiKey);
    writerModel = localStorage.getItem(LS_KEYS.openaiModel) || 'gpt-4o';
    if (!writerKey) {
      toast('Please add your OpenAI API key in Settings', 'error');
      switchScreen('settings-screen');
      return;
    }
  } else {
    writerKey = localStorage.getItem(LS_KEYS.anthropicKey);
    if (!writerKey) {
      toast('Please add your Anthropic API key in Settings (or use ChatGPT)', 'error');
      switchScreen('settings-screen');
      return;
    }
  }

  switchScreen('generating-screen');

  try {
    // STEP 1 — write the story
    $('generating-text').textContent = 'Dreaming up a story…';
    $('generating-step').textContent = `${provider === 'openai' ? 'ChatGPT' : 'Claude'} is writing`;

    const storyText = provider === 'openai'
      ? await generateStoryTextOpenAI({ apiKey: writerKey, model: writerModel, recipient, subject, targetChars })
      : await generateStoryTextAnthropic({ apiKey: writerKey, recipient, subject, targetChars });

    // STEP 2 — narrate
    $('generating-text').textContent = 'Finding your voice…';
    $('generating-step').textContent = `ElevenLabs is reading ${storyText.length.toLocaleString()} characters`;

    const audioBlob = await generateVoiceAudio({
      apiKey: elKey,
      voiceId,
      model: elModel,
      text: storyText
    });

    // STEP 3 — save
    $('generating-text').textContent = 'Tucking it in…';
    $('generating-step').textContent = 'Saving to your library';

    const id = 'story_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const title = extractTitle(storyText, subject);
    const story = {
      id,
      recipient,
      subject,
      title,
      text: storyText,
      provider,
      chars: storyText.length,
      createdAt: Date.now()
    };

    await dbPut(STORE_STORIES, story);
    await dbPut(STORE_AUDIO, { id, blob: audioBlob });

    await sleep(400);
    openStory(story);
    toast('Story ready', 'success');
  } catch (err) {
    console.error(err);
    toast(err.message || 'Something went wrong', 'error');
    switchScreen('create-screen');
  }
}

// ---------- LIBRARY ----------
async function renderLibrary() {
  const list = $('library-list');
  list.innerHTML = '';
  const stories = await dbGetAll(STORE_STORIES);
  stories.sort((a, b) => b.createdAt - a.createdAt);

  if (stories.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M52 32a20 20 0 11-20-20 16 16 0 0020 20z" stroke-linejoin="round"/>
          <circle cx="20" cy="14" r="1" fill="currentColor"/>
          <circle cx="48" cy="50" r="1" fill="currentColor"/>
          <circle cx="12" cy="44" r="1" fill="currentColor"/>
        </svg>
        <p>No stories yet.<br>Head to <em>Create</em> and weave the first one.</p>
      </div>`;
    return;
  }

  stories.forEach(story => {
    const card = document.createElement('div');
    card.className = 'story-card';
    card.innerHTML = `
      <div class="story-card-header">
        <span class="story-recipient">for ${escapeHtml(story.recipient)}</span>
        <span class="story-date">${fmtDate(story.createdAt)}</span>
      </div>
      <div class="story-title">${escapeHtml(story.title)}</div>
      <div class="story-preview">${escapeHtml(story.subject)}</div>
    `;
    card.addEventListener('click', () => openStory(story));
    list.appendChild(card);
  });
}

function escapeHtml(s) {
  return (s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// ---------- PLAYER ----------
let currentStory = null;
let currentAudioUrl = null;

async function openStory(story) {
  currentStory = story;
  $('player-recipient').textContent = `for ${story.recipient}`;
  $('player-title').textContent = story.title;
  $('story-text').textContent = story.text;

  // Load audio
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
  switchScreen('player-screen');
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
  bars.forEach((b, i) => {
    b.classList.toggle('active', i <= idx);
  });
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

  audio.addEventListener('ended', () => {
    playIcon.classList.remove('hidden');
    pauseIcon.classList.add('hidden');
    $$('.bar', $('waveform')).forEach(b => b.classList.remove('playing'));
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

  $('back-from-player').addEventListener('click', () => {
    audio.pause();
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
    a.download = `lullaby_${currentStory.recipient}_${safeName}.mp3`;
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
}

// ---------- CREATE FORM ----------
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

  $('create-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const recipient = $('recipient').value.trim();
    const subject = $('subject').value.trim();
    const targetChars = parseInt($$('#length-pills .pill.active')[0].dataset.chars, 10);
    const provider = $$('.provider-option.active')[0].dataset.provider;
    if (!recipient || !subject) return;
    runGeneration({ recipient, subject, targetChars, provider });
  });
}

// ---------- INIT ----------
async function init() {
  makeStars();
  await openDB();

  // Show first-time hint if no password yet
  if (!localStorage.getItem(LS_KEYS.passwordHash)) {
    $('first-time-hint').style.display = '';
  } else {
    $('first-time-hint').style.display = 'none';
  }

  // Wire login
  $('login-form').addEventListener('submit', handleLogin);
  $('lock-btn').addEventListener('click', lockApp);

  // Wire nav
  $$('.nav-btn').forEach(b => {
    b.addEventListener('click', () => switchScreen(b.dataset.screen));
  });

  // Wire settings
  $('save-settings').addEventListener('click', saveSettings);
  $('wipe-btn').addEventListener('click', wipeEverything);
  $$('.key-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = $(btn.dataset.target);
      input.type = input.type === 'password' ? 'text' : 'password';
    });
  });

  wireCreateForm();
  wirePlayer();
}

document.addEventListener('DOMContentLoaded', init);

// Register service worker for offline support
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {
      // Silently fail — not critical
    });
  });
}

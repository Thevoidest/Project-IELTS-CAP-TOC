// ════════════════════════════════════════════
// SRS — SM-2 simplified
// ════════════════════════════════════════════
const SRS_KEY = 'blitz_srs_v2'; // v2: keys are scoped as "sessionId::word"

function loadSRS() {
  try { return JSON.parse(localStorage.getItem(SRS_KEY)) || {}; } catch { return {}; }
}
function saveSRS(data) {
  try { localStorage.setItem(SRS_KEY, JSON.stringify(data)); } catch {}
}

// Migrate v1 (plain word keys) → v2 (sessionId::word keys)
function migrateSRSv1() {
  try {
    const old = JSON.parse(localStorage.getItem('blitz_srs_v1') || '{}');
    if (Object.keys(old).length === 0) return;
    // Build reverse index: word → [sessionIds]
    const wordToSessions = {};
    Object.entries(VOCAB_DATA.cambridge || {}).forEach(([vol, tests]) => {
      Object.entries(tests).forEach(([t, data]) => {
        if (typeof data !== 'object') return;
        const sid = `c${vol}t${t}`;
        Object.keys(data).forEach(w => {
          if (!wordToSessions[w]) wordToSessions[w] = [];
          wordToSessions[w].push(sid);
        });
      });
    });
    Object.entries(VOCAB_DATA.road || {}).forEach(([vol, data]) => {
      const sid = `road${vol}`;
      Object.keys(data).forEach(w => {
        if (!wordToSessions[w]) wordToSessions[w] = [];
        wordToSessions[w].push(sid);
      });
    });
    // Copy each v1 record to all matching sessions in v2
    const newDb = JSON.parse(localStorage.getItem(SRS_KEY) || '{}');
    Object.entries(old).forEach(([word, rec]) => {
      (wordToSessions[word] || []).forEach(sid => {
        const key = `${sid}::${word}`;
        if (!newDb[key] || rec.reps >= newDb[key].reps) newDb[key] = rec;
      });
    });
    saveSRS(newDb);
    localStorage.removeItem('blitz_srs_v1');
    console.log(`SRS migrated: ${Object.keys(old).length} v1 records → v2`);
  } catch(e) { console.warn('SRS migration failed', e); }
}

function updateSRSWord(sessionId, word, correct) {
  const db = loadSRS();
  const now = Date.now();
  const key = `${sessionId}::${word}`;
  const rec = db[key] || { interval: 1, ease: 2.5, reps: 0, nextReview: now };

  if (correct) {
    rec.reps++;
    if (rec.reps === 1)      rec.interval = 1;
    else if (rec.reps === 2) rec.interval = 6;
    else                     rec.interval = Math.round(rec.interval * rec.ease);
    rec.ease = Math.max(1.3, rec.ease + 0.1);
  } else {
    rec.reps = 0;
    rec.interval = 1;
    rec.ease = Math.max(1.3, rec.ease - 0.2);
  }
  rec.nextReview = now + rec.interval * 86400000;
  db[key] = rec;
  saveSRS(db);
}

function getWordStatus(sessionId, word) {
  const db = loadSRS();
  const rec = db[`${sessionId}::${word}`];
  if (!rec) return 'new';
  if (rec.nextReview <= Date.now()) return 'due';
  return 'ok';
}

function countDue(sessionId, words) {
  return words.filter(w => getWordStatus(sessionId, w) === 'due').length;
}

// ════════════════════════════════════════════
// SOUND — Web Audio API (no files needed)
// ════════════════════════════════════════════
let audioCtx = null;
function getAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function playCorrect() {
  try {
    const ctx = getAudio();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, t);
    osc.frequency.exponentialRampToValueAtTime(1200, t + 0.08);
    gain.gain.setValueAtTime(0.18, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    osc.start(t); osc.stop(t + 0.25);
  } catch {}
}

function speakWordUK(word) {
  try {
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(word);
    utt.lang = 'en-GB';
    utt.rate = 0.85;
    utt.pitch = 1;
    // Try to pick a UK voice explicitly
    const voices = window.speechSynthesis.getVoices();
    const ukVoice = voices.find(v =>
      v.lang === 'en-GB' && (v.name.includes('Daniel') || v.name.includes('Kate') || v.name.includes('Google UK'))
    ) || voices.find(v => v.lang === 'en-GB');
    if (ukVoice) utt.voice = ukVoice;
    window.speechSynthesis.speak(utt);
  } catch {}
}

// Voices load async on some browsers — preload
if (window.speechSynthesis) {
  window.speechSynthesis.getVoices();
  window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
}

// ════════════════════════════════════════════
// STATE
// ════════════════════════════════════════════
// ════════════════════════════════════════════
// AUDIO SETTINGS
// ════════════════════════════════════════════
const MUTE_KEY = 'blitz_mute';
function isMuted() { return localStorage.getItem(MUTE_KEY) === '1'; }
function setMute(val) {
  localStorage.setItem(MUTE_KEY, val ? '1' : '0');
  updateMuteUI();
}
function updateMuteUI() {
  const muted = isMuted();
  document.querySelectorAll('.mute-toggle').forEach(btn => {
    btn.textContent = muted ? '🔇' : '🔊';
    btn.title = muted ? 'Bật âm thanh' : 'Tắt âm thanh';
    btn.classList.toggle('muted', muted);
  });
}
// speakWord — defined after speakWordUK, respects mute
function speakWord(word) {
  if (!isMuted()) speakWordUK(word);
}

let S = {
  bookKey: 'cambridge',
  sessionId: null,
  sessionMode: 'post',  // 'pre' | 'post'
  sectionFilter: 'all', // 'all' | 'reading' | 'listening'
  words: [],
  queue: [],
  queuePos: 0,
  correct: 0,
  wrong: 0,
  wrongWords: [],
  isRetry: false,
  advanceTimer: null,
};

// ════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length-1; i>0; i--) {
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]] = [a[j],a[i]];
  }
  return a;
}
function pick(arr, n) { return shuffle(arr).slice(0, n); }
function guestId() {
  let g = localStorage.getItem('blitz_guest');
  if (!g) { g = 'g' + Math.random().toString(36).slice(2,8); localStorage.setItem('blitz_guest', g); }
  return g;
}
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ════════════════════════════════════════════
// VOCABSAVE — export / import SRS data
// ════════════════════════════════════════════
function vocabSaveExport() {
  const data = {
    _version: 1,
    _exported: new Date().toISOString(),
    srs: loadSRS(),
  };
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'VocabSave.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function vocabSaveImport() {
  const input = document.createElement('input');
  input.type   = 'file';
  input.accept = '.json,application/json';
  input.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!data.srs || typeof data.srs !== 'object') throw new Error('Invalid file');
        // Merge: imported data wins on conflict (newer device)
        const current = loadSRS();
        const merged  = { ...current };
        Object.entries(data.srs).forEach(([word, rec]) => {
          // Keep whichever record has more reps (more studied)
          if (!merged[word] || rec.reps >= merged[word].reps) {
            merged[word] = rec;
          }
        });
        saveSRS(merged);
        renderHome();
        showImportToast(Object.keys(data.srs).length);
      } catch {
        alert('File không hợp lệ. Vui lòng chọn file VocabSave.json đúng định dạng.');
      }
    };
    reader.readAsText(file);
  };
  document.body.appendChild(input);
  input.click();
  document.body.removeChild(input);
}

function showImportToast(count) {
  const toast = document.createElement('div');
  toast.className = 'import-toast';
  toast.textContent = `✓ Đã khôi phục ${count} từ`;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => document.body.removeChild(toast), 300);
  }, 2800);
}


const BOOKS = {
  cambridge: { label: 'Cambridge', volumes: [13,14,15,16,17,18,19,20] },
  road:      { label: 'Road to IELTS', volumes: [1,2,3,4,5,6] }
};

function allWords() {
  const db = loadSRS();
  return Object.keys(db);
}
function globalDue() {
  const db = loadSRS();
  const now = Date.now();
  return Object.values(db).filter(r => r.nextReview <= now).length;
}

function renderHome() {
  document.getElementById('guestPill').textContent = guestId();
  const dueCount = globalDue();
  document.getElementById('heroTotal').textContent = Object.keys(loadSRS()).length;
  document.getElementById('heroDue').textContent   = dueCount;

  // Due banner (top of screen)
  const dueBanner = document.getElementById('dueBanner');
  const dueBannerCount = document.getElementById('dueBannerCount');
  if (dueCount > 0) {
    dueBanner.style.display = 'flex';
    dueBannerCount.textContent = dueCount;
  } else {
    dueBanner.style.display = 'none';
  }

  const reviewBtn = document.getElementById('reviewDueBtn');
  const reviewCount = document.getElementById('reviewDueCount');
  if (dueCount > 0) {
    reviewBtn.style.display = 'block';
    reviewCount.textContent = dueCount;
  } else {
    reviewBtn.style.display = 'none';
  }

  // Tabs
  const tabs = document.getElementById('bookTabs');
  tabs.innerHTML = '';
  Object.entries(BOOKS).forEach(([key, meta]) => {
    const btn = document.createElement('button');
    btn.className = 'book-tab' + (S.bookKey === key ? ' active' : '');
    btn.textContent = meta.label;
    btn.onclick = () => { S.bookKey = key; renderHome(); };
    tabs.appendChild(btn);
  });

  const meta = BOOKS[S.bookKey];
  const list = document.getElementById('testList');
  list.innerHTML = '';
  document.getElementById('sectionHd').textContent = meta.label + ' — Select a test';

  const sourceData = VOCAB_DATA[S.bookKey];

  meta.volumes.forEach(vol => {
    const volData = S.bookKey === 'cambridge'
      ? sourceData[vol]
      : { 1: sourceData[vol] };

    const testCount = S.bookKey === 'cambridge' ? 4 : 1;

    if (S.bookKey === 'cambridge') {
      for (let t = 1; t <= testCount; t++) {
        const testData = (volData || {})[t] || {};
        const sessionId = `c${vol}t${t}`;
        appendTestRow(list, sessionId, testData,
          `Cambridge ${vol}`,
          `Test ${t}`,
          `📖`,
          () => startSession(S.bookKey, sessionId, testData, `Cambridge ${vol} · Test ${t}`)
        );
      }
    } else {
      const testData = sourceData[vol] || {};
      const sessionId = `road${vol}`;
      appendTestRow(list, sessionId, testData,
        `Road to IELTS`,
        `Test ${vol}`,
        `📝`,
        () => startSession(S.bookKey, sessionId, testData, `Road to IELTS · Test ${vol}`)
      );
    }
  });
}

function getNextReviewForWords(sessionId, words) {
  // Returns the earliest upcoming nextReview timestamp for a set of words (not due yet)
  const db = loadSRS();
  const now = Date.now();
  let earliest = null;
  for (const w of words) {
    const rec = db[`${sessionId}::${w}`];
    if (rec && rec.nextReview > now) {
      if (!earliest || rec.nextReview < earliest) earliest = rec.nextReview;
    }
  }
  return earliest;
}

function appendTestRow(list, sessionId, testData, title, sub, icon, onStart) {
  const words = Object.keys(testData);
  const count = words.length;
  const isEmpty = count === 0;
  const due = isEmpty ? 0 : countDue(sessionId, words);
  const hasStudied = !isEmpty && words.some(w => getWordStatus(sessionId, w) !== 'new');

  const row = document.createElement('div');
  row.className = 'test-row' + (isEmpty ? ' placeholder' : '');

  let badge = '';
  let nextReviewLine = '';
  if (!isEmpty) {
    if (due > 0) {
      badge = `<div class="srs-badge srs-due">${due} due</div>`;
    } else if (hasStudied) {
      badge = `<div class="srs-badge srs-ok">✓ done</div>`;
      const nextTs = getNextReviewForWords(sessionId, words);
      if (nextTs) {
        nextReviewLine = `<div class="srs-next-review">next: ${formatRelTime(nextTs)}</div>`;
      }
    } else {
      badge = `<div class="srs-badge srs-new">new</div>`;
    }
  }

  row.innerHTML = `
    <div class="test-row-icon">${isEmpty ? '🔒' : icon}</div>
    <div class="test-row-info">
      <div class="test-row-title">${title}</div>
      <div class="test-row-meta">${sub}</div>
    </div>
    <div class="test-row-right">
      <div class="word-count">${isEmpty ? '—' : count}</div>
      <div class="word-count-label">${isEmpty ? 'soon' : 'words'}</div>
      ${badge}
      ${nextReviewLine}
    </div>
  `;
  if (!isEmpty) row.onclick = () => openModeModal(title, onStart, testData);
  list.appendChild(row);
}

function startDueSession() {
  // Gather all due words across all vocab data
  const db = loadSRS();
  const now = Date.now();
  const dueWords = [];

  // Search cambridge
  Object.entries(VOCAB_DATA.cambridge).forEach(([vol, tests]) => {
    Object.entries(tests).forEach(([t, words]) => {
      const sid = `c${vol}t${t}`;
      Object.entries(words).forEach(([word, data]) => {
        const rec = db[`${sid}::${word}`];
        if (rec && rec.nextReview <= now) {
          dueWords.push({ word, _sessionId: sid, ...data });
        }
      });
    });
  });
  // Search road
  Object.entries(VOCAB_DATA.road).forEach(([vol, words]) => {
    const sid = `road${vol}`;
    Object.entries(words).forEach(([word, data]) => {
      const rec = db[`${sid}::${word}`];
      if (rec && rec.nextReview <= now) {
        dueWords.push({ word, _sessionId: sid, ...data });
      }
    });
  });

  if (dueWords.length === 0) return;
  S.definitionOnly = true;
  startSession('cambridge', 'due_session', null, `🔔 Ôn từ hôm nay · ${dueWords.length} từ`, dueWords);
}


// ════════════════════════════════════════════
// MODE MODAL — pre/post + section filter
// ════════════════════════════════════════════
let _pendingStart = null;
let _pendingRawData = null; // raw testData to inspect sections

function openModeModal(title, onStart, rawData) {
  _pendingStart = onStart;
  _pendingRawData = rawData;
  document.getElementById('modeModalTitle').textContent = title;

  // Detect if this test has section data
  const words = rawData ? Object.values(rawData) : [];
  const hasSections = words.some(w => w.section === 'reading' || w.section === 'listening');
  const readCount = words.filter(w => w.section === 'reading').length;
  const listenCount = words.filter(w => w.section === 'listening').length;

  const sectionRow = document.getElementById('sectionFilterRow');
  if (hasSections) {
    sectionRow.style.display = 'flex';
    // Reset to 'all' each open
    S.sectionFilter = 'all';
    document.querySelectorAll('.section-tab').forEach(b => {
      b.classList.toggle('active', b.dataset.section === 'all');
    });
    document.getElementById('sectionTabRead').textContent  = `📖 Reading (${readCount})`;
    document.getElementById('sectionTabListen').textContent = `🎧 Listening (${listenCount})`;
  } else {
    sectionRow.style.display = 'none';
    S.sectionFilter = 'all';
  }

  document.getElementById('modeOverlay').style.display = 'flex';

  document.getElementById('modePreBtn').onclick = () => {
    closeModeModal();
    S.sessionMode = 'pre';
    _pendingStart();
  };
  document.getElementById('modePostBtn').onclick = () => {
    closeModeModal();
    S.sessionMode = 'post';
    _pendingStart();
  };
}

function closeModeModal() {
  document.getElementById('modeOverlay').style.display = 'none';
}

// Section tab clicks
document.getElementById('modeOverlay').addEventListener('click', function(e) {
  if (e.target === this) { closeModeModal(); return; }
  const tab = e.target.closest('.section-tab');
  if (tab) {
    S.sectionFilter = tab.dataset.section;
    document.querySelectorAll('.section-tab').forEach(b =>
      b.classList.toggle('active', b.dataset.section === S.sectionFilter)
    );
  }
});

function startSession(bookKey, sessionId, rawData, title, overrideWords) {
  clearTimeout(S.advanceTimer);
  if (sessionId !== 'due_session') S.definitionOnly = false;

  let words = overrideWords || Object.entries(rawData).map(([word, d]) => ({ word, ...d }));

  // Apply section filter (only when not retry/due session)
  const filter = S.sectionFilter || 'all';
  if (!overrideWords && sessionId !== 'due_session' && filter !== 'all') {
    words = words.filter(w => w.section === filter);
    if (words.length === 0) words = overrideWords || Object.entries(rawData).map(([word, d]) => ({ word, ...d }));
  }

  // Sort queue: due words first, then new, then already learned
  const dueIdx    = words.map((_,i)=>i).filter(i => getWordStatus(words[i]._sessionId || sessionId, words[i].word) === 'due');
  const newIdx    = words.map((_,i)=>i).filter(i => getWordStatus(words[i]._sessionId || sessionId, words[i].word) === 'new');
  const learnedIdx= words.map((_,i)=>i).filter(i => getWordStatus(words[i]._sessionId || sessionId, words[i].word) === 'ok');
  const queue = [...shuffle(dueIdx), ...shuffle(newIdx), ...shuffle(learnedIdx)];

  const mode = sessionId === 'due_session' ? 'post' : (S.sessionMode || 'post');

  S = {
    ...S,
    bookKey, sessionId,
    sessionMode: mode,
    sectionFilter: filter,
    words,
    queue,
    queuePos: 0,
    correct: 0,
    wrong: 0,
    wrongWords: [],
    isRetry: !!overrideWords,
    advanceTimer: null,
  };

  // Build title suffix for section
  let titleDisplay = title;
  if (filter === 'reading')   titleDisplay += ' · Reading';
  if (filter === 'listening') titleDisplay += ' · Listening';

  document.getElementById('sessionTitle').textContent = titleDisplay;
  document.getElementById('retryBanner').classList.toggle('show', S.isRetry);

  // Mode + section badges in session bar
  document.querySelectorAll('#modeBadge,#sectionBadge').forEach(el => el.remove());
  if (sessionId !== 'due_session') {
    const bar = document.querySelector('.session-bar');
    const modeBadge = document.createElement('span');
    modeBadge.id = 'modeBadge';
    modeBadge.className = `mode-indicator mode-indicator-${S.sessionMode}`;
    modeBadge.textContent = S.sessionMode === 'pre' ? 'Pre' : 'Post';
    bar.appendChild(modeBadge);

    if (filter !== 'all') {
      const secBadge = document.createElement('span');
      secBadge.id = 'sectionBadge';
      secBadge.className = `mode-indicator mode-indicator-section-${filter}`;
      secBadge.textContent = filter === 'reading' ? '📖' : '🎧';
      bar.appendChild(secBadge);
    }
  }

  // Mute toggle in session bar
  let muteBtn = document.getElementById('sessionMuteBtn');
  if (!muteBtn) {
    muteBtn = document.createElement('button');
    muteBtn.id = 'sessionMuteBtn';
    muteBtn.className = 'mute-toggle session-mute-btn';
    muteBtn.onclick = () => setMute(!isMuted());
    document.querySelector('.session-bar').appendChild(muteBtn);
  }
  updateMuteUI();

  updateProgress();
  showScreen('session');
  renderQuiz();
}

function updateProgress() {
  const total = S.queue.length;
  const pct = total ? Math.round((S.queuePos / total) * 100) : 0;
  document.getElementById('progBar').style.width = pct + '%';
  document.getElementById('liveC').textContent = S.correct;
  document.getElementById('liveW').textContent = S.wrong;
}

// ════════════════════════════════════════════
// QUIZ ENGINE
// ════════════════════════════════════════════
// QUIZ ENGINE — v3
// Types: flashcard, viToEn, antonym, collocation,
//        fillIn, connotation, wordForm
// ════════════════════════════════════════════

const QTypes = {

  // ── 1. FLASHCARD ─────────────────────────
  // Show word + example → self-rate recall
  flashcard(word) {
    return {
      type: 'FLASHCARD', badgeClass: 'badge-def',
      isFlashcard: true, word,
      prompt: null, options: [], answer: '__flashcard__',
    };
  },

  // ── 2. VI → EN ───────────────────────────
  // Show Vietnamese meaning → pick correct English word
  // Distractors: same type preferred; fallback to any type; final fallback cross-pool
  viToEn(word, allWords) {
    const others = allWords.filter(w => w.word !== word.word);
    const sameType = others.filter(w => w.type === word.type);
    // Build pool: prefer same type, pad with any type if needed
    let distPool = sameType.length >= 3 ? sameType : others;
    if (distPool.length < 3) return null;
    const distractors = pick(distPool, 3).map(w => w.word);
    const options = shuffle([word.word, ...distractors]);
    return {
      type: 'VI → EN', badgeClass: 'badge-vi',
      prompt: `Từ nào có nghĩa: <strong>"${word.meaning}"</strong>?`,
      options, answer: word.word,
    };
  },

  // ── 3. ANTONYM ───────────────────────────
  // Distractors: same type first, pad with any type
  antonym(word, allWords) {
    if (!word.antonym) return null;
    const withAnt = allWords.filter(w => w.antonym && w.word !== word.word);
    const sameType = withAnt.filter(w => w.type === word.type);
    const distPool = sameType.length >= 3 ? sameType : withAnt;
    if (distPool.length < 3) return null;
    const distractors = pick(distPool, 3).map(w => w.antonym);
    // Guard: deduplicate (very rare but possible if antonyms repeat)
    const unique = [...new Set([word.antonym, ...distractors])];
    if (unique.length < 4) return null;
    const options = shuffle(unique.slice(0, 4));
    return {
      type: 'ANTONYM', badgeClass: 'badge-ant',
      prompt: `Which word is the <strong>opposite</strong> of <strong>${word.word}</strong>?`,
      options, answer: word.antonym,
    };
  },

  // ── 4. COLLOCATION ───────────────────────
  // All 4 options contain target word — only the partner word differs
  collocation(word) {
    if (!word.collocation) return null;
    const coll = word.collocation;
    const target = word.word.toLowerCase();
    const SKIP = new Set(['the','a','an','of','to','in','for','on','at','with','by','from']);
    const parts = coll.toLowerCase().split(' ');
    const targetParts = target.split(' ');

    // Find target span in collocation string
    let tStart = -1;
    for (let i = 0; i <= parts.length - targetParts.length; i++) {
      if (targetParts.every((tp, j) => parts[i+j] === tp)) { tStart = i; break; }
    }
    if (tStart === -1) return null;
    const tEnd = tStart + targetParts.length - 1;

    // Find nearest meaningful (non-article) word outside target span — that's what we swap
    let partnerIdx = -1;
    for (let i = tStart - 1; i >= 0; i--) {
      if (!SKIP.has(parts[i])) { partnerIdx = i; break; }
    }
    if (partnerIdx === -1) {
      for (let i = tEnd + 1; i < parts.length; i++) {
        if (!SKIP.has(parts[i])) { partnerIdx = i; break; }
      }
    }
    if (partnerIdx === -1) return null;

    // Partner pools — swap based on what the PARTNER word is, not the target word type
    // If partner is before target (verb before noun): swap with other verbs
    // If partner is after target (noun after verb): swap with other nouns
    // General pools by target type:
    const POOLS = {
      noun:      ['gain','lose','build','create','seek','avoid','challenge','damage','restore','maintain','undermine','exacerbate'],
      verb:      {
        before: ['rapidly','gradually','significantly','completely','consistently','severely','steadily','dramatically'],  // adverb after verb
        after:  ['growth','progress','decline','situation','problem','solution','record','pattern','system','process'],    // noun object after verb
      },
      adjective: ['growth','progress','decline','situation','shift','response','outcome','pressure','demand','behaviour','capacity'],
      adverb:    ['act','respond','behave','operate','perform','react','engage','proceed','function','develop','approach'],
      phrase:    ['gain','lose','build','seek','avoid','challenge','damage','restore','maintain','undermine'],
    };

    let pool;
    if (word.type === 'verb') {
      // If partner is AFTER target → it's a noun object → use noun pool
      // If partner is BEFORE target → it's an adverb modifier → use adverb pool
      pool = partnerIdx > tEnd ? POOLS.verb.after : POOLS.verb.before;
    } else {
      pool = POOLS[word.type] || POOLS.noun;
    }
    const partner = parts[partnerIdx];
    const wrongs = pool.filter(p => p !== partner && !coll.toLowerCase().includes(p)).slice(0, 3);
    if (wrongs.length < 2) return null;

    const origParts = coll.split(' ');
    const distractors = wrongs.map(w => { const d=[...origParts]; d[partnerIdx]=w; return d.join(' '); });
    const options = shuffle([coll, ...distractors]);
    return {
      type: 'COLLOCATION', badgeClass: 'badge-coll',
      prompt: `Which phrase correctly uses <strong>${word.word}</strong>?`,
      options, answer: coll,
    };
  },

  // ── 5. FILL IN ───────────────────────────
  // Distractors same type → student can't eliminate by grammar alone
  fillIn(word, allWords) {
    if (!word.example) return null;
    const target = word.word;
    const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const blanked = word.example.replace(new RegExp(escaped, 'i'), '________');
    if (!blanked.includes('________')) return null;
    const others = allWords.filter(w => w.word !== word.word);
    const sameType = others.filter(w => w.type === word.type);
    const distPool = sameType.length >= 3 ? sameType : others;
    if (distPool.length < 3) return null;
    const distractors = pick(distPool, 3).map(w => w.word);
    const options = shuffle([target, ...distractors]);
    return {
      type: 'FILL IN', badgeClass: 'badge-fill',
      prompt: `Complete the sentence:<div class="qcard-sentence">"${blanked}"</div>`,
      options, answer: target,
    };
  },

  // ── 6. CONNOTATION ───────────────────────
  // Uses word.connotation field ('positive'/'negative'/'neutral') if set in data.
  // Fallback: whole-word Vietnamese keyword matching (not substring).
  connotation(word) {
    if (!word.example) return null;
    // Whole-word match using word boundaries in Vietnamese-friendly way:
    // split text into space-separated tokens and check exact token membership
    const matchWords = (text, keywords) => {
      const tokens = text.toLowerCase().split(/[\s,./()]+/);
      return keywords.some(k => tokens.includes(k.toLowerCase()));
    };
    const NEG_KW = ['hại','nguy hiểm','xấu','tệ','mất mát','sụp đổ','kìm hãm','thờ ơ','suy giảm','cạn kiệt','thèm muốn','lảo đảo','xẹp xuống','trì hoãn','tàn phá','khuất phục','bất bình','tàn tật','bóc lột','trục xuất','thiên vị','tiêu cực','tàn ác','nguy hại','phá hoại','sụt giảm','mồ côi','dịch','bệnh','chênh lệch'];
    const POS_KW = ['tích cực','tốt','viên mãn','đồng hành','khuyến khích','sáng suốt','nở rộ','thỏa mãn','hào phóng','sống động','đột phá','thành thạo','tái khẳng định','vượt ra','lành tính','vô hại','linh hoạt','đức hạnh','thành tích'];

    let correct = word.connotation || null;
    if (!correct) {
      const txt = word.meaning + ' ' + (word.antonym || '');
      if (matchWords(txt, NEG_KW)) correct = 'negative';
      else if (matchWords(txt, POS_KW)) correct = 'positive';
      else correct = 'neutral';
    }
    const MAP = { positive: 'Positive 👍', negative: 'Negative 👎', neutral: 'Neutral 🔄' };
    const answer = MAP[correct] || 'Neutral 🔄';
    const options = shuffle(['Positive 👍', 'Negative 👎', 'Neutral 🔄']);
    return {
      type: 'CONNOTATION', badgeClass: 'badge-tf',
      prompt: `What is the connotation of <strong>${word.word}</strong>?<div class="qcard-sentence">"${word.example}"</div>`,
      options, answer,
    };
  },

  // ── 7. WORD FORM ─────────────────────────
  // Uses word.forms: { noun, verb, adjective, adverb }
  // Uses word.formExamples: { noun: '...', verb: '...' } for custom sentences
  // Fallback sentences are grammatically correct per form type
  wordForm(word, allWords) {
    if (!word.forms) return null;
    const available = Object.entries(word.forms).filter(([, v]) => v);
    if (available.length < 2) return null;

    const [targetType, targetForm] = available[Math.floor(Math.random() * available.length)];

    // Wrong options: other forms of this word first, then forms from other words
    const wrongSameWord = available.filter(([t]) => t !== targetType).map(([, v]) => v);
    const wrongOther = allWords
      .filter(w => w.word !== word.word && w.forms)
      .flatMap(w => Object.values(w.forms).filter(Boolean))
      .filter(f => f !== targetForm && !wrongSameWord.includes(f));

    const distPool = [...wrongSameWord, ...wrongOther];
    if (distPool.length < 3) return null;
    const distractors = pick(distPool.map(f => ({ word: f })), 3).map(x => x.word);
    const options = shuffle([targetForm, ...distractors]);

    // Per-form-type fallback templates that are grammatically natural
    const TEMPLATES = {
      noun:      `The _______ became a major topic of debate among scholars.`,
      verb:      `Governments need to _______ this issue before it worsens.`,
      adjective: `The _______ approach led to unexpected improvements.`,
      adverb:    `She handled the situation _______, avoiding unnecessary conflict.`,
    };
    const exampleSentence = word.formExamples?.[targetType] || TEMPLATES[targetType]
      || `Choose the correct form: _______ (${targetType})`;

    return {
      type: 'WORD FORM', badgeClass: 'badge-form',
      prompt: `Which <em>${targetType}</em> form fits the blank?<div class="qcard-sentence">"${exampleSentence}"</div>`,
      options, answer: targetForm,
    };
  },
};

// ── pickQuestion ─────────────────────────────
// Pre mode  (học trước): exposure-first — flashcard 2x, fillIn 2x, connotation 2x; viToEn 1x; collocation/antonym 0x
// Post mode (ôn sau):   production-first — viToEn 2x, collocation 2x, antonym 2x; flashcard 1x, fillIn 1x, connotation 1x
// definitionOnly (due session) = flashcard only
function pickQuestion(word, allWords) {
  if (S.definitionOnly) return QTypes.flashcard(word);

  const pool = [];
  const add = (q, weight=1) => { if (q) for (let i=0; i<weight; i++) pool.push(q); };

  const isPre = S.sessionMode === 'pre';

  if (isPre) {
    // Pre: exposure — understand, recognise, absorb
    add(QTypes.flashcard(word),          2);  // self-rated recall, low pressure
    add(QTypes.fillIn(word, allWords),   2);  // word in context
    add(QTypes.connotation(word),        2);  // understand register
    add(QTypes.viToEn(word, allWords),   1);  // some production
    // collocation & antonym: too hard before knowing the word; skip
    if (word.forms) add(QTypes.wordForm(word, allWords), 1);
  } else {
    // Post: production — use, differentiate, retain
    add(QTypes.viToEn(word, allWords),   2);  // forced recall
    add(QTypes.collocation(word),        2);  // correct usage
    add(QTypes.antonym(word, allWords),  2);  // semantic contrast
    add(QTypes.flashcard(word),          1);  // still useful
    add(QTypes.fillIn(word, allWords),   1);
    add(QTypes.connotation(word),        1);
    if (word.forms) add(QTypes.wordForm(word, allWords), 1);
  }

  if (pool.length === 0) return QTypes.flashcard(word);
  return pool[Math.floor(Math.random() * pool.length)];
}

function renderQuiz() {
  if (S.queuePos >= S.queue.length) { showResults(); return; }

  const idx = S.queue[S.queuePos];
  const word = S.words[idx];
  const q = pickQuestion(word, S.words);

  const card = document.getElementById('quizCard');
  card.className = 'quiz-card card-anim';

  if (q.isFlashcard) {
    card.innerHTML = `
      <div class="qcard-top">
        <span class="qcard-type-badge ${q.badgeClass}">FLASHCARD</span>
        <div class="qcard-pos">${word.type || ''}</div>
        <div class="flashcard-word">${word.word}</div>
        ${word.example ? `<div class="qcard-sentence">"${word.example}"</div>` : ''}
      </div>
      <div class="flashcard-reveal-area" id="fcReveal" style="display:none">
        <div class="flashcard-meaning">${word.meaning}</div>
        ${word.collocation ? `<div class="flashcard-coll">📌 ${word.collocation}</div>` : ''}
        ${word.antonym ? `<div class="flashcard-coll">↔ ${word.antonym}</div>` : ''}
      </div>
      <div class="flashcard-actions" id="fcActions">
        <button class="fc-reveal-btn" onclick="revealFlashcard()">Xem nghĩa</button>
      </div>
    `;
  } else {
    const keys = ['A','B','C','D'];
    card.innerHTML = `
      <div class="qcard-top">
        <span class="qcard-type-badge ${q.badgeClass}">${q.type}</span>
        <div class="qcard-pos">${word.type || ''}</div>
        <div class="qcard-prompt">${q.prompt}</div>
      </div>
      <div class="qcard-options" 
        data-answer="${escAttr(q.answer)}"
        data-word="${escAttr(word.word)}"
        data-meaning="${escAttr(word.meaning)}"
        data-qtype="${escAttr(q.type)}">
        ${q.options.map((opt, i) => `
          <button class="opt-btn" data-val="${escAttr(opt)}" onclick="handleAnswer(this)">
            <span class="opt-key">${keys[i]}</span>
            ${opt}
          </button>
        `).join('')}
      </div>
    `;
  }

  updateProgress();
}

function revealFlashcard() {
  const idx = S.queue[S.queuePos];
  const word = S.words[idx];
  document.getElementById('fcReveal').style.display = 'block';
  document.getElementById('fcActions').innerHTML = `
    <button class="fc-know-btn" onclick="rateFlashcard(true)">✓ Biết rồi</button>
    <button class="fc-forget-btn" onclick="rateFlashcard(false)">✗ Chưa nhớ</button>
  `;
  speakWord(word.word);
  S._fcRevealed = true;
}

function rateFlashcard(knew) {
  S._fcRevealed = false;
  const idx = S.queue[S.queuePos];
  const word = S.words[idx];
  updateSRSWord(word._sessionId || S.sessionId, word.word, knew);
  if (knew) { S.correct++; playCorrect(); }
  else { S.wrong++; speakWord(word.word); }
  updateProgress();
  S.queuePos++;
  setTimeout(renderQuiz, 300);
}

function escHtml(str) {
  return (str || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

function escAttr(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function handleAnswer(btn) {
  const container = btn.closest('.qcard-options');
  const correctAnswer = container.dataset.answer;
  const wordStr      = container.dataset.word;
  const wordMeaning  = container.dataset.meaning;
  const qType        = container.dataset.qtype;

  document.querySelectorAll('.opt-btn').forEach(b => b.disabled = true);
  const chosen = btn.dataset.val;
  const isCorrect = chosen === correctAnswer;

  if (isCorrect) {
    btn.classList.add('correct');
    playCorrect();
    speakWord(wordStr);
    S.correct++;
    updateSRSWord(S.sessionId, wordStr, true);
  } else {
    btn.classList.add('wrong');
    document.querySelectorAll('.opt-btn').forEach(b => {
      if (b.dataset.val === correctAnswer) b.classList.add('correct');
    });
    speakWord(wordStr);
    S.wrong++;
    if (!S.wrongWords.includes(wordStr)) S.wrongWords.push(wordStr);
    updateSRSWord(S.sessionId, wordStr, false);
    const card = document.getElementById('quizCard');
    card.classList.add('shake');
    setTimeout(() => card.classList.remove('shake'), 350);
  }

  updateProgress();

  const card = document.getElementById('quizCard');
  const strip = document.createElement('div');
  strip.className = 'result-strip ' + (isCorrect ? 'ok' : 'bad');

  const REINFORCE_TYPES = ['COLLOCATION','CONNOTATION','ANTONYM','FILL IN'];
  const needsReinforce = REINFORCE_TYPES.includes(qType);

  if (isCorrect) {
    strip.innerHTML = needsReinforce
      ? `<span class="strip-icon">✓</span>
         <div class="strip-wrong-info">
           <span class="strip-missed" style="color:var(--green)"><strong>${wordStr}</strong> = ${wordMeaning}</span>
           <span class="strip-correct-answer" style="opacity:.8">${correctAnswer}</span>
         </div>`
      : `<span class="strip-icon">✓</span><span>Correct!</span>`;
    card.appendChild(strip);
    clearTimeout(S.advanceTimer);
    S.advanceTimer = setTimeout(() => { S.queuePos++; renderQuiz(); }, needsReinforce ? 1800 : 500);
  } else {
    strip.innerHTML = `
      <span class="strip-icon">✗</span>
      <div class="strip-wrong-info">
        <span class="strip-missed"><strong>${wordStr}</strong> = ${wordMeaning}</span>
        <span class="strip-correct-answer">Đáp án đúng: ${correctAnswer}</span>
      </div>
      <button class="strip-next-btn" onclick="advanceNext()">Tiếp →</button>
    `;
    card.appendChild(strip);
  }
}

function advanceNext() {
  clearTimeout(S.advanceTimer);
  S.queuePos++;
  renderQuiz();
}

// Keyboard shortcuts
document.addEventListener('keydown', e => {
  if (!document.getElementById('session').classList.contains('active')) return;
  // Space/Enter → click Next button if showing
  if (e.key === ' ' || e.key === 'Enter') {
    // Flashcard: space reveals, then space = know
    const revealBtn = document.querySelector('.fc-reveal-btn');
    if (revealBtn) { e.preventDefault(); revealBtn.click(); return; }
    const knowBtn = document.querySelector('.fc-know-btn');
    if (knowBtn) { e.preventDefault(); knowBtn.click(); return; }
    const nextBtn = document.querySelector('.strip-next-btn');
    if (nextBtn) { e.preventDefault(); nextBtn.click(); return; }
  }
  const map = { a:0, b:1, c:2, d:3, 1:0, 2:1, 3:2, 4:3 };
  const idx = map[e.key.toLowerCase()];
  if (idx === undefined) return;
  const btns = document.querySelectorAll('.opt-btn:not(:disabled)');
  if (btns[idx]) btns[idx].click();
});

// ════════════════════════════════════════════
// RESULTS
// ════════════════════════════════════════════
function showResults() {
  const total = S.correct + S.wrong;
  const pct = total ? Math.round((S.correct / total) * 100) : 100;

  let emoji, bigText, bigClass, sub;
  if (pct >= 85)      { emoji='🔥'; bigText='Solid';   bigClass='great'; sub='Strong session. Keep the pace.'; }
  else if (pct >= 60) { emoji='💪'; bigText='Decent';  bigClass='ok';    sub='Good effort. Drill the missed ones.'; }
  else                { emoji='😤'; bigText='Grind';   bigClass='poor';  sub='Tough round. Retry → it works.'; }

  document.getElementById('resEmoji').textContent = emoji;
  document.getElementById('resBig').textContent = bigText;
  document.getElementById('resBig').className = 'res-big ' + bigClass;
  document.getElementById('resSub').textContent = sub;
  document.getElementById('resC').textContent = S.correct;
  document.getElementById('resW').textContent = S.wrong;
  document.getElementById('resT').textContent = total;

  const missedWrap = document.getElementById('missedWrap');
  const missedChips = document.getElementById('missedChips');
  if (S.wrongWords.length > 0) {
    missedWrap.style.display = 'block';
    missedChips.innerHTML = S.wrongWords.map(w =>
      `<span class="missed-chip">${w}</span>`
    ).join('');
  } else {
    missedWrap.style.display = 'none';
  }

  // SRS next review info
  const db = loadSRS();
  const nextTimes = S.words
    .map(w => db[`${w._sessionId || S.sessionId}::${w.word}`]?.nextReview)
    .filter(Boolean)
    .sort((a,b) => a-b);
  const nextReview = nextTimes[0];
  const srsText = nextReview
    ? `Progress saved · Next review: ${formatRelTime(nextReview)}`
    : 'Progress saved.';
  document.getElementById('srsInfoText').textContent = srsText;

  const retryBtn = document.getElementById('retryMissedBtn');
  if (S.wrongWords.length === 0) {
    retryBtn.disabled = true;
    retryBtn.textContent = '✓ Nothing missed';
  } else {
    retryBtn.disabled = false;
    retryBtn.textContent = `↻ Drill ${S.wrongWords.length} missed word${S.wrongWords.length > 1 ? 's' : ''}`;
  }

  showScreen('results');
}

function formatRelTime(ts) {
  const diff = ts - Date.now();
  const mins = Math.round(diff / 60000);
  const hrs  = Math.round(diff / 3600000);
  const days = Math.round(diff / 86400000);
  if (diff < 0)    return 'now';
  if (mins < 60)   return `in ${mins}m`;
  if (hrs < 24)    return `in ${hrs}h`;
  return `in ${days}d`;
}

// ════════════════════════════════════════════
// WIRING
// ════════════════════════════════════════════
document.getElementById('backBtn').onclick = () => {
  clearTimeout(S.advanceTimer);
  renderHome();
  showScreen('home');
};

document.getElementById('toHomeBtn').onclick = () => {
  renderHome();
  showScreen('home');
};

document.getElementById('restartBtn').onclick = () => {
  const title = document.getElementById('sessionTitle').textContent;
  startSession(S.bookKey, S.sessionId, null, title, [...S.words]);
};

document.getElementById('retryMissedBtn').onclick = () => {
  if (!S.wrongWords.length) return;
  const missedWords = S.words.filter(w => S.wrongWords.includes(w.word));
  const title = document.getElementById('sessionTitle').textContent + ' · Retry';
  startSession(S.bookKey, S.sessionId, null, title, missedWords);
};

// ════════════════════════════════════════════
// URL ROUTING
// ════════════════════════════════════════════
// URL format:
//   #home                    → home screen
//   #cambridge/13/1          → Cambridge 13 Test 1
//   #road/1                  → Road to IELTS Test 1
//   #due                     → Review due words

function parseHash() {
  const hash = location.hash.replace('#', '').trim();
  if (!hash || hash === 'home') return { type: 'home' };
  const parts = hash.split('/');
  if (parts[0] === 'due') return { type: 'due' };
  if (parts[0] === 'cambridge' && parts[1] && parts[2]) {
    return { type: 'cambridge', vol: parseInt(parts[1]), test: parseInt(parts[2]) };
  }
  if (parts[0] === 'road' && parts[1]) {
    return { type: 'road', test: parseInt(parts[1]) };
  }
  return { type: 'home' };
}

function navigateTo(hash) {
  history.pushState(null, '', '#' + hash);
  routeFromHash();
}

function routeFromHash() {
  const route = parseHash();
  if (route.type === 'home') {
    renderHome(); showScreen('home'); return;
  }
  if (route.type === 'due') {
    startDueSession(); return;
  }
  if (route.type === 'cambridge') {
    const testData = ((VOCAB_DATA.cambridge[route.vol] || {})[route.test]) || {};
    if (Object.keys(testData).length === 0) { renderHome(); showScreen('home'); return; }
    startSession('cambridge', `c${route.vol}t${route.test}`, testData, `Cambridge ${route.vol} · Test ${route.test}`);
    return;
  }
  if (route.type === 'road') {
    const testData = (VOCAB_DATA.road[route.test]) || {};
    if (Object.keys(testData).length === 0) { renderHome(); showScreen('home'); return; }
    startSession('road', `road${route.test}`, testData, `Road to IELTS · Test ${route.test}`);
    return;
  }
  renderHome(); showScreen('home');
}

// Patch startSession and renderHome to update URL
const _origStartSession = startSession;
window.startSession = function(bookKey, sessionId, rawData, title, overrideWords) {
  // Update hash based on sessionId
  if (sessionId && sessionId !== 'due_session') {
    const cambMatch = sessionId.match(/^c(\d+)t(\d+)$/);
    const roadMatch = sessionId.match(/^road(\d+)$/);
    if (cambMatch) history.pushState(null, '', `#cambridge/${cambMatch[1]}/${cambMatch[2]}`);
    else if (roadMatch) history.pushState(null, '', `#road/${roadMatch[1]}`);
    else history.pushState(null, '', '#session');
  } else if (sessionId === 'due_session') {
    history.pushState(null, '', '#due');
  }
  _origStartSession(bookKey, sessionId, rawData, title, overrideWords);
};

// Back to home → update URL
document.getElementById('backBtn').addEventListener('click', () => {
  history.pushState(null, '', '#home');
}, true);
document.getElementById('toHomeBtn').addEventListener('click', () => {
  history.pushState(null, '', '#home');
}, true);

window.addEventListener('popstate', routeFromHash);

// Boot
migrateSRSv1(); // one-time migration: plain keys → sessionId::word scoped keys
routeFromHash();
updateMuteUI();

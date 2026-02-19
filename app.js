// ════════════════════════════════════════════
// SRS — SM-2 simplified
// ════════════════════════════════════════════
const SRS_KEY = 'blitz_srs_v1';

function loadSRS() {
  try { return JSON.parse(localStorage.getItem(SRS_KEY)) || {}; } catch { return {}; }
}
function saveSRS(data) {
  try { localStorage.setItem(SRS_KEY, JSON.stringify(data)); } catch {}
}

function updateSRSWord(word, correct) {
  const db = loadSRS();
  const now = Date.now();
  const rec = db[word] || { interval: 1, ease: 2.5, reps: 0, nextReview: now };

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
  db[word] = rec;
  saveSRS(db);
}

function getWordStatus(word) {
  const db = loadSRS();
  const rec = db[word];
  if (!rec) return 'new';
  if (rec.nextReview <= Date.now()) return 'due';
  return 'ok';
}

function countDue(words) {
  return words.filter(w => getWordStatus(w) === 'due').length;
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
let S = {
  bookKey: 'cambridge',
  sessionId: null,
  words: [],          // [{word, ...data}]
  queue: [],          // indices into words[]
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
// HOME
// ════════════════════════════════════════════
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
        appendTestRow(list, testData,
          `Cambridge ${vol}`,
          `Test ${t}`,
          `📖`,
          () => startSession(S.bookKey, `c${vol}t${t}`, testData, `Cambridge ${vol} · Test ${t}`)
        );
      }
    } else {
      const testData = sourceData[vol] || {};
      appendTestRow(list, testData,
        `Road to IELTS`,
        `Test ${vol}`,
        `📝`,
        () => startSession(S.bookKey, `road${vol}`, testData, `Road to IELTS · Test ${vol}`)
      );
    }
  });
}

function appendTestRow(list, testData, title, sub, icon, onClick) {
  const words = Object.keys(testData);
  const count = words.length;
  const isEmpty = count === 0;
  const due = isEmpty ? 0 : countDue(words);
  const hasStudied = !isEmpty && words.some(w => getWordStatus(w) !== 'new');

  const row = document.createElement('div');
  row.className = 'test-row' + (isEmpty ? ' placeholder' : '');

  let badge = '';
  if (!isEmpty) {
    if (due > 0)       badge = `<div class="srs-badge srs-due">${due} due</div>`;
    else if (hasStudied) badge = `<div class="srs-badge srs-ok">✓ done</div>`;
    else                badge = `<div class="srs-badge srs-new">new</div>`;
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
    </div>
  `;
  if (!isEmpty) row.onclick = onClick;
  list.appendChild(row);
}

function startDueSession() {
  // Gather all due words across all vocab data
  const db = loadSRS();
  const now = Date.now();
  const dueWords = [];

  // Search cambridge
  Object.entries(VOCAB_DATA.cambridge).forEach(([vol, tests]) => {
    Object.entries(tests).forEach(([test, words]) => {
      Object.entries(words).forEach(([word, data]) => {
        const rec = db[word];
        if (rec && rec.nextReview <= now) {
          dueWords.push({ word, ...data });
        }
      });
    });
  });
  // Search road
  Object.entries(VOCAB_DATA.road).forEach(([test, words]) => {
    Object.entries(words).forEach(([word, data]) => {
      const rec = db[word];
      if (rec && rec.nextReview <= now) {
        dueWords.push({ word, ...data });
      }
    });
  });

  if (dueWords.length === 0) return;
  startSession('cambridge', 'due_session', null, `🔔 Ôn từ hôm nay · ${dueWords.length} từ`, dueWords);
}


function startSession(bookKey, sessionId, rawData, title, overrideWords) {
  clearTimeout(S.advanceTimer);

  const words = overrideWords || Object.entries(rawData).map(([word, d]) => ({ word, ...d }));

  // Sort queue: due words first, then new, then already learned
  const dueIdx    = words.map((_,i)=>i).filter(i => getWordStatus(words[i].word) === 'due');
  const newIdx    = words.map((_,i)=>i).filter(i => getWordStatus(words[i].word) === 'new');
  const learnedIdx= words.map((_,i)=>i).filter(i => getWordStatus(words[i].word) === 'ok');
  const queue = [...shuffle(dueIdx), ...shuffle(newIdx), ...shuffle(learnedIdx)];

  S = {
    ...S,
    bookKey, sessionId,
    words,
    queue,
    queuePos: 0,
    correct: 0,
    wrong: 0,
    wrongWords: [],
    isRetry: !!overrideWords,
    advanceTimer: null,
  };

  document.getElementById('sessionTitle').textContent = title;
  document.getElementById('retryBanner').classList.toggle('show', S.isRetry);
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

// Question type generators — return { prompt, options, answer, badgeClass }
const QTypes = {
  definition(word, allWords) {
    const others = allWords.filter(w => w.word !== word.word);
    const distractors = pick(others, 3).map(w => w.meaning);
    const options = shuffle([word.meaning, ...distractors]);
    return {
      type: 'DEFINITION', badgeClass: 'badge-def',
      prompt: `What does <strong>${word.word}</strong> mean?`,
      options,
      answer: word.meaning,
    };
  },

  antonym(word, allWords) {
    if (!word.antonym) return null;
    const others = allWords.filter(w => w.antonym && w.word !== word.word);
    const distractors = pick(others, 3).map(w => w.antonym);
    if (distractors.length < 3) return null;
    const options = shuffle([word.antonym, ...distractors]);
    return {
      type: 'ANTONYM', badgeClass: 'badge-ant',
      prompt: `Which word is the <strong>opposite</strong> of <strong>${word.word}</strong>?`,
      options,
      answer: word.antonym,
    };
  },

  collocation(word, allWords) {
    if (!word.collocation) return null;

    // Generate plausible-but-wrong collocations for THIS word
    // by swapping the partner noun/verb with unrelated ones
    const WRONG_PARTNERS = {
      noun:      ['problem','weather','mistake','situation','number','period','result','damage'],
      verb:      ['break','ignore','remove','delay','cancel','avoid','reduce','reject'],
      adjective: ['recent','simple','daily','minor','physical','direct','basic','sharp'],
      adverb:    ['quickly','fully','broadly','partly','deeply','rarely','heavily','strictly'],
    };
    const pool = WRONG_PARTNERS[word.type] || WRONG_PARTNERS.noun;
    // Take the first word of collocation (usually the verb/adj partner), replace the noun
    const parts = word.collocation.split(' ');
    const wrongPartners = shuffle(pool.filter(p => !word.collocation.includes(p))).slice(0, 3);
    const distractors = wrongPartners.map(p => {
      // Replace last word of collocation with wrong partner
      const wrongParts = [...parts];
      wrongParts[wrongParts.length - 1] = p;
      return wrongParts.join(' ');
    });

    if (distractors.length < 2) return null;
    const options = shuffle([word.collocation, ...distractors]);
    return {
      type: 'COLLOCATION', badgeClass: 'badge-coll',
      prompt: `Which phrase correctly uses <strong>${word.word}</strong>?`,
      options,
      answer: word.collocation,
    };
  },

  sentiment(word) {
    if (!word.example) return null;

    // Determine sentiment from meaning and antonym data
    const NEGATIVE_SIGNALS = ['tiêu cực','tàn phá','xấu','hại','nguy','tệ','chết','sụp đổ','kìm hãm',
      'thờ ơ','trì hoãn','mất','giảm','cạn','thèm','khuất phục','xẹp','lảo đảo','giật mình',
      'deleterious','demise','stifle','subjugate','indifference','deflated','dwindling','coveting',
      'lobotomy','crippled','shrink','detrimental','harmful','collapse','decay','deplete'];
    const POSITIVE_SIGNALS = ['tích cực','viên mãn','nở rộ','đồng hành','khuyến khích','sáng suốt',
      'fulfill','blossom','positive','thrive','reinforce','ripen','alert','incentive','virtue',
      'companionship','judiciously','tailored','fulfilled','resist','prevent'];
    const NEUTRAL_SIGNALS = ['nhịp sinh học','thủy triều','bình minh','phân rã','tiêu hóa',
      'circadian','tidal','radioactive','digestive','narrative','motif','tertiary','rod','odour',
      'cholera','lobotomy','preliminary','protagonist'];

    const textToCheck = (word.meaning + ' ' + word.word + ' ' + (word.antonym || '')).toLowerCase();

    let correctSentiment;
    if (NEGATIVE_SIGNALS.some(s => textToCheck.includes(s.toLowerCase()))) {
      correctSentiment = 'Negative 👎';
    } else if (POSITIVE_SIGNALS.some(s => textToCheck.includes(s.toLowerCase()))) {
      correctSentiment = 'Positive 👍';
    } else if (NEUTRAL_SIGNALS.some(s => textToCheck.includes(s.toLowerCase()))) {
      correctSentiment = 'Both 🔄';
    } else {
      correctSentiment = word.antonym ? 'Positive 👍' : 'Both 🔄';
    }

    const allOptions = ['Positive 👍', 'Negative 👎', 'Both 🔄'];
    // Shuffle but keep correct in the mix
    const distractors = allOptions.filter(o => o !== correctSentiment);
    const options = shuffle([correctSentiment, ...distractors]);

    return {
      type: 'CONNOTATION', badgeClass: 'badge-tf',
      prompt: `Read the sentence. What is the connotation of <strong>${word.word}</strong>?<span class="qcard-sentence">"${word.example}"</span>`,
      options,
      answer: correctSentiment,
    };
  },

  wordInContext(word, allWords) {
    if (!word.example) return null;
    const blanked = word.example.replace(new RegExp(`\\b${word.word}\\b`, 'i'), '________');
    if (!blanked.includes('________')) return null;
    const others = allWords.filter(w => w.word !== word.word);
    const distractors = pick(others, 3).map(w => w.word);
    const options = shuffle([word.word, ...distractors]);
    return {
      type: 'FILL IN', badgeClass: 'badge-coll',
      prompt: `Fill in the blank:<span class="qcard-sentence">"${blanked}"</span>`,
      options,
      answer: word.word,
    };
  },
};

function pickQuestion(word, allWords) {
  const types = ['definition','antonym','collocation','sentiment','wordInContext'];
  const shuffledTypes = shuffle(types);
  for (const t of shuffledTypes) {
    const q = QTypes[t](word, allWords);
    if (q) return q;
  }
  return QTypes.definition(word, allWords);
}

function renderQuiz() {
  if (S.queuePos >= S.queue.length) { showResults(); return; }

  const idx = S.queue[S.queuePos];
  const word = S.words[idx];
  const q = pickQuestion(word, S.words);

  const card = document.getElementById('quizCard');
  const keys = ['A','B','C','D'];

  card.className = 'quiz-card card-anim';
  card.innerHTML = `
    <div class="qcard-top">
      <span class="qcard-type-badge ${q.badgeClass}">${q.type}</span>
      <div class="qcard-pos">${word.type || ''}</div>
      <div class="qcard-prompt">${q.prompt}</div>
    </div>
    <div class="qcard-options">
      ${q.options.map((opt, i) => `
        <button class="opt-btn" data-val="${escHtml(opt)}"
          onclick="handleAnswer(this, '${escHtml(q.answer)}', '${escHtml(word.word)}', '${escHtml(word.meaning)}', '${escHtml(q.type)}')">
          <span class="opt-key">${keys[i]}</span>
          ${opt}
        </button>
      `).join('')}
    </div>
  `;

  updateProgress();
}

function escHtml(str) {
  return (str || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

function handleAnswer(btn, correctAnswer, wordStr, wordMeaning, qType) {
  document.querySelectorAll('.opt-btn').forEach(b => b.disabled = true);
  const chosen = btn.dataset.val;
  const isCorrect = chosen === correctAnswer;

  if (isCorrect) {
    btn.classList.add('correct');
    playCorrect();
    S.correct++;
    updateSRSWord(wordStr, true);
  } else {
    btn.classList.add('wrong');
    document.querySelectorAll('.opt-btn').forEach(b => {
      if (b.dataset.val === correctAnswer) b.classList.add('correct');
    });
    speakWordUK(wordStr);
    S.wrong++;
    if (!S.wrongWords.includes(wordStr)) S.wrongWords.push(wordStr);
    updateSRSWord(wordStr, false);
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
    .map(w => db[w.word]?.nextReview)
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
routeFromHash();

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

const elStatus      = document.getElementById('status');
const elMicDot      = document.getElementById('mic-dot');
const elInterim     = document.getElementById('subtitle-interim');
const elSource      = document.getElementById('subtitle-cantonese');
const elTarget      = document.getElementById('subtitle-english');
const elBrowserWarn = document.getElementById('browser-warn');
const elListenBtn   = document.getElementById('listenBtn');
const elSpeakBtn    = document.getElementById('speakBtn');
const elPlayWrap    = document.getElementById('play-btn-wrap');
const elPlayBtn     = document.getElementById('playBtn');
const elClearBtn    = document.getElementById('clearBtn');

let recognition   = null;
let currentAudio  = null;
let fadeTimer     = null;
let mode          = 'listen';
let lastCantonese = '';

// Generation counters — every new session gets a unique ID so stale async
// callbacks (onend, onresult, doResume) silently bail instead of corrupting state.
let listenGen = 0;
let speakGen  = 0;

const SUBTITLE_MS = 5000;
const log = (...a) => console.log('[CANTO]', ...a);

const HINTS = {
  listen: "Speak Cantonese near your mic — English subtitles appear instantly.\nGrant mic access when Chrome asks.",
  speak:  "Say anything in English — CANTO translates and speaks it in Cantonese.\nTap ▶ PLAY CANTONESE to repeat the last phrase.",
};

function setStatus(text) { elStatus.textContent = text; }

function updateModeUI() {
  document.body.className = `mode-${mode}`;
  elListenBtn.classList.toggle('active', mode === 'listen');
  elSpeakBtn.classList.toggle('active', mode === 'speak');
  elMicDot.className = '';
  document.getElementById('mode-hint').textContent = HINTS[mode];
  clearSubtitles();
}

function clearSubtitles() {
  clearTimeout(fadeTimer);
  elInterim.textContent = '';
  elInterim.classList.remove('visible');
  elSource.textContent  = '';
  elSource.classList.remove('visible');
  elTarget.textContent  = '';
  elTarget.classList.remove('visible');
  lastCantonese = '';
  elPlayWrap.classList.remove('visible');
}

// Stop any active recognition and invalidate its callbacks.
function stopRecognition() {
  listenGen++;
  log('stopRecognition — new listenGen:', listenGen);
  if (recognition) {
    try { recognition.abort(); } catch (_) {}
    recognition = null;
  }
}

function switchMode(newMode) {
  if (mode === newMode) return;
  log('switchMode →', newMode);
  mode = newMode;
  updateModeUI();

  stopRecognition();
  speakGen++;                                         // cancel any in-flight TTS resume
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
  speechSynthesis.cancel();

  setTimeout(() => startListening(), 300);
}

function startListening() {
  if (!SpeechRecognition) {
    elBrowserWarn.style.display = 'block';
    setStatus('UNSUPPORTED BROWSER');
    return;
  }

  const gen = ++listenGen;
  log('startListening gen:', gen, 'mode:', mode);

  recognition = new SpeechRecognition();
  recognition.lang           = mode === 'listen' ? 'zh-HK' : 'en-US';
  // Non-continuous in speak mode: Chrome stops naturally after each utterance,
  // no manual abort needed, no feedback-loop risk while TTS is playing.
  recognition.continuous     = mode === 'listen';
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    if (gen !== listenGen) return;
    log('onstart gen:', gen);
    setStatus(mode === 'listen' ? 'LISTENING...' : 'SPEAK NOW...');
    elMicDot.className = 'active';
  };

  recognition.onend = () => {
    if (gen !== listenGen) { log('onend STALE gen:', gen, 'listenGen:', listenGen); return; }
    log('onend gen:', gen);
    elMicDot.className = '';
    setStatus('RECONNECTING...');
    setTimeout(() => {
      if (gen !== listenGen) return;
      log('onend restart gen:', gen);
      startListening();
    }, 400);
  };

  recognition.onerror = (e) => {
    if (gen !== listenGen) return;
    if (e.error === 'not-allowed') { setStatus('MIC ACCESS DENIED'); stopRecognition(); }
    // 'aborted', 'no-speech' are expected — ignore silently
    else if (e.error !== 'aborted' && e.error !== 'no-speech') {
      log('onerror:', e.error);
      setStatus(`ERROR: ${e.error.toUpperCase()}`);
    }
  };

  recognition.onresult = async (event) => {
    if (gen !== listenGen) { log('onresult STALE gen:', gen); return; }

    let interimText = '';
    let finalText   = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const t = event.results[i][0].transcript.trim();
      if (event.results[i].isFinal) finalText   += t;
      else                           interimText += t;
    }

    if (interimText) {
      elInterim.textContent = interimText;
      elInterim.classList.add('visible');
    }
    if (finalText) {
      log('finalText:', finalText, 'gen:', gen);
      elInterim.classList.remove('visible');
      elInterim.textContent = '';
      await showSubtitle(finalText, gen);
    }
  };

  recognition.start();
}

async function showSubtitle(heard, fromGen) {
  // If a newer recognition session started while we were awaiting, drop this result.
  if (fromGen !== listenGen) { log('showSubtitle STALE, dropping'); return; }

  elSource.textContent = heard;
  elSource.classList.add('visible');
  elTarget.textContent = '·  ·  ·';
  elTarget.classList.add('visible');
  clearTimeout(fadeTimer);

  const direction  = mode === 'listen' ? 'to-english' : 'to-cantonese';
  const translated = await translateText(heard, direction);

  // Re-check after the async gap.
  if (fromGen !== listenGen && mode === 'listen') { log('showSubtitle STALE after translate'); return; }

  elTarget.textContent = translated;

  if (mode === 'speak') {
    lastCantonese = translated;
    elPlayWrap.classList.add('visible');
    speakCantonese(translated);
  } else {
    fadeTimer = setTimeout(() => {
      elSource.classList.remove('visible');
      elTarget.classList.remove('visible');
      // Safety net: restart if recognition dropped while subtitle was showing.
      if (listenGen === fromGen) startListening();
    }, SUBTITLE_MS);
  }
}

async function speakCantonese(text) {
  const mySpeak = ++speakGen;
  log('speakCantonese speakGen:', mySpeak);

  // Cancel any in-progress audio or speech from a previous call.
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
  speechSynthesis.cancel();

  // Stop recognition so the mic doesn't pick up the speaker output.
  stopRecognition();
  elMicDot.className = 'speaking';
  setStatus('SPEAKING...');

  let done = false;
  const watchdog = setTimeout(() => {
    log('watchdog fired for speakGen:', mySpeak);
    onFinished();
  }, 10000);

  function onFinished() {
    if (done) return;
    if (mySpeak !== speakGen) { log('onFinished STALE speakGen:', mySpeak, 'current:', speakGen); clearTimeout(watchdog); return; }
    done = true;
    clearTimeout(watchdog);
    log('onFinished — restarting listen after fade');
    elMicDot.className = '';
    fadeTimer = setTimeout(() => {
      elSource.classList.remove('visible');
      elTarget.classList.remove('visible');
      if (mode === 'speak' && mySpeak === speakGen) {
        log('restarting mic after fade');
        startListening();
      }
    }, 2000);
  }

  try {
    log('fetching TTS...');
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });

    if (mySpeak !== speakGen) { log('fetch done but speakGen stale'); clearTimeout(watchdog); return; }
    if (!res.ok) throw new Error(`TTS HTTP ${res.status}`);

    const blob     = await res.blob();
    const audioUrl = URL.createObjectURL(blob);
    currentAudio   = new Audio(audioUrl);
    log('playing audio...');

    currentAudio.onended = () => { log('audio ended'); URL.revokeObjectURL(audioUrl); currentAudio = null; onFinished(); };
    currentAudio.onerror = (e) => { log('audio error', e); URL.revokeObjectURL(audioUrl); currentAudio = null; onFinished(); };
    currentAudio.play().catch(e => { log('play() rejected', e); URL.revokeObjectURL(audioUrl); currentAudio = null; onFinished(); });

  } catch (err) {
    log('TTS fetch failed, using Web Speech fallback:', err.message);
    if (mySpeak !== speakGen) { clearTimeout(watchdog); return; }
    const utterance   = new SpeechSynthesisUtterance(text);
    utterance.lang    = 'zh-HK';
    utterance.rate    = 0.88;
    utterance.onend   = () => { log('utterance ended'); onFinished(); };
    utterance.onerror = (e) => { log('utterance error', e.error); onFinished(); };
    speechSynthesis.speak(utterance);
  }
}

async function translateText(text, direction = 'to-english') {
  try {
    const res = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, direction }),
    });
    if (!res.ok) return '[translation error]';
    const data = await res.json();
    return data.translation || '[no translation]';
  } catch {
    return '[translation unavailable]';
  }
}

elListenBtn.addEventListener('click', () => switchMode('listen'));
elSpeakBtn.addEventListener('click',  () => switchMode('speak'));
elPlayBtn.addEventListener('click',   () => { if (lastCantonese) speakCantonese(lastCantonese); });
elClearBtn.addEventListener('click',  () => {
  log('clear clicked');
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
  speechSynthesis.cancel();
  speakGen++;
  stopRecognition();
  clearSubtitles();
  startListening();
});

document.addEventListener('DOMContentLoaded', () => {
  updateModeUI();
  startListening();

  const elOnboarding = document.getElementById('onboarding');
  const SEEN_KEY = 'canto_seen';

  if (!localStorage.getItem(SEEN_KEY)) {
    elOnboarding.style.display = 'flex';
    const dismiss = () => {
      localStorage.setItem(SEEN_KEY, '1');
      elOnboarding.style.transition = 'opacity 0.4s ease';
      elOnboarding.style.opacity = '0';
      setTimeout(() => { elOnboarding.style.display = 'none'; }, 400);
    };
    document.getElementById('onboarding-dismiss').addEventListener('click', dismiss);
    setTimeout(dismiss, 8000);
  }
});

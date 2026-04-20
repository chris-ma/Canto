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
let stopping      = false;
let isListening   = false;
let mode          = 'listen';
let lastCantonese = '';
let listenGen     = 0;   // incremented whenever we intentionally stop recognition;
                         // callbacks capture their gen at creation and bail if stale

const SUBTITLE_MS = 5000;

function setStatus(text) {
  elStatus.textContent = text;
}

function updateModeUI() {
  document.body.className = `mode-${mode}`;
  elListenBtn.classList.toggle('active', mode === 'listen');
  elSpeakBtn.classList.toggle('active', mode === 'speak');
  elMicDot.className = '';
  clearSubtitles();
}

function clearSubtitles() {
  clearTimeout(fadeTimer);
  elInterim.textContent = '';
  elInterim.classList.remove('visible');
  elSource.textContent = '';
  elSource.classList.remove('visible');
  elTarget.textContent = '';
  elTarget.classList.remove('visible');
  lastCantonese = '';
  elPlayWrap.classList.remove('visible');
}

// Stop recognition and invalidate all pending callbacks from the current generation.
function stopRecognition() {
  stopping = true;
  listenGen++;
  isListening = false;
  if (recognition) {
    recognition.abort();
    recognition = null;
  }
}

function switchMode(newMode) {
  if (mode === newMode) return;
  mode = newMode;
  updateModeUI();

  stopRecognition();
  speechSynthesis.cancel();
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }

  setTimeout(() => {
    stopping = false;
    startListening();
  }, 300);
}

function startListening() {
  if (!SpeechRecognition) {
    elBrowserWarn.style.display = 'block';
    setStatus('UNSUPPORTED BROWSER');
    return;
  }

  const gen = ++listenGen;  // this recognition's identity

  recognition = new SpeechRecognition();
  recognition.lang = mode === 'listen' ? 'zh-HK' : 'en-US';
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    if (gen !== listenGen) return;
    isListening = true;
    setStatus(mode === 'listen' ? 'LISTENING...' : 'SPEAK NOW...');
    elMicDot.className = 'active';
  };

  recognition.onend = () => {
    if (gen !== listenGen) return;  // stale — abort or switch already happened, ignore
    isListening = false;
    elMicDot.className = '';
    if (stopping) return;
    setStatus('RECONNECTING...');
    setTimeout(() => {
      if (gen === listenGen && !stopping) startListening();
    }, 400);
  };

  recognition.onerror = (e) => {
    if (gen !== listenGen) return;
    if (e.error === 'not-allowed') {
      setStatus('MIC ACCESS DENIED');
      stopping = true;
    }
    // 'aborted' and 'no-speech' are expected — silently ignore
  };

  recognition.onresult = async (event) => {
    if (gen !== listenGen) return;  // stale, ignore

    let interimText = '';
    let finalText   = '';

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript.trim();
      if (event.results[i].isFinal) {
        finalText += transcript;
      } else {
        interimText += transcript;
      }
    }

    if (interimText) {
      elInterim.textContent = interimText;
      elInterim.classList.add('visible');
    }

    if (finalText) {
      elInterim.classList.remove('visible');
      elInterim.textContent = '';
      await showSubtitle(finalText);
    }
  };

  recognition.start();
}

async function showSubtitle(heard) {
  elSource.textContent = heard;
  elSource.classList.add('visible');
  elTarget.textContent = '·  ·  ·';
  elTarget.classList.add('visible');
  clearTimeout(fadeTimer);

  const direction = mode === 'listen' ? 'to-english' : 'to-cantonese';
  const translated = await translateText(heard, direction);
  elTarget.textContent = translated;

  if (mode === 'speak') {
    lastCantonese = translated;
    elPlayWrap.classList.add('visible');
    speakCantonese(translated);
  } else {
    fadeTimer = setTimeout(() => {
      elSource.classList.remove('visible');
      elTarget.classList.remove('visible');
      if (!stopping && !isListening) startListening();
    }, SUBTITLE_MS);
  }
}

async function speakCantonese(text) {
  stopRecognition();   // invalidate current gen — no stale onend can restart the mic
  elMicDot.className = 'speaking';
  setStatus('SPEAKING...');

  // Guard against resume() being called twice (e.g. both onended and onerror fire)
  let resumed = false;
  // Watchdog: if TTS events never fire (missing voice, blocked autoplay), force recovery
  const watchdog = setTimeout(() => doResume(), 20000);

  function doResume() {
    if (resumed) return;
    resumed = true;
    clearTimeout(watchdog);
    elMicDot.className = '';
    fadeTimer = setTimeout(() => {
      elSource.classList.remove('visible');
      elTarget.classList.remove('visible');
      if (mode === 'speak') {
        stopping = false;
        startListening();
      }
    }, 2000);
  }

  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });

    if (!res.ok) throw new Error('TTS API error');

    const blob     = await res.blob();
    const audioUrl = URL.createObjectURL(blob);
    currentAudio   = new Audio(audioUrl);

    currentAudio.onended = () => { URL.revokeObjectURL(audioUrl); currentAudio = null; doResume(); };
    currentAudio.onerror = () => { URL.revokeObjectURL(audioUrl); currentAudio = null; doResume(); };
    currentAudio.play().catch(() => { URL.revokeObjectURL(audioUrl); currentAudio = null; doResume(); });
  } catch {
    // Fallback: Web Speech API
    const utterance   = new SpeechSynthesisUtterance(text);
    utterance.lang    = 'zh-HK';
    utterance.rate    = 0.88;
    utterance.onend   = doResume;
    utterance.onerror = doResume;
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
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
  speechSynthesis.cancel();
  stopRecognition();
  stopping = false;
  clearSubtitles();
  startListening();
});

document.addEventListener('DOMContentLoaded', () => {
  updateModeUI();
  startListening();
});

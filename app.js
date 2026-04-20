const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

const elStatus      = document.getElementById('status');
const elMicDot      = document.getElementById('mic-dot');
const elInterim     = document.getElementById('subtitle-interim');
const elSource      = document.getElementById('subtitle-cantonese'); // heard text
const elTarget      = document.getElementById('subtitle-english');   // translated text
const elBrowserWarn = document.getElementById('browser-warn');
const elListenBtn   = document.getElementById('listenBtn');
const elSpeakBtn    = document.getElementById('speakBtn');
const elPlayWrap    = document.getElementById('play-btn-wrap');
const elPlayBtn     = document.getElementById('playBtn');

let recognition   = null;
let fadeTimer     = null;
let stopping      = false;
let isListening   = false;
let mode          = 'listen';
let lastCantonese = '';

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

function switchMode(newMode) {
  if (mode === newMode) return;
  mode = newMode;
  updateModeUI();

  stopping = true;
  speechSynthesis.cancel();
  if (recognition) {
    recognition.abort();
    recognition = null;
  }
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

  stopping = false;
  recognition = new SpeechRecognition();
  recognition.lang = mode === 'listen' ? 'zh-HK' : 'en-US';
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    isListening = true;
    setStatus(mode === 'listen' ? 'LISTENING...' : 'SPEAK NOW...');
    elMicDot.className = 'active';
  };

  recognition.onend = () => {
    isListening = false;
    elMicDot.className = '';
    if (stopping) return;
    setStatus('RECONNECTING...');
    setTimeout(startListening, 400);
  };

  recognition.onerror = (e) => {
    if (e.error === 'not-allowed') {
      setStatus('MIC ACCESS DENIED');
      stopping = true;
    } else if (e.error !== 'no-speech') {
      setStatus(`ERROR: ${e.error.toUpperCase()}`);
    }
  };

  recognition.onresult = async (event) => {
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
      // Restart if recognition dropped during the display window
      if (!stopping && !isListening) startListening();
    }, SUBTITLE_MS);
  }
}

async function speakCantonese(text) {
  // Pause mic while TTS speaks to prevent feedback loop
  stopping = true;
  if (recognition) {
    recognition.abort();
    recognition = null;
  }
  elMicDot.className = 'speaking';
  setStatus('SPEAKING...');

  const resume = () => {
    fadeTimer = setTimeout(() => {
      elSource.classList.remove('visible');
      elTarget.classList.remove('visible');
    }, 2000);
    if (mode === 'speak') {
      stopping = false;
      startListening();
    }
  };

  try {
    // Use server-side Google TTS proxy — zh-yue is real Cantonese
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });

    if (!res.ok) throw new Error('TTS API error');

    const blob    = await res.blob();
    const audioUrl = URL.createObjectURL(blob);
    const audio   = new Audio(audioUrl);

    audio.onended = () => { URL.revokeObjectURL(audioUrl); resume(); };
    audio.onerror = () => { URL.revokeObjectURL(audioUrl); resume(); };
    audio.play().catch(() => { URL.revokeObjectURL(audioUrl); resume(); });
  } catch {
    // Fallback: Web Speech API (accent may vary by OS)
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang  = 'zh-HK';
    utterance.rate  = 0.88;
    utterance.onend   = resume;
    utterance.onerror = resume;
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

document.addEventListener('DOMContentLoaded', () => {
  updateModeUI();
  startListening();
});

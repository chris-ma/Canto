const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

const elStatus      = document.getElementById('status');
const elMicDot      = document.getElementById('mic-dot');
const elInterim     = document.getElementById('subtitle-interim');
const elSource      = document.getElementById('subtitle-cantonese'); // heard text
const elTarget      = document.getElementById('subtitle-english');   // translated text
const elBrowserWarn = document.getElementById('browser-warn');
const elListenBtn   = document.getElementById('listenBtn');
const elSpeakBtn    = document.getElementById('speakBtn');

let recognition = null;
let fadeTimer   = null;
let stopping    = false;
let mode        = 'listen'; // 'listen' | 'speak'

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
    setStatus(mode === 'listen' ? 'LISTENING...' : 'SPEAK NOW...');
    elMicDot.className = 'active';
  };

  recognition.onend = () => {
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
    speakCantonese(translated);
  } else {
    fadeTimer = setTimeout(() => {
      elSource.classList.remove('visible');
      elTarget.classList.remove('visible');
    }, SUBTITLE_MS);
  }
}

function speakCantonese(text) {
  speechSynthesis.cancel();

  // Pause mic while TTS speaks to prevent feedback loop
  stopping = true;
  if (recognition) {
    recognition.abort();
    recognition = null;
  }
  elMicDot.className = 'speaking';
  setStatus('SPEAKING...');

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'zh-HK';
  utterance.rate = 0.88;
  utterance.pitch = 1.0;

  // Prefer a Cantonese/Chinese voice if available
  const voices = speechSynthesis.getVoices();
  const voice = voices.find(v => v.lang === 'zh-HK')
    || voices.find(v => v.lang === 'zh-TW')
    || voices.find(v => v.lang.startsWith('zh'));
  if (voice) utterance.voice = voice;

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

  utterance.onend   = resume;
  utterance.onerror = resume;

  speechSynthesis.speak(utterance);
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

document.addEventListener('DOMContentLoaded', () => {
  updateModeUI();
  startListening();
});

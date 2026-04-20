const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

const elStatus     = document.getElementById('status');
const elStartBtn   = document.getElementById('startBtn');
const elStopBtn    = document.getElementById('stopBtn');
const elInterim    = document.getElementById('subtitle-interim');
const elCantonese  = document.getElementById('subtitle-cantonese');
const elEnglish    = document.getElementById('subtitle-english');
const elShowCant   = document.getElementById('showCantonese');
const elBrowserWarn = document.getElementById('browser-warn');

let recognition = null;
let fadeTimer   = null;
const SUBTITLE_MS = 5000;

// Check browser compatibility
if (!SpeechRecognition) {
  elBrowserWarn.style.display = 'block';
  elStartBtn.disabled = true;
  elStatus.textContent = 'UNSUPPORTED BROWSER';
}

function setStatus(text, listening = false) {
  elStatus.textContent = text;
  elStatus.className = listening ? 'listening' : '';
}

function startListening() {
  recognition = new SpeechRecognition();
  recognition.lang = 'zh-HK';
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    setStatus('LISTENING...', true);
    elStartBtn.disabled = true;
    elStopBtn.disabled  = false;
  };

  recognition.onend = () => {
    // Auto-restart if stop wasn't requested (e.g., timeout)
    if (!elStartBtn.disabled) return;
    setStatus('RECONNECTING...', false);
    setTimeout(() => {
      if (!elStartBtn.disabled) recognition.start();
    }, 300);
  };

  recognition.onerror = (e) => {
    if (e.error === 'not-allowed') {
      setStatus('MIC ACCESS DENIED');
      stopListening();
    } else if (e.error === 'no-speech') {
      // Silently ignore — recognition will auto-continue
    } else {
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

    // Show interim Cantonese immediately while speaking
    if (interimText) {
      elInterim.textContent = interimText;
      elInterim.classList.add('visible');
    }

    // On final result: translate and show subtitle
    if (finalText) {
      elInterim.classList.remove('visible');
      elInterim.textContent = '';
      await showSubtitle(finalText);
    }
  };

  recognition.start();
}

function stopListening() {
  if (recognition) {
    recognition.stop();
    recognition = null;
  }
  elStartBtn.disabled = false;
  elStopBtn.disabled  = true;
  setStatus('IDLE');
}

async function showSubtitle(cantonese) {
  // Show Cantonese immediately
  if (elShowCant.checked) {
    elCantonese.textContent = cantonese;
    elCantonese.classList.add('visible');
  }

  // Placeholder English while translating
  elEnglish.textContent = '...';
  elEnglish.classList.add('visible');

  // Reset fade-out timer
  clearTimeout(fadeTimer);

  // Fetch translation
  const english = await translateText(cantonese);
  elEnglish.textContent = english;

  // Auto-hide after SUBTITLE_MS
  fadeTimer = setTimeout(() => {
    elEnglish.classList.remove('visible');
    elCantonese.classList.remove('visible');
  }, SUBTITLE_MS);
}

async function translateText(text) {
  try {
    const res = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) return '[translation error]';
    const data = await res.json();
    return data.translation || '[no translation]';
  } catch {
    return '[translation unavailable]';
  }
}

// Wiring up buttons
elStartBtn.addEventListener('click', startListening);
elStopBtn.addEventListener('click', stopListening);

// Hide Cantonese line when checkbox unchecked mid-session
elShowCant.addEventListener('change', () => {
  if (!elShowCant.checked) {
    elCantonese.classList.remove('visible');
    elCantonese.textContent = '';
  }
});

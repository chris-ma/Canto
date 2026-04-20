const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

const elStatus      = document.getElementById('status');
const elMicDot      = document.getElementById('mic-dot');
const elInterim     = document.getElementById('subtitle-interim');
const elCantonese   = document.getElementById('subtitle-cantonese');
const elEnglish     = document.getElementById('subtitle-english');
const elBrowserWarn = document.getElementById('browser-warn');

let recognition  = null;
let fadeTimer    = null;
let stopping     = false;
const SUBTITLE_MS = 5000;

function setStatus(text, listening = false) {
  elStatus.textContent = text;
  elMicDot.className = listening ? 'listening' : '';
}

function startListening() {
  if (!SpeechRecognition) {
    elBrowserWarn.style.display = 'block';
    setStatus('UNSUPPORTED BROWSER');
    return;
  }

  stopping = false;
  recognition = new SpeechRecognition();
  recognition.lang = 'zh-HK';
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => setStatus('LISTENING...', true);

  recognition.onend = () => {
    if (stopping) return;
    setStatus('RECONNECTING...');
    setTimeout(startListening, 400);
  };

  recognition.onerror = (e) => {
    if (e.error === 'not-allowed') {
      setStatus('MIC ACCESS DENIED');
      stopping = true;
    } else if (e.error === 'no-speech') {
      // Silently ignore — onend will auto-restart
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

async function showSubtitle(cantonese) {
  elCantonese.textContent = cantonese;
  elCantonese.classList.add('visible');

  elEnglish.textContent = '·  ·  ·';
  elEnglish.classList.add('visible');

  clearTimeout(fadeTimer);

  const english = await translateText(cantonese);
  elEnglish.textContent = english;

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

document.addEventListener('DOMContentLoaded', startListening);

export interface Env {
  DISCORD_WEBHOOK_URL: string;
  AUDIO_BUCKET: R2Bucket;
  ADMIN_SECRET: string;
}

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
const ALLOWED_AUDIO_PREFIXES = [
  "audio/webm",
  "audio/mp4",
  "audio/wav",
  "audio/mpeg",
  "audio/ogg",
  "audio/mp3",
];

const rateLimits = new Map<string, RateLimitEntry>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimits.get(ip);
  if (!entry) {
    rateLimits.set(ip, { count: 1, windowStart: now });
    return true;
  }
  if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimits.set(ip, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) {
    return false;
  }
  entry.count++;
  return true;
}

function getClientIP(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for") ||
    "unknown"
  );
}

function isAllowedAudioType(type: string): boolean {
  return ALLOWED_AUDIO_PREFIXES.some((prefix) => type.startsWith(prefix));
}

function hashKey(twitter: string, secret: string): string {
  // Simple hash using Web Crypto API
  const encoder = new TextEncoder();
  const data = encoder.encode(`${twitter.toLowerCase().trim()}:${secret.trim()}`);
  return crypto.subtle.digest("SHA-256", data).then((buf) => {
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  });
}

function htmlPage(session: string, version: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>kimiflare feedback</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #f5f5f4;
    --card: #ffffff;
    --text: #1c1917;
    --text-muted: #57534e;
    --text-faint: #a8a29e;
    --accent: #f48120;
    --accent-hover: #e06b0a;
    --accent-soft: #fff7ed;
    --border: #d6d3d1;
    --font-sans: 'Inter', system-ui, -apple-system, sans-serif;
    --font-mono: 'JetBrains Mono', 'SF Mono', monospace;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--font-sans);
    background: var(--bg);
    color: var(--text);
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    padding: 16px;
    -webkit-font-smoothing: antialiased;
  }
  .card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 28px 32px;
    max-width: 520px;
    width: 100%;
    text-align: left;
    box-shadow: 0 8px 32px rgba(0,0,0,0.08);
  }
  .header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 16px;
  }
  .logo-icon {
    width: 24px;
    height: 24px;
    flex-shrink: 0;
    border-radius: 4px;
  }
  .logo-text {
    font-family: var(--font-mono);
    font-weight: 600;
    font-size: 0.8rem;
    color: var(--accent);
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }
  h1 { margin: 0 0 4px; font-size: 20px; font-weight: 700; color: var(--text); letter-spacing: -0.02em; }
  p.sub { margin: 0 0 16px; font-size: 14px; color: var(--text-muted); }
  .record-box {
    background: var(--bg);
    border: 1.5px dashed var(--border);
    border-radius: 10px;
    padding: 20px;
    text-align: center;
    margin-bottom: 16px;
    transition: all 0.2s;
  }
  .record-box.active {
    border-style: solid;
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    border: none;
    border-radius: 8px;
    padding: 10px 22px;
    font-family: var(--font-sans);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }
  .btn:hover { opacity: 0.9; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-record { background: var(--accent); color: #fff; }
  .btn-record:hover { background: var(--accent-hover); }
  .btn-stop { background: #dc2626; color: #fff; }
  .btn-stop:hover { background: #b91c1c; }
  .btn-play { background: var(--text); color: #fff; }
  .btn-send { background: var(--accent); color: #fff; }
  .btn-send:hover { background: var(--accent-hover); }
  .btn-secondary { background: var(--card); color: var(--text-muted); border: 1px solid var(--border); font-weight: 500; }
  .btn-secondary:hover { border-color: var(--text-faint); color: var(--text); }
  .timer {
    font-family: var(--font-mono);
    font-size: 32px;
    font-weight: 500;
    color: var(--text);
    margin: 2px 0 8px;
    font-variant-numeric: tabular-nums;
  }
  .actions { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
  .hidden { display: none !important; }
  .fields { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
  .field { text-align: left; }
  .field label {
    display: block;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-muted);
    margin-bottom: 4px;
  }
  .field input, .field textarea {
    width: 100%;
    background: var(--card);
    border: 1.5px solid var(--border);
    border-radius: 8px;
    padding: 9px 12px;
    color: var(--text);
    font-family: var(--font-sans);
    font-size: 14px;
    outline: none;
    transition: all 0.15s;
  }
  .field input:focus, .field textarea:focus { border-color: var(--accent); }
  .field textarea { resize: none; min-height: 40px; height: 40px; }
  .field input::placeholder, .field textarea::placeholder { color: var(--text-faint); }
  .privacy { font-size: 12px; color: var(--text-faint); line-height: 1.5; }
  .status { margin-top: 10px; font-size: 13px; min-height: 18px; font-weight: 500; }
  .status.ok { color: #16a34a; }
  .status.err { color: #dc2626; }
  .waveform { height: 32px; display: flex; align-items: center; justify-content: center; gap: 3px; margin: 8px 0; }
  .bar { width: 3px; background: var(--accent); border-radius: 2px; animation: bounce 0.5s infinite ease-in-out alternate; }
  @keyframes bounce { from { height: 3px; } to { height: 24px; } }
  .record-area { min-height: 60px; display: flex; flex-direction: column; align-items: center; justify-content: center; }
  @media (max-width: 480px) {
    .card { padding: 20px 18px; border-radius: 12px; }
    h1 { font-size: 18px; }
    .fields { grid-template-columns: 1fr; gap: 10px; }
    .record-box { padding: 16px; }
    .timer { font-size: 28px; }
  }
</style>
</head>
<body>
<div class="card">
  <div class="header">
    <img class="logo-icon" src="https://sinameraji.github.io/kimiflare/logo.png" alt="">
    <div class="logo-text">kimiflare</div>
  </div>
  <h1>Hey, how do you like v${escapeHtml(version)}?</h1>
  <p class="sub">Send me a voice note. Only I see it.</p>

  <div class="record-box" id="record-box">
    <div id="step-record" class="record-area">
      <button id="btn-record" class="btn btn-record">● Record</button>
      <div class="waveform hidden" id="waveform">
        <div class="bar" style="animation-delay:0s"></div>
        <div class="bar" style="animation-delay:0.08s"></div>
        <div class="bar" style="animation-delay:0.16s"></div>
        <div class="bar" style="animation-delay:0.24s"></div>
        <div class="bar" style="animation-delay:0.32s"></div>
      </div>
      <div class="timer hidden" id="timer">00:00</div>
    </div>

    <div id="step-review" class="hidden">
      <div class="timer" id="duration">00:00</div>
      <div class="actions">
        <button id="btn-play" class="btn btn-play">▶ Play</button>
        <button id="btn-rerecord" class="btn btn-secondary">↻ Re-record</button>
        <button id="btn-send" class="btn btn-send">✉ Send</button>
      </div>
    </div>

    <div id="step-sent" class="hidden" style="text-align:center;">
      <div style="font-size:42px;margin-bottom:8px;">✅</div>
      <div style="font-size:16px;font-weight:600;color:var(--text);margin-bottom:4px;">Sent!</div>
      <div style="font-size:14px;color:var(--text-muted);">Thanks for the feedback. You can close this tab.</div>
    </div>
  </div>

  <div class="fields">
    <div class="field">
      <label for="text-note">Note (optional)</label>
      <textarea id="text-note" placeholder="Type instead..."></textarea>
    </div>
    <div class="field">
      <label for="contact">Contact (optional)</label>
      <input id="contact" type="text" placeholder="Email or X">
    </div>
  </div>

  <p class="privacy">I will personally reply.</p>
  <div class="status" id="status"></div>
</div>

<script>
  const session = ${JSON.stringify(session)};
  const version = ${JSON.stringify(version)};
  let mediaRecorder = null;
  let chunks = [];
  let audioBlob = null;
  let audioUrl = null;
  let audioPlayer = null;
  let startTime = 0;
  let timerInterval = null;
  let stream = null;
  let isRecording = false;

  const $ = id => document.getElementById(id);
  const fmt = s => String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');

  function setStatus(msg, ok) {
    const el = $('status');
    el.textContent = msg;
    el.className = 'status ' + (ok ? 'ok' : 'err');
  }

  function startTimer() {
    startTime = Date.now();
    $('timer').classList.remove('hidden');
    timerInterval = setInterval(() => {
      const sec = Math.floor((Date.now() - startTime) / 1000);
      $('timer').textContent = fmt(sec);
    }, 1000);
  }

  function stopTimer() {
    clearInterval(timerInterval);
    const sec = Math.floor((Date.now() - startTime) / 1000);
    $('duration').textContent = fmt(sec);
    return sec;
  }

  function reset() {
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    if (audioPlayer) { audioPlayer.pause(); audioPlayer = null; }
    if (audioUrl) { URL.revokeObjectURL(audioUrl); audioUrl = null; }
    audioBlob = null;
    chunks = [];
    mediaRecorder = null;
    isRecording = false;
    $('record-box').classList.remove('active');
    $('step-record').classList.remove('hidden');
    $('step-review').classList.add('hidden');
    $('step-sent').classList.add('hidden');
    $('waveform').classList.add('hidden');
    $('timer').classList.add('hidden');
    $('btn-record').textContent = '● Record';
    $('btn-record').className = 'btn btn-record';
    setStatus('');
  }

  function stopRecording() {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') return;
    mediaRecorder.stop();
    if (stream) { stream.getTracks().forEach(t => t.stop()); }
    stopTimer();
    isRecording = false;
  }

  $('btn-record').addEventListener('click', async () => {
    if (isRecording) {
      stopRecording();
      return;
    }

    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      setStatus('Microphone access denied. Please allow it and try again.', false);
      return;
    }

    const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' :
                 MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '';
    mediaRecorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    chunks = [];
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    mediaRecorder.onstop = () => {
      const type = mime || 'audio/webm';
      audioBlob = new Blob(chunks, { type });
      audioUrl = URL.createObjectURL(audioBlob);
      $('step-record').classList.add('hidden');
      $('step-review').classList.remove('hidden');
    };
    mediaRecorder.start(100);
    isRecording = true;
    $('record-box').classList.add('active');
    $('btn-record').textContent = '■ Stop';
    $('btn-record').className = 'btn btn-stop';
    $('waveform').classList.remove('hidden');
    startTimer();
  });

  $('btn-play').addEventListener('click', () => {
    if (!audioUrl) return;
    if (audioPlayer) { audioPlayer.pause(); audioPlayer = null; $('btn-play').textContent = '▶ Play'; return; }
    audioPlayer = new Audio(audioUrl);
    audioPlayer.play();
    $('btn-play').textContent = '⏸ Pause';
    audioPlayer.onended = () => { audioPlayer = null; $('btn-play').textContent = '▶ Play'; };
  });

  $('btn-rerecord').addEventListener('click', reset);

  $('btn-send').addEventListener('click', async () => {
    if (!audioBlob) return;
    const textNote = $('text-note').value.trim();
    const contact = $('contact').value.trim();

    const form = new FormData();
    form.append('audio', audioBlob, 'voice-note.webm');
    form.append('session', session);
    form.append('version', version);
    if (textNote) form.append('text', textNote);
    if (contact) form.append('contact', contact);

    $('btn-send').disabled = true;
    $('btn-send').textContent = 'Sending...';
    setStatus('');

    try {
      const res = await fetch('/upload', { method: 'POST', body: form });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(body || 'Upload failed');
      }
      $('step-review').classList.add('hidden');
      $('step-sent').classList.remove('hidden');
      $('text-note').disabled = true;
      $('contact').disabled = true;
    } catch (e) {
      setStatus('Failed to send: ' + e.message, false);
      $('btn-send').disabled = false;
      $('btn-send').textContent = '✉ Send';
    }
  });
</script>
</body>
</html>`;
}

function inboxPlayerPage(twitter: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>kimiflare inbox</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #f5f5f4;
    --card: #ffffff;
    --text: #1c1917;
    --text-muted: #57534e;
    --text-faint: #a8a29e;
    --accent: #f48120;
    --accent-hover: #e06b0a;
    --accent-soft: #fff7ed;
    --border: #d6d3d1;
    --font-sans: 'Inter', system-ui, -apple-system, sans-serif;
    --font-mono: 'JetBrains Mono', 'SF Mono', monospace;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--font-sans);
    background: var(--bg);
    color: var(--text);
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    padding: 16px;
    -webkit-font-smoothing: antialiased;
  }
  .card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 28px 32px;
    max-width: 520px;
    width: 100%;
    text-align: center;
    box-shadow: 0 8px 32px rgba(0,0,0,0.08);
  }
  .header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 16px;
    justify-content: center;
  }
  .logo-icon { width: 24px; height: 24px; flex-shrink: 0; border-radius: 4px; }
  .logo-text {
    font-family: var(--font-mono);
    font-weight: 600;
    font-size: 0.8rem;
    color: var(--accent);
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }
  h1 { margin: 0 0 4px; font-size: 20px; font-weight: 700; color: var(--text); letter-spacing: -0.02em; }
  p.sub { margin: 0 0 20px; font-size: 14px; color: var(--text-muted); }
  .player-box {
    background: var(--bg);
    border: 1.5px dashed var(--border);
    border-radius: 10px;
    padding: 24px;
    margin-bottom: 16px;
  }
  audio { width: 100%; outline: none; }
  .status { margin-top: 10px; font-size: 13px; min-height: 18px; font-weight: 500; }
  .status.ok { color: #16a34a; }
  .status.err { color: #dc2626; }
  .privacy { font-size: 12px; color: var(--text-faint); line-height: 1.5; margin-top: 12px; }
  @media (max-width: 480px) {
    .card { padding: 20px 18px; border-radius: 12px; }
    h1 { font-size: 18px; }
  }
</style>
</head>
<body>
<div class="card">
  <div class="header">
    <img class="logo-icon" src="https://sinameraji.github.io/kimiflare/logo.png" alt="">
    <div class="logo-text">kimiflare</div>
  </div>
  <h1>Hey, @${escapeHtml(twitter)}!</h1>
  <p class="sub">Sina sent you a voice note.</p>
  <div class="player-box">
    <audio id="player" controls></audio>
    <div class="status" id="status">Loading...</div>
  </div>
  <p class="privacy">This message is private. Don't share this link.</p>
</div>
<script>
  const urlParams = new URLSearchParams(window.location.search);
  const twitter = urlParams.get('u');
  const secret = urlParams.get('s');
  const statusEl = document.getElementById('status');
  const player = document.getElementById('player');

  async function loadAudio() {
    try {
      const res = await fetch('/inbox/audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ twitter, secret })
      });
      if (!res.ok) {
        const text = await res.text().catch(() => 'Failed to load audio');
        throw new Error(text);
      }
      const blob = await res.blob();
      player.src = URL.createObjectURL(blob);
      statusEl.textContent = '';
      statusEl.className = 'status';
    } catch (e) {
      statusEl.textContent = e.message;
      statusEl.className = 'status err';
    }
  }
  loadAudio();
</script>
</body>
</html>`;
}

function adminPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>kimiflare admin</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #f5f5f4;
    --card: #ffffff;
    --text: #1c1917;
    --text-muted: #57534e;
    --text-faint: #a8a29e;
    --accent: #f48120;
    --accent-hover: #e06b0a;
    --accent-soft: #fff7ed;
    --border: #d6d3d1;
    --font-sans: 'Inter', system-ui, -apple-system, sans-serif;
    --font-mono: 'JetBrains Mono', 'SF Mono', monospace;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--font-sans);
    background: var(--bg);
    color: var(--text);
    padding: 24px;
    -webkit-font-smoothing: antialiased;
  }
  .container { max-width: 900px; margin: 0 auto; }
  h1 { font-size: 24px; font-weight: 700; margin-bottom: 16px; }
  h2 { font-size: 18px; font-weight: 600; margin: 24px 0 12px; }
  .card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 20px;
    margin-bottom: 16px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.06);
  }
  .note-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 0;
    border-bottom: 1px solid var(--border);
  }
  .note-row:last-child { border-bottom: none; }
  .note-info { flex: 1; }
  .note-contact { font-weight: 600; font-size: 14px; }
  .note-meta { font-size: 12px; color: var(--text-muted); margin-top: 2px; }
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    border: none;
    border-radius: 8px;
    padding: 8px 16px;
    font-family: var(--font-sans);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }
  .btn:hover { opacity: 0.9; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-primary { background: var(--accent); color: #fff; }
  .btn-secondary { background: var(--card); color: var(--text-muted); border: 1px solid var(--border); }
  .record-box {
    background: var(--bg);
    border: 1.5px dashed var(--border);
    border-radius: 10px;
    padding: 20px;
    text-align: center;
    margin-bottom: 16px;
  }
  .record-box.active {
    border-style: solid;
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .field { margin-bottom: 12px; }
  .field label { display: block; font-size: 12px; font-weight: 600; color: var(--text-muted); margin-bottom: 4px; }
  .field input {
    width: 100%;
    background: var(--card);
    border: 1.5px solid var(--border);
    border-radius: 8px;
    padding: 9px 12px;
    color: var(--text);
    font-family: var(--font-sans);
    font-size: 14px;
    outline: none;
  }
  .field input:focus { border-color: var(--accent); }
  .status { margin-top: 10px; font-size: 13px; min-height: 18px; font-weight: 500; }
  .status.ok { color: #16a34a; }
  .status.err { color: #dc2626; }
  .hidden { display: none !important; }
  .waveform { height: 32px; display: flex; align-items: center; justify-content: center; gap: 3px; margin: 8px 0; }
  .bar { width: 3px; background: var(--accent); border-radius: 2px; animation: bounce 0.5s infinite ease-in-out alternate; }
  @keyframes bounce { from { height: 3px; } to { height: 24px; } }
</style>
</head>
<body>
<div class="container">
  <h1>kimiflare admin</h1>

  <div class="card">
    <h2>New Reply</h2>
    <div class="field">
      <label>Twitter username</label>
      <input id="new-twitter" type="text" placeholder="e.g. alex">
    </div>
    <div class="field">
      <label>Secret</label>
      <input id="new-secret" type="text" placeholder="e.g. coffee">
    </div>
    <div class="record-box" id="record-box">
      <div id="step-record">
        <button id="btn-record" class="btn btn-primary">● Record</button>
        <div class="waveform hidden" id="waveform">
          <div class="bar" style="animation-delay:0s"></div>
          <div class="bar" style="animation-delay:0.08s"></div>
          <div class="bar" style="animation-delay:0.16s"></div>
          <div class="bar" style="animation-delay:0.24s"></div>
          <div class="bar" style="animation-delay:0.32s"></div>
        </div>
      </div>
      <div id="step-review" class="hidden">
        <div class="actions">
          <button id="btn-play" class="btn btn-secondary">▶ Play</button>
          <button id="btn-rerecord" class="btn btn-secondary">↻ Re-record</button>
          <button id="btn-send" class="btn btn-primary">✉ Send</button>
        </div>
      </div>
    </div>
    <div class="status" id="new-status"></div>
  </div>

  <div class="card">
    <h2>Incoming Voice Notes</h2>
    <div id="notes-list">Loading...</div>
  </div>
</div>

<script>
  const urlParams = new URLSearchParams(window.location.search);
  const adminKey = urlParams.get('key');

  let mediaRecorder = null;
  let chunks = [];
  let audioBlob = null;
  let audioUrl = null;
  let audioPlayer = null;
  let stream = null;
  let isRecording = false;

  const $ = id => document.getElementById(id);

  function setStatus(msg, ok, elId = 'new-status') {
    const el = $(elId);
    el.textContent = msg;
    el.className = 'status ' + (ok ? 'ok' : 'err');
  }

  function reset() {
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    if (audioPlayer) { audioPlayer.pause(); audioPlayer = null; }
    if (audioUrl) { URL.revokeObjectURL(audioUrl); audioUrl = null; }
    audioBlob = null;
    chunks = [];
    mediaRecorder = null;
    isRecording = false;
    $('record-box').classList.remove('active');
    $('step-record').classList.remove('hidden');
    $('step-review').classList.add('hidden');
    $('waveform').classList.add('hidden');
    $('btn-record').textContent = '● Record';
    $('btn-record').className = 'btn btn-primary';
  }

  $('btn-record').addEventListener('click', async () => {
    if (isRecording) {
      if (!mediaRecorder || mediaRecorder.state === 'inactive') return;
      mediaRecorder.stop();
      if (stream) { stream.getTracks().forEach(t => t.stop()); }
      isRecording = false;
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      setStatus('Microphone access denied.', false);
      return;
    }
    const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' :
                 MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '';
    mediaRecorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    chunks = [];
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    mediaRecorder.onstop = () => {
      const type = mime || 'audio/webm';
      audioBlob = new Blob(chunks, { type });
      audioUrl = URL.createObjectURL(audioBlob);
      $('step-record').classList.add('hidden');
      $('step-review').classList.remove('hidden');
    };
    mediaRecorder.start(100);
    isRecording = true;
    $('record-box').classList.add('active');
    $('btn-record').textContent = '■ Stop';
    $('btn-record').className = 'btn btn-secondary';
    $('waveform').classList.remove('hidden');
  });

  $('btn-play').addEventListener('click', () => {
    if (!audioUrl) return;
    if (audioPlayer) { audioPlayer.pause(); audioPlayer = null; $('btn-play').textContent = '▶ Play'; return; }
    audioPlayer = new Audio(audioUrl);
    audioPlayer.play();
    $('btn-play').textContent = '⏸ Pause';
    audioPlayer.onended = () => { audioPlayer = null; $('btn-play').textContent = '▶ Play'; };
  });

  $('btn-rerecord').addEventListener('click', reset);

  $('btn-send').addEventListener('click', async () => {
    if (!audioBlob) return;
    const twitter = $('new-twitter').value.trim();
    const secret = $('new-secret').value.trim();
    if (!twitter || !secret) {
      setStatus('Enter both Twitter username and secret.', false);
      return;
    }
    const form = new FormData();
    form.append('audio', audioBlob, 'reply.webm');
    form.append('twitter', twitter);
    form.append('secret', secret);
    form.append('adminKey', adminKey);
    $('btn-send').disabled = true;
    $('btn-send').textContent = 'Sending...';
    try {
      const res = await fetch('/admin/reply', { method: 'POST', body: form });
      if (!res.ok) {
        const body = await res.text().catch(() => 'Upload failed');
        throw new Error(body);
      }
      setStatus('Reply sent!', true);
      reset();
      $('new-twitter').value = '';
      $('new-secret').value = '';
      loadNotes();
    } catch (e) {
      setStatus('Failed: ' + e.message, false);
    } finally {
      $('btn-send').disabled = false;
      $('btn-send').textContent = '✉ Send';
    }
  });

  async function loadNotes() {
    const list = $('notes-list');
    try {
      const res = await fetch('/admin/notes?key=' + encodeURIComponent(adminKey));
      if (!res.ok) throw new Error('Failed to load');
      const notes = await res.json();
      if (notes.length === 0) {
        list.innerHTML = '<p style="color:var(--text-muted)">No voice notes yet.</p>';
        return;
      }
      list.innerHTML = notes.map(n => \`
        <div class="note-row">
          <div class="note-info">
            <div class="note-contact">\${escapeHtml(n.contact || 'Anonymous')}</div>
            <div class="note-meta">\${escapeHtml(n.version)} · \${new Date(n.createdAt).toLocaleString()}</div>
          </div>
          <audio controls src="/audio/\${encodeURIComponent(n.audioKey)}" style="width:200px"></audio>
          <button class="btn btn-primary" onclick="fillReply('\${escapeHtml(n.contact || '')}')">Reply</button>
        </div>
      \`).join('');
    } catch (e) {
      list.innerHTML = '<p class="status err">Failed to load notes</p>';
    }
  }

  function fillReply(contact) {
    if (contact) $('new-twitter').value = contact.replace(/^@/, '');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  loadNotes();
</script>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getAudioExtension(type: string): string {
  if (type.startsWith("audio/webm")) return "webm";
  if (type.startsWith("audio/mp4")) return "m4a";
  if (type.startsWith("audio/wav")) return "wav";
  if (type.startsWith("audio/mpeg") || type.startsWith("audio/mp3")) return "mp3";
  if (type.startsWith("audio/ogg")) return "ogg";
  return "bin";
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Serve audio files from R2 — ONLY voice-notes/*
    const audioMatch = url.pathname.match(/^\/audio\/(.+)$/);
    if (audioMatch && request.method === "GET") {
      const key = audioMatch[1];
      if (!key.startsWith("voice-notes/")) {
        return new Response("Not found.", { status: 404 });
      }
      console.log(`[audio] serving key=${key}`);
      try {
        const object = await env.AUDIO_BUCKET.get(key);
        if (!object) {
          console.log(`[audio] not found key=${key}`);
          return new Response("Not found.", { status: 404 });
        }
        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set("etag", object.httpEtag);
        headers.set("content-type", object.httpMetadata?.contentType ?? "audio/webm");
        headers.set("accept-ranges", "bytes");
        console.log(`[audio] served key=${key} size=${object.size}`);
        return new Response(object.body, { headers });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[audio] error key=${key} msg=${msg}`);
        return new Response(`Failed to retrieve audio: ${msg}`, { status: 500 });
      }
    }

    if (url.pathname === "/upload" && request.method === "POST") {
      const ip = getClientIP(request);
      console.log(`[upload] request from ip=${ip}`);

      if (!checkRateLimit(ip)) {
        console.log(`[upload] rate limited ip=${ip}`);
        return new Response("Rate limit exceeded. Try again later.", {
          status: 429,
          headers: { "Access-Control-Allow-Origin": "*" },
        });
      }

      let form: FormData;
      try {
        form = await request.formData();
      } catch {
        console.log(`[upload] invalid form data ip=${ip}`);
        return new Response("Invalid form data.", {
          status: 400,
          headers: { "Access-Control-Allow-Origin": "*" },
        });
      }

      const audio = form.get("audio");
      if (!audio || !(audio instanceof File)) {
        console.log(`[upload] missing audio file ip=${ip}`);
        return new Response("Missing audio file.", {
          status: 400,
          headers: { "Access-Control-Allow-Origin": "*" },
        });
      }

      if (audio.size > MAX_FILE_SIZE) {
        console.log(`[upload] file too large ip=${ip} size=${audio.size}`);
        return new Response("File too large. Max 50 MB.", {
          status: 413,
          headers: { "Access-Control-Allow-Origin": "*" },
        });
      }

      if (!isAllowedAudioType(audio.type)) {
        console.log(`[upload] unsupported audio type ip=${ip} type=${audio.type}`);
        return new Response(`Unsupported audio type: ${audio.type}`, {
          status: 400,
          headers: { "Access-Control-Allow-Origin": "*" },
        });
      }

      const session = String(form.get("session") || "unknown").slice(0, 64);
      const version = String(form.get("version") || "unknown").slice(0, 32);
      const text = String(form.get("text") || "").slice(0, 2000);
      const contact = String(form.get("contact") || "").slice(0, 256);

      console.log(
        `[upload] validated ip=${ip} session=${session} version=${version} size=${audio.size} type=${audio.type}`
      );

      // Upload to R2
      const ext = getAudioExtension(audio.type);
      const r2Key = `voice-notes/${session}-${Date.now()}.${ext}`;
      try {
        await env.AUDIO_BUCKET.put(r2Key, audio.stream(), {
          httpMetadata: { contentType: audio.type },
        });
        console.log(`[upload] r2 put success key=${r2Key}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[upload] r2 put failed key=${r2Key} msg=${msg}`);
        return new Response(`Failed to store audio: ${msg}`, {
          status: 502,
          headers: { "Access-Control-Allow-Origin": "*" },
        });
      }

      // Store metadata JSON
      const metaKey = `voice-notes/meta/${session}.json`;
      try {
        await env.AUDIO_BUCKET.put(
          metaKey,
          JSON.stringify({ session, version, text, contact, audioKey: r2Key, createdAt: Date.now() }),
          { httpMetadata: { contentType: "application/json" } }
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[upload] meta put failed key=${metaKey} msg=${msg}`);
      }

      // Build public link
      const audioUrl = `${url.origin}/audio/${r2Key}`;

      // Build Discord webhook payload (text-only)
      const contentParts: string[] = [];
      contentParts.push(`🎙️ Voice note from kimiflare v${version}`);
      contentParts.push(`Session: \`${session}\``);
      if (contact) contentParts.push(`Contact: ${contact}`);
      if (text) contentParts.push(`Text note: ${text}`);
      contentParts.push(`Link: ${audioUrl}`);

      // Discord content limit is 2000 chars; truncate text note if needed
      let content = contentParts.join("\n");
      if (content.length > 2000) {
        const overhead = content.length - (text?.length ?? 0);
        const maxText = Math.max(0, 2000 - overhead - 3);
        const safeText = text.slice(0, maxText) + (text.length > maxText ? "..." : "");
        const safeParts: string[] = [];
        safeParts.push(`🎙️ Voice note from kimiflare v${version}`);
        safeParts.push(`Session: \`${session}\``);
        if (contact) safeParts.push(`Contact: ${contact}`);
        if (safeText) safeParts.push(`Text note: ${safeText}`);
        safeParts.push(`Link: ${audioUrl}`);
        content = safeParts.join("\n");
      }

      try {
        const discordRes = await fetch(env.DISCORD_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        });
        if (!discordRes.ok) {
          const body = await discordRes.text().catch(() => "");
          throw new Error(`Discord returned ${discordRes.status}: ${body}`);
        }
        console.log(`[upload] discord webhook ok session=${session}`);
        return new Response("OK", {
          status: 200,
          headers: { "Access-Control-Allow-Origin": "*" },
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[upload] discord webhook failed session=${session} msg=${msg}`);
        return new Response(`Failed to forward to Discord: ${msg}`, {
          status: 502,
          headers: { "Access-Control-Allow-Origin": "*" },
        });
      }
    }

    // ── Inbox: check if a reply exists ──
    if (url.pathname === "/inbox/check" && request.method === "GET") {
      const twitter = String(url.searchParams.get("u") || "").trim().toLowerCase();
      const secret = String(url.searchParams.get("s") || "").trim();
      if (!twitter || !secret) {
        return new Response(JSON.stringify({ hasMessage: false }), {
          status: 200,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
      }
      const h = await hashKey(twitter, secret);
      const indexKey = `replies/index/${h}.json`;
      try {
        const obj = await env.AUDIO_BUCKET.get(indexKey);
        if (!obj) {
          return new Response(JSON.stringify({ hasMessage: false }), {
            status: 200,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
          });
        }
        const meta = await obj.json<{ createdAt: number }>();
        return new Response(JSON.stringify({ hasMessage: true, createdAt: meta.createdAt }), {
          status: 200,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
      } catch {
        return new Response(JSON.stringify({ hasMessage: false }), {
          status: 200,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
      }
    }

    // ── Inbox: HTML player page ──
    if (url.pathname === "/inbox" && request.method === "GET") {
      const twitter = String(url.searchParams.get("u") || "").trim();
      if (!twitter) {
        return new Response("Not found.", { status: 404 });
      }
      return new Response(inboxPlayerPage(twitter), {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // ── Inbox: fetch audio blob (POST to avoid caching / link sharing) ──
    if (url.pathname === "/inbox/audio" && request.method === "POST") {
      let body: { twitter?: string; secret?: string };
      try {
        body = await request.json();
      } catch {
        return new Response("Invalid JSON.", { status: 400 });
      }
      const twitter = String(body.twitter || "").trim().toLowerCase();
      const secret = String(body.secret || "").trim();
      if (!twitter || !secret) {
        return new Response("Missing credentials.", { status: 400 });
      }
      const h = await hashKey(twitter, secret);
      const indexKey = `replies/index/${h}.json`;
      let audioKey: string;
      try {
        const obj = await env.AUDIO_BUCKET.get(indexKey);
        if (!obj) {
          return new Response("No message found.", { status: 404 });
        }
        const meta = await obj.json<{ audioKey: string }>();
        audioKey = meta.audioKey;
      } catch {
        return new Response("No message found.", { status: 404 });
      }
      try {
        const audioObj = await env.AUDIO_BUCKET.get(audioKey);
        if (!audioObj) {
          return new Response("Audio not found.", { status: 404 });
        }
        const headers = new Headers();
        audioObj.writeHttpMetadata(headers);
        headers.set("etag", audioObj.httpEtag);
        headers.set("content-type", audioObj.httpMetadata?.contentType ?? "audio/webm");
        return new Response(audioObj.body, { headers });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return new Response(`Failed to retrieve audio: ${msg}`, { status: 500 });
      }
    }

    // ── Admin: list incoming notes ──
    if (url.pathname === "/admin/notes" && request.method === "GET") {
      const key = url.searchParams.get("key");
      if (key !== env.ADMIN_SECRET) {
        return new Response("Unauthorized.", { status: 401 });
      }
      try {
        const listed = await env.AUDIO_BUCKET.list({ prefix: "voice-notes/meta/" });
        const notes: Array<{
          contact: string;
          version: string;
          createdAt: number;
          audioKey: string;
        }> = [];
        for (const item of listed.objects || []) {
          try {
            const obj = await env.AUDIO_BUCKET.get(item.key);
            if (!obj) continue;
            const meta = await obj.json<{
              contact?: string;
              version?: string;
              createdAt?: number;
              audioKey?: string;
            }>();
            if (meta.audioKey) {
              notes.push({
                contact: meta.contact || "Anonymous",
                version: meta.version || "unknown",
                createdAt: meta.createdAt || 0,
                audioKey: meta.audioKey,
              });
            }
          } catch {
            // skip corrupt meta
          }
        }
        notes.sort((a, b) => b.createdAt - a.createdAt);
        return new Response(JSON.stringify(notes), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return new Response(`Failed to list notes: ${msg}`, { status: 500 });
      }
    }

    // ── Admin: upload reply ──
    if (url.pathname === "/admin/reply" && request.method === "POST") {
      let form: FormData;
      try {
        form = await request.formData();
      } catch {
        return new Response("Invalid form data.", { status: 400 });
      }
      const adminKey = String(form.get("adminKey") || "");
      if (adminKey !== env.ADMIN_SECRET) {
        return new Response("Unauthorized.", { status: 401 });
      }
      const audio = form.get("audio");
      if (!audio || !(audio instanceof File)) {
        return new Response("Missing audio file.", { status: 400 });
      }
      if (audio.size > MAX_FILE_SIZE) {
        return new Response("File too large. Max 50 MB.", { status: 413 });
      }
      if (!isAllowedAudioType(audio.type)) {
        return new Response(`Unsupported audio type: ${audio.type}`, { status: 400 });
      }
      const twitter = String(form.get("twitter") || "").trim().toLowerCase();
      const secret = String(form.get("secret") || "").trim();
      if (!twitter || !secret) {
        return new Response("Missing twitter or secret.", { status: 400 });
      }

      const ext = getAudioExtension(audio.type);
      const audioKey = `replies/audio/${crypto.randomUUID()}.${ext}`;
      try {
        await env.AUDIO_BUCKET.put(audioKey, audio.stream(), {
          httpMetadata: { contentType: audio.type },
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return new Response(`Failed to store audio: ${msg}`, { status: 502 });
      }

      const h = await hashKey(twitter, secret);
      const indexKey = `replies/index/${h}.json`;
      try {
        await env.AUDIO_BUCKET.put(
          indexKey,
          JSON.stringify({ audioKey, createdAt: Date.now() }),
          { httpMetadata: { contentType: "application/json" } }
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return new Response(`Failed to store index: ${msg}`, { status: 502 });
      }

      return new Response("OK", { status: 200 });
    }

    // ── Admin: HTML panel ──
    if (url.pathname === "/admin" && request.method === "GET") {
      const key = url.searchParams.get("key");
      if (key !== env.ADMIN_SECRET) {
        return new Response("Unauthorized.", { status: 401 });
      }
      return new Response(adminPage(), {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    if (url.pathname === "/" && request.method === "GET") {
      const session = url.searchParams.get("s");
      const version = url.searchParams.get("v") || "unknown";
      if (!session || !/^[0-9a-f\-]{36,64}$/i.test(session)) {
        return new Response("Not found.", { status: 404 });
      }
      return new Response(htmlPage(session, version), {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    return new Response("Not found.", { status: 404 });
  },
};

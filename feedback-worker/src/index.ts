export interface Env {
  DISCORD_WEBHOOK_URL: string;
}

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_AUDIO_TYPES = new Set([
  "audio/webm",
  "audio/mp4",
  "audio/wav",
  "audio/mpeg",
  "audio/ogg",
  "audio/mp3",
]);

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

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/upload" && request.method === "POST") {
      const ip = getClientIP(request);
      if (!checkRateLimit(ip)) {
        return new Response("Rate limit exceeded. Try again later.", {
          status: 429,
          headers: { "Access-Control-Allow-Origin": "*" },
        });
      }

      let form: FormData;
      try {
        form = await request.formData();
      } catch {
        return new Response("Invalid form data.", {
          status: 400,
          headers: { "Access-Control-Allow-Origin": "*" },
        });
      }

      const audio = form.get("audio");
      if (!audio || !(audio instanceof File)) {
        return new Response("Missing audio file.", {
          status: 400,
          headers: { "Access-Control-Allow-Origin": "*" },
        });
      }

      if (audio.size > MAX_FILE_SIZE) {
        return new Response("File too large. Max 10 MB.", {
          status: 413,
          headers: { "Access-Control-Allow-Origin": "*" },
        });
      }

      if (!ALLOWED_AUDIO_TYPES.has(audio.type)) {
        return new Response(`Unsupported audio type: ${audio.type}`, {
          status: 400,
          headers: { "Access-Control-Allow-Origin": "*" },
        });
      }

      const session = String(form.get("session") || "unknown").slice(0, 64);
      const version = String(form.get("version") || "unknown").slice(0, 32);
      const text = String(form.get("text") || "").slice(0, 2000);
      const contact = String(form.get("contact") || "").slice(0, 256);

      // Build Discord webhook payload
      const discordForm = new FormData();
      const contentParts: string[] = [];
      contentParts.push(`🎙️ Voice note from kimiflare v${version}`);
      contentParts.push(`Session: \`${session}\``);
      if (contact) contentParts.push(`Contact: ${contact}`);
      if (text) contentParts.push(`Text note: ${text}`);
      discordForm.append("content", contentParts.join("\n"));
      discordForm.append("file", audio, audio.name || "voice-note.webm");

      try {
        const discordRes = await fetch(env.DISCORD_WEBHOOK_URL, {
          method: "POST",
          body: discordForm,
        });
        if (!discordRes.ok) {
          const body = await discordRes.text().catch(() => "");
          throw new Error(`Discord returned ${discordRes.status}: ${body}`);
        }
        return new Response("OK", {
          status: 200,
          headers: { "Access-Control-Allow-Origin": "*" },
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return new Response(`Failed to forward to Discord: ${msg}`, {
          status: 502,
          headers: { "Access-Control-Allow-Origin": "*" },
        });
      }
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

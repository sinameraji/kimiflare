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
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: #0d1117;
    color: #c9d1d9;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    padding: 24px;
  }
  .card {
    background: #161b22;
    border: 1px solid #30363d;
    border-radius: 12px;
    padding: 32px;
    max-width: 420px;
    width: 100%;
    text-align: center;
  }
  h1 { margin: 0 0 8px; font-size: 20px; color: #f0f6fc; }
  p.sub { margin: 0 0 24px; font-size: 14px; color: #8b949e; }
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    border: none;
    border-radius: 8px;
    padding: 12px 24px;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.15s;
  }
  .btn:hover { opacity: 0.9; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-record { background: #238636; color: #fff; }
  .btn-stop { background: #da3633; color: #fff; }
  .btn-play { background: #1f6feb; color: #fff; }
  .btn-send { background: #8957e5; color: #fff; }
  .btn-secondary { background: #21262d; color: #c9d1d9; border: 1px solid #30363d; }
  .timer { font-size: 28px; font-weight: 700; color: #f0f6fc; margin: 16px 0; font-variant-numeric: tabular-nums; }
  .actions { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; margin-top: 16px; }
  .hidden { display: none !important; }
  .field { margin-top: 16px; text-align: left; }
  .field label { display: block; font-size: 12px; color: #8b949e; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.05em; }
  .field input, .field textarea {
    width: 100%;
    background: #0d1117;
    border: 1px solid #30363d;
    border-radius: 6px;
    padding: 10px 12px;
    color: #c9d1d9;
    font-size: 14px;
    outline: none;
  }
  .field input:focus, .field textarea:focus { border-color: #58a6ff; }
  .field textarea { resize: vertical; min-height: 60px; }
  .privacy { margin-top: 20px; font-size: 12px; color: #484f58; }
  .status { margin-top: 16px; font-size: 14px; min-height: 20px; }
  .status.ok { color: #3fb950; }
  .status.err { color: #f85149; }
  .waveform { height: 40px; display: flex; align-items: center; justify-content: center; gap: 3px; margin: 12px 0; }
  .bar { width: 4px; background: #58a6ff; border-radius: 2px; animation: bounce 0.6s infinite ease-in-out alternate; }
  @keyframes bounce { from { height: 4px; } to { height: 32px; } }
</style>
</head>
<body>
<div class="card">
  <h1>Hey, how do you like v${escapeHtml(version)}?</h1>
  <p class="sub">Record a voice note for Sina. Only he sees it.</p>

  <div id="step-record">
    <button id="btn-record" class="btn btn-record">● Record</button>
    <div class="waveform hidden" id="waveform">
      <div class="bar" style="animation-delay:0s"></div>
      <div class="bar" style="animation-delay:0.1s"></div>
      <div class="bar" style="animation-delay:0.2s"></div>
      <div class="bar" style="animation-delay:0.3s"></div>
      <div class="bar" style="animation-delay:0.4s"></div>
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

  <div class="field">
    <label for="text-note">Text note (optional)</label>
    <textarea id="text-note" placeholder="Or type your feedback here..."></textarea>
  </div>

  <div class="field">
    <label for="contact">Email or X/Twitter (optional)</label>
    <input id="contact" type="text" placeholder="so Sina can reply">
  </div>

  <p class="privacy">No marketing, ever. This goes straight to Sina.</p>
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
    $('step-record').classList.remove('hidden');
    $('step-review').classList.add('hidden');
    $('waveform').classList.add('hidden');
    $('timer').classList.add('hidden');
    $('btn-record').classList.remove('hidden');
    $('btn-record').textContent = '● Record';
    $('btn-record').className = 'btn btn-record';
    setStatus('');
  }

  $('btn-record').addEventListener('click', async () => {
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
    $('btn-record').classList.add('hidden');
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
      setStatus('Sent! Thanks for the feedback. You can close this tab.', true);
      $('step-review').classList.add('hidden');
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

// @rust-exception rationale: This is a visual verification script that depends on
// Playwright (a Node.js browser automation framework) for headless Chromium
// screenshotting. The ANSI-to-HTML conversion is trivial glue code; the actual
// rendering engine is a browser. Rewriting the Playwright dependency chain in
// Rust would be impractical and provide no value for a test-time screenshot tool.
const { execSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

async function capture(cols, outPath, command) {
  const session = "kf-d-" + Date.now();
  const tmuxCmd = 'cd /Volumes/BIWIN/CODES/kimiflare && XDG_CONFIG_HOME=/tmp/kf-config npx tsx src/index.tsx';
  execSync(`tmux new-session -d -s ${session} -x ${cols} -y 24 "${tmuxCmd}"`);
  execSync("sleep 2");
  if (command) {
    for (const ch of command) {
      execSync(`tmux send-keys -t ${session} "${ch}"`);
      execSync("sleep 0.3");
    }
    execSync("sleep 0.5");
  }
  execSync(`tmux capture-pane -e -t ${session} -p > /tmp/${session}.ansi`);
  execSync(`tmux kill-session -t ${session} 2>/dev/null`);

  const ansi = fs.readFileSync(`/tmp/${session}.ansi`, "utf-8");

  let html = "";
  let fg = null, bg = null, bold = false;
  let inSpan = false;
  function open() {
    if (inSpan) html += "</span>";
    const s = [];
    if (fg) s.push("color:" + fg);
    if (bg) s.push("background:" + bg);
    if (bold) s.push("font-weight:bold");
    html += s.length ? '<span style="' + s.join(";") + '">' : "";
    inSpan = s.length > 0;
  }
  function reset() { if (inSpan) { html += "</span>"; inSpan = false; } fg = bg = null; bold = false; }

  const re = /\x1b\[([0-9;]*)m/g;
  let last = 0;
  let m;
  while ((m = re.exec(ansi)) !== null) {
    const raw = ansi.slice(last, m.index);
    for (const ch of raw) {
      if (ch === "&") html += "&amp;";
      else if (ch === "<") html += "&lt;";
      else if (ch === ">") html += "&gt;";
      else if (ch === " ") html += "&nbsp;";
      else html += ch;
    }
    const codes = m[1].split(";").map(s => s === "" ? 0 : parseInt(s));
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i];
      if (c === 0) reset();
      else if (c === 1) bold = true;
      else if (c === 22) bold = false;
      else if (c === 38 && codes[i+1] === 2) { fg = "rgb(" + codes[i+2] + "," + codes[i+3] + "," + codes[i+4] + ")"; i += 4; }
      else if (c === 39) fg = null;
      else if (c === 48 && codes[i+1] === 2) { bg = "rgb(" + codes[i+2] + "," + codes[i+3] + "," + codes[i+4] + ")"; i += 4; }
      else if (c === 49) bg = null;
    }
    open();
    last = re.lastIndex;
  }
  const tail = ansi.slice(last);
  for (const ch of tail) {
    if (ch === "&") html += "&amp;";
    else if (ch === "<") html += "&lt;";
    else if (ch === ">") html += "&gt;";
    else if (ch === " ") html += "&nbsp;";
    else html += ch;
  }
  if (inSpan) html += "</span>";

  const pageHtml = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
    "body{margin:0;padding:20px;background:#1a1a1a;font-family:\"SF Mono\",Monaco,monospace;font-size:14px;line-height:1.4}" +
    ".term{display:inline-block;white-space:pre;background:#0d0d0d;padding:12px;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,0.6)}" +
    '</style></head><body><div class="term">' + html + '</div></body></html>';

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kf-"));
  const htmlPath = path.join(tmpDir, "t.html");
  fs.writeFileSync(htmlPath, pageHtml);

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({width: 1400, height: 700});
  await page.goto("file://" + htmlPath);
  await page.locator(".term").screenshot({path: outPath, type: "png"});
  await browser.close();
  console.log("Saved:", outPath);
}

(async () => {
  await capture(80, "/tmp/kf-dark-ready.png", "");
  await capture(80, "/tmp/kf-dark-slash.png", "/");
  await capture(80, "/tmp/kf-dark-theme.png", "/theme");
  await capture(60, "/tmp/kf-dark-slash-60.png", "/");
  await capture(120, "/tmp/kf-dark-slash-120.png", "/");
})();

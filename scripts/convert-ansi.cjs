// @rust-exception rationale: Companion to capture-terminal.cjs — depends on
// Playwright for headless Chromium screenshotting. The ANSI parsing is simple
// regex + string building; the heavy lifting is done by the browser engine.
const fs = require("fs");
const os = require("os");
const path = require("path");

function ansiToHtml(ansi) {
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
  return html;
}

async function convert(ansiPath, outPath) {
  const ansi = fs.readFileSync(ansiPath, "utf-8");
  const html = ansiToHtml(ansi);

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

const ansiFile = process.argv[2];
const outFile = process.argv[3];
if (!ansiFile || !outFile) {
  console.log("Usage: node convert-ansi.cjs <input.ansi> <output.png>");
  process.exit(1);
}
convert(ansiFile, outFile);

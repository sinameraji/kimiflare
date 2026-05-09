#!/usr/bin/env node
// @rust-exception rationale: Terminal screenshot utility for design review — requires Playwright/Node.js DOM access unavailable in Rust.
/**
 * Terminal-to-PNG capture pipeline.
 *
 * Steps:
 * 1. Run kimiflare in tmux at specified width, capture pane with ANSI codes
 * 2. Convert ANSI escape sequences to HTML with CSS color styling
 * 3. Use Playwright to screenshot the HTML to PNG
 *
 * Usage:
 *   node scripts/capture-terminal.mjs <width> <output.png> [command]
 *
 * Example:
 *   node scripts/capture-terminal.mjs 80 /tmp/kf-80.png
 *   node scripts/capture-terminal.mjs 80 /tmp/kf-slash.png '/'
 */

import { chromium } from "playwright";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const COLS = parseInt(process.argv[2] ?? "80", 10);
const OUT_PATH = process.argv[3] ?? "/tmp/kf-terminal.png";
const COMMAND = process.argv[4] ?? ""; // e.g. "/" to trigger slash picker

const SESSION = `kf-cap-${Date.now()}`;
const TMUX_CMD = `cd /Volumes/BIWIN/CODES/kimiflare && npx tsx src/index.tsx`;

// ── 1. Capture ANSI output from tmux ──
console.log(`Capturing at ${COLS} cols...`);

execSync(`tmux new-session -d -s ${SESSION} -x ${COLS} -y 24 "${TMUX_CMD}"`);
execSync(`sleep 2`);

if (COMMAND) {
  for (const ch of COMMAND) {
    execSync(`tmux send-keys -t ${SESSION} "${ch}"`);
    execSync(`sleep 0.3`);
  }
  if (COMMAND === "/") {
    execSync(`sleep 0.5`);
  }
}

execSync(`tmux capture-pane -e -t ${SESSION} -p > /tmp/${SESSION}.ansi`);
execSync(`tmux kill-session -t ${SESSION} 2>/dev/null`);

const ansi = readFileSync(`/tmp/${SESSION}.ansi`, "utf-8");

// ── 2. ANSI → HTML converter (24-bit color + basic SGR) ──
function ansiToHtmlV2(text) {
  const cleaned = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\x1b\[\?25[lh]/g, "")
    .replace(/\x1b\[2J/g, "")
    .replace(/\x1b\[H/g, "")
    .replace(/\x1b\[\d+;\d+H/g, ""); // cursor position

  let result = "";
  let inSpan = false;
  let fg = null,
    bg = null,
    bold = false,
    dim = false;

  function openSpan() {
    if (inSpan) result += "</span>";
    const s = [];
    if (fg) s.push(`color:${fg}`);
    if (bg) s.push(`background:${bg}`);
    if (bold) s.push("font-weight:bold");
    if (dim) s.push("opacity:0.5");
    result += s.length ? `<span style="${s.join(";")}">` : "";
    inSpan = s.length > 0;
  }

  function reset() {
    if (inSpan) {
      result += "</span>";
      inSpan = false;
    }
    fg = bg = null;
    bold = dim = false;
  }

  const re = /\x1b\[([0-9;]*)m/g;
  let last = 0;
  let m;

  while ((m = re.exec(cleaned)) !== null) {
    const raw = cleaned.slice(last, m.index);
    for (const ch of raw) {
      switch (ch) {
        case "&":
          result += "&amp;";
          break;
        case "<":
          result += "&lt;";
          break;
        case ">":
          result += "&gt;";
          break;
        case " ":
          result += "&nbsp;";
          break;
        default:
          result += ch;
      }
    }

    const codes = m[1].split(";").map((s) => (s === "" ? 0 : parseInt(s, 10)));
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i];
      switch (c) {
        case 0:
          reset();
          break;
        case 1:
          bold = true;
          break;
        case 2:
          dim = true;
          break;
        case 22:
          bold = false;
          break;
        case 38:
          if (codes[i + 1] === 2) {
            fg = `rgb(${codes[i + 2]},${codes[i + 3]},${codes[i + 4]})`;
            i += 4;
          }
          break;
        case 39:
          fg = null;
          break;
        case 48:
          if (codes[i + 1] === 2) {
            bg = `rgb(${codes[i + 2]},${codes[i + 3]},${codes[i + 4]})`;
            i += 4;
          }
          break;
        case 49:
          bg = null;
          break;
      }
    }
    openSpan();
    last = re.lastIndex;
  }

  const tail = cleaned.slice(last);
  for (const ch of tail) {
    switch (ch) {
      case "&":
        result += "&amp;";
        break;
      case "<":
        result += "&lt;";
        break;
      case ">":
        result += "&gt;";
        break;
      case " ":
        result += "&nbsp;";
        break;
      default:
        result += ch;
    }
  }
  if (inSpan) result += "</span>";

  return result;
}

const htmlBody = ansiToHtmlV2(ansi);

const pageHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
body {
  margin: 0;
  padding: 20px;
  background: #1a1a1a;
  font-family: "SF Mono", "Monaco", "Inconsolata", "Fira Code", "Consolas", monospace;
  font-size: 14px;
  line-height: 1.4;
}
.terminal {
  display: inline-block;
  white-space: pre;
  background: #1e1e1e;
  padding: 12px;
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.4);
}
</style>
</head>
<body>
<div class="terminal">${htmlBody}</div>
</body>
</html>`;

const tmpDir = mkdtempSync(join(tmpdir(), "kf-html-"));
const htmlPath = join(tmpDir, "terminal.html");
writeFileSync(htmlPath, pageHtml);

// ── 3. Screenshot with Playwright ──
console.log("Rendering to PNG...");
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setViewportSize({ width: 1200, height: 600 });
await page.goto(`file://${htmlPath}`);

const terminal = await page.locator(".terminal");
await terminal.screenshot({ path: OUT_PATH, type: "png" });
await browser.close();

console.log(`Saved: ${OUT_PATH}`);

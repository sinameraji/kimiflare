import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const LOG_DIR = join(homedir(), ".config", "kimiflare");
const LOG_FILE = join(LOG_DIR, "memory.log");

function ensureDir() {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
  } catch {
    // ignore
  }
}

export function logMemory(label: string) {
  try {
    ensureDir();
    const mem = process.memoryUsage();
    const line = `${new Date().toISOString()}  ${label.padEnd(40)}  rss=${(mem.rss / 1024 / 1024).toFixed(1)}MB  heapUsed=${(mem.heapUsed / 1024 / 1024).toFixed(1)}MB  heapTotal=${(mem.heapTotal / 1024 / 1024).toFixed(1)}MB  external=${(mem.external / 1024 / 1024).toFixed(1)}MB  arrayBuffers=${(mem.arrayBuffers / 1024 / 1024).toFixed(1)}MB\n`;
    appendFileSync(LOG_FILE, line);
  } catch {
    // Non-fatal — don't crash the TUI if logging fails
  }
}

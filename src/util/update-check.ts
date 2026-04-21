import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const NPM_REGISTRY = "https://registry.npmjs.org/kimiflare/latest";

interface CacheEntry {
  checkedAt: number;
  latestVersion: string;
  hasUpdate: boolean;
}

function cachePath(): string {
  const xdg = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(xdg, "kimiflare", "update-check.json");
}

function localPackageJsonPath(): string {
  // When bundled, __dirname is dist/. Go up one level to find package.json.
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "package.json");
}

async function readLocalVersion(): Promise<string | null> {
  try {
    const raw = await readFile(localPackageJsonPath(), "utf8");
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? null;
  } catch {
    return null;
  }
}

async function readCache(): Promise<CacheEntry | null> {
  try {
    const raw = await readFile(cachePath(), "utf8");
    const parsed = JSON.parse(raw) as CacheEntry;
    if (Date.now() - parsed.checkedAt < CACHE_TTL_MS) {
      return parsed;
    }
  } catch {
    /* cache missing or expired */
  }
  return null;
}

async function writeCache(entry: CacheEntry): Promise<void> {
  const p = cachePath();
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(entry), "utf8");
}

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const res = await fetch(NPM_REGISTRY, {
      headers: { "User-Agent": "kimiflare-update-checker", Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    return data.version ?? null;
  } catch {
    return null;
  }
}

function stripV(v: string): string {
  return v.startsWith("v") ? v.slice(1) : v;
}

function isNewer(local: string, remote: string): boolean {
  const a = stripV(local).split(".").map(Number);
  const b = stripV(remote).split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av < bv) return true;
    if (av > bv) return false;
  }
  return false;
}

export interface UpdateCheckResult {
  hasUpdate: boolean;
  localVersion: string | null;
  latestVersion: string | null;
}

export async function checkForUpdate(): Promise<UpdateCheckResult> {
  const localVersion = await readLocalVersion();
  if (!localVersion) return { hasUpdate: false, localVersion: null, latestVersion: null };

  const cached = await readCache();
  if (cached) {
    return { hasUpdate: cached.hasUpdate, localVersion, latestVersion: cached.latestVersion };
  }

  const latestVersion = await fetchLatestVersion();
  if (!latestVersion) {
    return { hasUpdate: false, localVersion, latestVersion: null };
  }

  const hasUpdate = isNewer(localVersion, latestVersion);
  await writeCache({ checkedAt: Date.now(), latestVersion, hasUpdate });
  return { hasUpdate, localVersion, latestVersion };
}

export async function isGitRepo(): Promise<boolean> {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    await access(join(here, "..", "..", ".git"));
    return true;
  } catch {
    return false;
  }
}

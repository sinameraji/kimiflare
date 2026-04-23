import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const NPM_REGISTRY = "https://registry.npmjs.org/kimiflare/latest";

interface CacheEntry {
  checkedAt: number;
  latestVersion: string;
}

function cachePath(): string {
  const xdg = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(xdg, "kimiflare", "update-check.json");
}

async function findPackageJson(startDir: string): Promise<{ path: string; version: string } | null> {
  let dir = startDir;
  while (true) {
    const candidate = join(dir, "package.json");
    try {
      const raw = await readFile(candidate, "utf8");
      const parsed = JSON.parse(raw) as { name?: string; version?: string };
      if (parsed.name === "kimiflare" && parsed.version) {
        return { path: candidate, version: parsed.version };
      }
    } catch {
      /* not found or not ours */
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

async function readLocalVersion(): Promise<string | null> {
  const here = dirname(fileURLToPath(import.meta.url));
  const found = await findPackageJson(here);
  return found?.version ?? null;
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

export async function checkForUpdate(force = false): Promise<UpdateCheckResult> {
  const localVersion = await readLocalVersion();
  if (!localVersion) return { hasUpdate: false, localVersion: null, latestVersion: null };

  if (!force) {
    const cached = await readCache();
    if (cached) {
      const hasUpdate = isNewer(localVersion, cached.latestVersion);
      return { hasUpdate, localVersion, latestVersion: cached.latestVersion };
    }
  }

  const latestVersion = await fetchLatestVersion();
  if (!latestVersion) {
    return { hasUpdate: false, localVersion, latestVersion: null };
  }

  const hasUpdate = isNewer(localVersion, latestVersion);
  await writeCache({ checkedAt: Date.now(), latestVersion });
  return { hasUpdate, localVersion, latestVersion };
}



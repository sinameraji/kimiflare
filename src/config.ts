import { readFile, mkdir, writeFile, chmod } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type ReasoningEffort = "low" | "medium" | "high";

export interface KimiConfig {
  accountId: string;
  apiToken: string;
  model: string;
  theme?: string;
  reasoningEffort?: ReasoningEffort;
  coauthor?: boolean;
  coauthorName?: string;
  coauthorEmail?: string;
}

export const DEFAULT_MODEL = "@cf/moonshotai/kimi-k2.6";
export const DEFAULT_REASONING_EFFORT: ReasoningEffort = "medium";

export function configPath(): string {
  const xdg = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(xdg, "kimiflare", "config.json");
}

function readReasoningEffortEnv(): ReasoningEffort | undefined {
  const raw = process.env.KIMI_REASONING_EFFORT?.toLowerCase();
  if (raw === "low" || raw === "medium" || raw === "high") return raw;
  return undefined;
}

function readCoauthorEnv(): { enabled: boolean; name: string; email: string } | undefined {
  const enabled = process.env.KIMIFLARE_COAUTHOR;
  if (enabled === "0" || enabled === "false") return undefined;
  const name = process.env.KIMIFLARE_COAUTHOR_NAME || "kimiflare";
  const email = process.env.KIMIFLARE_COAUTHOR_EMAIL || "sinameraji@gmail.com";
  return { enabled: true, name, email };
}

export async function loadConfig(): Promise<KimiConfig | null> {
  const envAccount = process.env.CLOUDFLARE_ACCOUNT_ID ?? process.env.CF_ACCOUNT_ID;
  const envToken = process.env.CLOUDFLARE_API_TOKEN ?? process.env.CF_API_TOKEN;
  const envModel = process.env.KIMI_MODEL ?? DEFAULT_MODEL;
  const envEffort = readReasoningEffortEnv();
  const envTheme = process.env.KIMI_THEME;
  const envCoauthor = readCoauthorEnv();

  if (envAccount && envToken) {
    return {
      accountId: envAccount,
      apiToken: envToken,
      model: envModel,
      theme: envTheme,
      reasoningEffort: envEffort,
      coauthor: envCoauthor?.enabled ?? true,
      coauthorName: envCoauthor?.name,
      coauthorEmail: envCoauthor?.email,
    };
  }

  try {
    const raw = await readFile(configPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<KimiConfig>;
    if (parsed.accountId && parsed.apiToken) {
      return {
        accountId: envAccount ?? parsed.accountId,
        apiToken: envToken ?? parsed.apiToken,
        model: envModel ?? parsed.model ?? DEFAULT_MODEL,
        theme: envTheme ?? parsed.theme,
        reasoningEffort: envEffort ?? parsed.reasoningEffort,
        coauthor: envCoauthor?.enabled ?? parsed.coauthor ?? true,
        coauthorName: envCoauthor?.name ?? parsed.coauthorName,
        coauthorEmail: envCoauthor?.email ?? parsed.coauthorEmail,
      };
    }
  } catch {
    /* no config file */
  }
  return null;
}

export async function saveConfig(cfg: KimiConfig): Promise<string> {
  const p = configPath();
  await mkdir(join(p, ".."), { recursive: true });
  await writeFile(p, JSON.stringify(cfg, null, 2), "utf8");
  await chmod(p, 0o600);
  return p;
}

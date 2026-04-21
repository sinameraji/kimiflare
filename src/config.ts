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

export async function loadConfig(): Promise<KimiConfig | null> {
  const envAccount = process.env.CLOUDFLARE_ACCOUNT_ID ?? process.env.CF_ACCOUNT_ID;
  const envToken = process.env.CLOUDFLARE_API_TOKEN ?? process.env.CF_API_TOKEN;
  const envModel = process.env.KIMI_MODEL ?? DEFAULT_MODEL;
  const envEffort = readReasoningEffortEnv();
  const envTheme = process.env.KIMI_THEME;

  if (envAccount && envToken) {
    return {
      accountId: envAccount,
      apiToken: envToken,
      model: envModel,
      theme: envTheme,
      reasoningEffort: envEffort,
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

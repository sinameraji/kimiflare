/**
 * KimiFlare Cloud (managed service) availability gate.
 *
 * The managed KimiFlare Cloud path — device-code sign-in against
 * api.kimiflare.com, the free-token grant, Stripe upgrade/top-up, and the
 * `--cloud` / `kimiflare auth cloud` entry points — is TEMPORARILY HIDDEN.
 * KimiFlare is BYOK-only for now: users connect their own Cloudflare account
 * (Log in with Cloudflare, or a manually pasted API token).
 *
 * Nothing under src/cloud/ is deleted; every user-facing entry point simply
 * consults `isCloudModeAvailable()` and, when it returns false:
 *   - the onboarding wizard does not offer "KimiFlare Cloud",
 *   - `--cloud`, `KIMIFLARE_CLOUD=1`, and a persisted `cloudMode: true` are
 *     ignored (the user is routed to BYOK onboarding instead),
 *   - `kimiflare auth cloud` / `kimiflare usage` print a short notice,
 *   - the /upgrade, /topup and /manage slash commands print a short notice.
 *
 * To bring the managed service back, flip CLOUD_MODE_ENABLED to true. Keep
 * the flag as a plain constant (not an env var) so there is genuinely no
 * path through the managed service while it is switched off.
 */
export const CLOUD_MODE_ENABLED = false;

export function isCloudModeAvailable(): boolean {
  return CLOUD_MODE_ENABLED;
}

/** One-line notice shown wherever a hidden Cloud entry point is hit. */
export const CLOUD_UNAVAILABLE_NOTICE =
  "KimiFlare Cloud is temporarily unavailable. KimiFlare now runs on your own Cloudflare account — " +
  "run `kimiflare` and pick “Log in with Cloudflare” to connect it.";

# Log in with Cloudflare

KimiFlare's onboarding no longer asks anyone to open the Cloudflare dashboard,
mint an API token, tick permission boxes, and paste an Account ID. The first
option is **Log in with Cloudflare**: the CLI opens a browser page on
`dash.cloudflare.com`, Cloudflare shows *"kimiflare wants permission to …"*,
the user clicks **Allow**, and the terminal continues with a scoped token and
the right account already selected.

Under the hood this is Cloudflare's **self-managed OAuth client** feature
(GA June 2026 — the same OAuth server `wrangler login` uses):

- <https://developers.cloudflare.com/fundamentals/oauth/>
- <https://developers.cloudflare.com/fundamentals/oauth/create-an-oauth-client/>
- <https://developers.cloudflare.com/fundamentals/oauth/integrate-with-cloudflare/>
- <https://blog.cloudflare.com/oauth-for-all/>

## How the flow works (`src/cloud/cloudflare-oauth.ts`)

1. `loginWithCloudflare()` starts a one-shot loopback HTTP server on
   `127.0.0.1:8978` and generates a PKCE verifier/challenge + `state`.
2. It opens
   `https://dash.cloudflare.com/oauth2/auth?response_type=code&client_id=…&redirect_uri=http://localhost:8978/oauth/callback&scope=…&state=…&code_challenge=…&code_challenge_method=S256`.
3. After the user approves, Cloudflare redirects to the loopback server with
   `code` + `state`. The CLI exchanges the code at
   `https://dash.cloudflare.com/oauth2/token` (public client — no secret; PKCE
   verifier proves possession).
4. The CLI calls `GET /client/v4/user` and `GET /client/v4/accounts` to show
   who signed in and to pick the Account ID (auto-selected when the user has
   one account, otherwise a picker).
5. `config.json` stores the access token in `apiToken` — so every existing
   code path keeps working — plus a `cloudflareOAuth` block
   (`refreshToken`, `expiresAt`, `scopes`, `clientId`, `email`, `accountName`).
6. Access tokens live ~1 hour. `loadConfig()` refreshes an expiring token on
   startup (and persists the rotated refresh token); the TUI re-arms a timer
   before each expiry; `kimiflare serve` refreshes on an interval. `/logout`
   revokes the refresh token.

Users can review or revoke the grant any time at
<https://dash.cloudflare.com/?to=/profile/access-management/authorization>.

One quirk to keep in mind when adding new Cloudflare calls: OAuth access
tokens work against `api.cloudflare.com` (management API, `/ai/run`,
`/ai/v1/*` with `cf-aig-gateway-id`) and against the gateway host's
`/compat` and provider endpoints via `Authorization`, but the gateway host's
provider-native `…/workers-ai/{model}` route returns 401 for them. Route
Workers AI calls through `/compat` or the unified `api.cloudflare.com/…/ai`
endpoints (as `probeGateway()` and the embeddings client do).

### Scopes requested

| Scope | Why |
| --- | --- |
| `user-details.read` | `GET /user` — show who is signed in |
| `account-settings.read` | `GET /accounts` — pick the Account ID automatically |
| `ai.read`, `ai.write` | Workers AI inference; also required by `/accounts/{id}/ai/v1/*` (an AI-Gateway-only token gets `401`) |
| `aig.read`, `aig.write` | list / create / configure AI Gateways |
| `aig.run` | run inference through `gateway.ai.cloudflare.com` (authenticated gateways) |
| `secrets-store.read`, `secrets-store.write` | store provider keys (BYOK aliases) in Secrets Store |
| `offline_access` | refresh token (added automatically at authorize time) |

Scope ids are Cloudflare's **dot-delimited** OAuth scope ids
(`GET https://api.cloudflare.com/client/v4/oauth/scopes`). Wrangler's
colon-delimited `account:read` style is a legacy first-party dialect and is
rejected for self-managed clients.

## One-time setup: register the `kimiflare` OAuth client

This has to be done once by a maintainer, in the Cloudflare account that will
own the client (ideally the account that owns `kimiflare.com`, see "Public
clients" below).

### Option A — dashboard

1. <https://dash.cloudflare.com/?to=/:account/oauth-clients> → **Create client**
   (needs Super Administrator / Administrator or the *OAuth Client Write* role).
2. Fill in:
   - **Client name:** `kimiflare`
   - **Client URL:** `https://kimiflare.com`
   - **Logo:** `docs/logo.png`
   - **Response type:** `code`
   - **Grant types:** `authorization_code`, `refresh_token`
   - **Token endpoint authentication method:** `none` (public client, PKCE)
   - **Redirect URLs:** `http://localhost:8978/oauth/callback`
     (exact match — `http`, no trailing slash; must equal `CF_OAUTH_REDIRECT_URI`)
   - **Scopes:** everything in the table above
3. Copy the **Client ID** (32 hex chars).

### Option B — API

`scripts/register-cf-oauth-client.mjs` does the same via
`POST /accounts/{id}/oauth_clients`. It needs an API token with
**Account › OAuth Clients › Write**:

```sh
CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… node scripts/register-cf-oauth-client.mjs
```

It prints the client id and the exact settings it registered.

### Current registration

The production client is registered (2026-08-19) in the Cloudflare account that
owns `kimiflare.com`:

- **Client ID:** `2300cf3ff5499cdc69cb52c6b66504b8` (baked into
  `CF_OAUTH_CLIENT_ID` in `src/cloud/cloudflare-oauth.ts`)
- Public/PKCE client, grants `authorization_code` + `refresh_token`, redirect
  `http://localhost:8978/oauth/callback`, the 9 scopes above (+ `offline_access`)
- Domain verification TXT record on `kimiflare.com` (published, **Verified**):
  `cloudflare_oauth_client_publisher=88913d621ea51f8b2937995a166d4c05`
- Visibility: **Public** (promoted 2026-08-19; any Cloudflare user can log in;
  the consent screen shows the blue verified-publisher shield)
- End-to-end verified 2026-08-19: `kimiflare auth cloudflare` → consent →
  loopback callback → token exchange → `GET /user` + `GET /accounts` →
  config patched; the resulting token lists gateways (`aig.read`), runs
  `/compat` inference on the authenticated gateway (`aig.run`), Workers AI
  direct + K3 via the unified endpoint (`ai.read`), and Secrets Store.

To point a build at a different client (staging, a fork), export
`KIMIFLARE_CF_OAUTH_CLIENT_ID=<client id>`; if the constant is ever cleared the
onboarding pre-selects "Paste an API token" and labels the OAuth option
"(not configured in this build)".

Other overrides: `KIMIFLARE_CF_OAUTH_CALLBACK_PORT` (default `8978` — the
registered redirect URL must match) and `KIMIFLARE_CF_AUTH_DOMAIN`
(default `dash.cloudflare.com`; `dash.staging.cloudflare.com` for staging).

### Public clients (anyone can log in)

(The kimiflare client is already public — this is for reference / forks.)

A freshly created client is **private**: only members of the account that owns
it can authorize it. To let every Cloudflare user log in, promote it to
**public** in the dashboard (row menu → *Change Visibility*; *Restart
Verification* re-polls the TXT record). Cloudflare requires a client name, logo, client
URL, at least one non-identity scope, and **DNS TXT domain verification** on
the client URL's domain (for our client: a TXT record on `kimiflare.com` with
value `cloudflare_oauth_client_publisher=88913d621ea51f8b2937995a166d4c05`;
polled for up to two days). Promotion is permanent. Verified
publishers get a blue shield on the consent screen (unverified apps get amber),
so it's worth completing.

Account admins can block new public-app authorizations org-wide
(Manage Account › Members › Settings › *Public OAuth App access*); users in such
orgs can still use the manual API-token path.

## CLI usage

```sh
kimiflare                    # onboarding → "Log in with Cloudflare"
kimiflare auth cloudflare    # headless: sign in / re-sign in, keeps the rest of config.json
kimiflare auth cloudflare --account <id> --no-browser
```

Manual tokens keep working: pick **Paste an API token** in onboarding, or set
`CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` (env credentials override a
stored OAuth session).

## Bypassing Cloudflare auth entirely

`KIMIFLARE_BASE_URL` (+ optional `KIMIFLARE_API_KEY`) routes every model call
to a custom OpenAI-compatible endpoint and skips this whole page: no OAuth
session, no token refresh, no account-id lookups, no `cf-aig-*` headers. Host
apps that broker AI Gateway access themselves use it to avoid handing the
kimiflare process a raw Cloudflare token. See "Custom gateway endpoint" in the
README and `src/agent/custom-endpoint.ts`.

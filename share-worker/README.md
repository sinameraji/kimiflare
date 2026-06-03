# KimiFlare Share Worker

Cloudflare Worker that hosts shared KimiFlare sessions.

## Deploy

```bash
npm run deploy:share-worker
```

Then set the auth secret:

```bash
cd share-worker && wrangler secret put SHARE_AUTH_SECRET
```

## Configure KimiFlare

Add to `~/.config/kimiflare/config.json`:

```json
{
  "shareWorkerUrl": "https://kimiflare-share.<your-subdomain>.workers.dev",
  "shareAuthSecret": "<the-secret-you-set-above>"
}
```

## Usage

In a KimiFlare session, type `/share` to get a public link.

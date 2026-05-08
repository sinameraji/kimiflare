# Kimiflare AGENTS.md

## Varlock Exception

- **Owner**: kimiflare codebase (config.ts + tests)
- **Validation**: Tests directly invoke `saveConfig` and `loadConfig` with temporary directories; no real secrets are read from env in test assertions beyond existing `src/util/config.test.ts` and `src/util/usage-tracker.test.ts` patterns.
- **Secret-leak protection**: Test temp directories are created under `os.tmpdir()` and deleted after each test (`rmSync` in `finally`). No secret values are logged or persisted.
- **Migration trigger**: If Varlock is formally adopted, migrate test isolation to a mockable config path injection instead of `process.env`.
- **Verification**: `npx tsx --test tests/credential-permissions.test.ts` must pass.

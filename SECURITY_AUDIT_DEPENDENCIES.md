# KimiFlare Dependency Security Audit

**Date:** 2026-05-12  
**Auditor:** KimiFlare (self-audit)  
**Scope:** All `package.json` files in the repo + full transitive dependency tree  
**Total dependencies:** 317 (207 prod, 102 dev, 54 optional, 10 peer)

---

## 1. Executive Summary

| Risk Level | Count | Packages |
|-----------|-------|----------|
| 🔴 **High** | 1 | `fast-uri` (path traversal) |
| 🟠 **Moderate** | 3 | `express-rate-limit`, `ip-address`, `hono` |
| 🟡 **Low** | 1 | `diff` (ReDoS) |
| ⚠️ **Supply-chain concern** | 4 | `better-sqlite3`, `isolated-vm`, `@agentclientprotocol/sdk`, `@mixmark-io/domino` |

**All 5 known vulnerabilities are transitive dependencies of `@modelcontextprotocol/sdk`.** None of the direct dependencies introduced by contributor PRs contain known CVEs, but one contributor-introduced package (`@agentclientprotocol/sdk`) is extremely new and unproven.

---

## 2. Contributor PRs That Touched Dependencies

| PR | Author | Title | Dependency Impact |
|----|--------|-------|-------------------|
| #262 | **marshallswain** | feat: add Zed Agent Panel (ACP) integration | **Added `@agentclientprotocol/sdk@^0.21.0`** to `acp/package.json`. Also duplicated `better-sqlite3`, `commander`, `diff`, `fast-glob`, `turndown` in `acp/package.json` instead of workspace-linking them. |
| #228 | **season179** | feat: / slash command picker | **No new dependencies.** Fuzzy matcher was a ~80-line local port. Clean. |
| #315 | **nqh-packages** | feat(ui): fuzzy matching for @ file picker | **No new dependencies.** Wired up existing local `fuzzyFilter`. Clean. |

**Verdict on contributors:** `season179` and `nqh-packages` are clean — they wrote local code. `marshallswain` introduced a new scoped npm package that warrants scrutiny (see §4.2).

---

## 3. Direct Dependencies Analysis (Main Package)

### 3.1 Production Dependencies

| Package | Version | Verdict | Notes |
|---------|---------|---------|-------|
| `@modelcontextprotocol/sdk` | `^1.29.0` | ⚠️ **Risky** | Brings **207 prod deps** including Express, Hono, AJV. All 5 known CVEs in the tree originate here. The SDK bundles both a client *and* a server, but KimiFlare only needs the client. |
| `better-sqlite3` | `^12.9.0` | ⚠️ **Supply-chain risk** | Native module. Uses deprecated `prebuild-install@7.1.3` to download prebuilt binaries from GitHub releases. If GitHub account or release pipeline is compromised, malicious binaries could be injected. |
| `commander` | `^12.1.0` | ✅ Clean | TJ Hollowaychuk / maintainers. Battle-tested, 30M+ downloads/week. |
| `diff` | `^7.0.0` | 🟡 **Low CVE** | CVE-2026-24001: ReDoS in `parsePatch`/`applyPatch`. Fix in v9.0.0 (semver-major). KimiFlare uses `diff` for tool output reduction — **not** for parsing untrusted patch files, so exploitability is low. |
| `fast-glob` | `^3.3.2` | ✅ Clean | Well-maintained by mrmlnc. No known CVEs. |
| `gray-matter` | `^4.0.3` | 🟡 **Dated** | Depends on `js-yaml@^3.13.1` (2019). js-yaml v3 had prototype pollution issues pre-3.13.1; current pin is patched but v4 is available. Also depends on `kind-of@^6.0.2` which had a prototype pollution CVE in older versions (patched in 6.0.3). |
| `ink` | `^7.0.1` | ✅ Clean | Vadimdemedes. Large ecosystem. Depends on `react-reconciler`, `yoga-layout`, `ws`, `es-toolkit` — all legitimate. |
| `ink-select-input` | `^6.2.0` | ✅ Clean | Same author as Ink. |
| `ink-spinner` | `^5.0.0` | ✅ Clean | Same author as Ink. |
| `ink-text-input` | `^6.0.0` | ✅ Clean | Same author as Ink. |
| `minimatch` | `^10.2.5` | ✅ Clean | Isaac Z. Schlueter / npm team. No known CVEs. |
| `react` | `^19.2.0` | ✅ Clean | Meta. Obviously legitimate. |
| `turndown` | `^7.2.4` | ⚠️ **Supply-chain concern** | Depends on `@mixmark-io/domino@2.2.0` — a fork of Mozilla's dom.js with **only 1 published version**, maintained by a small Czech company (orchitech.cz). If their npm account is compromised, this is a single point of failure for HTML→Markdown conversion. |
| `typescript` | `^5.7.2` | ✅ Clean | Microsoft. |
| `vscode-languageserver-protocol` | `^3.17.5` | ✅ Clean | Microsoft. |

### 3.2 Optional Dependencies

| Package | Version | Verdict | Notes |
|---------|---------|---------|-------|
| `isolated-vm` | `^6.1.2` | ⚠️ **Supply-chain risk** | Native C++ module by Marcel Laverdet (well-known). Compiles V8 isolates at install time. If tarball or build pipeline is compromised, arbitrary C++ code executes during `npm install`. Falls back gracefully if install fails. |

### 3.3 Dev Dependencies

| Package | Version | Verdict | Notes |
|---------|---------|---------|-------|
| `@types/*` | various | ✅ Clean | DefinitelyTyped. |
| `tsup` | `^8.3.5` | ✅ Clean | egoist. Standard bundler. |
| `tsx` | `^4.19.2` | ✅ Clean | privatenumber. Widely used. |

---

## 4. Sub-Package Dependencies

### 4.1 `remote/worker/package.json`

| Package | Version | Verdict |
|---------|---------|---------|
| `hono` | `^4.7.0` | ✅ Clean (but see §5.1 — older versions have CVEs) |
| `wrangler` | `^3.109.0` | ✅ Clean (Cloudflare official) |

### 4.2 `acp/package.json` ⬅️ Contributor-introduced

| Package | Version | Verdict | Notes |
|---------|---------|---------|-------|
| `@agentclientprotocol/sdk` | `^0.21.0` | ⚠️ **High scrutiny** | **31 versions, published a week ago by GitHub Actions OIDC.** Maintainers: benbrandt, aguzubiaga, cirwin (Conrad Irwin from Zed). The protocol is legitimate (zed.dev/acp, jetbrains.com/acp), but the npm package is **extremely new** and has no proven track record. Zero dependencies is good, but the code surface is 1.3 MB unpacked — large enough to hide obfuscated logic. |
| `better-sqlite3` | `^12.9.0` | ⚠️ Same as main | Duplicated instead of workspace-linked. |
| `commander` | `^12.1.0` | ✅ Clean | Duplicated. |
| `diff` | `^7.0.0` | 🟡 Same CVE as main | Duplicated. |
| `fast-glob` | `^3.3.2` | ✅ Clean | Duplicated. |
| `turndown` | `^7.2.4` | ⚠️ Same concern as main | Duplicated. |

**Issue:** `acp/package.json` duplicates 5 dependencies from the main package instead of using npm workspaces or `file:` references. This means:
1. Version drift is possible.
2. `npm audit` must be run separately for `acp/`.
3. Supply-chain risks are duplicated.

---

## 5. Known Vulnerabilities (npm audit)

### 5.1 Vulnerability Breakdown

| Package | Severity | CVE / Advisory | Affected Range | Fix Available | Exploitability in KimiFlare |
|---------|----------|----------------|----------------|---------------|----------------------------|
| `diff` | 🟡 Low | CVE-2026-24001 / GHSA-73rr-hh4g-fpgx | `6.0.0 - 8.0.2` | ✅ v9.0.0 (major) | **Low.** KimiFlare uses `diff` internally for tool output reduction, not for parsing user-supplied patch files. |
| `fast-uri` | 🔴 High | GHSA-q3j6-qgpj-74h6 | `<=3.1.1` | ✅ v3.1.2+ | **Low-Medium.** Transitive via `ajv` in `@modelcontextprotocol/sdk`. Only exploitable if AJV validates schemas with `$ref` containing malicious URIs. KimiFlare does not expose AJV to user input directly. |
| `express-rate-limit` | 🟠 Moderate | CVE-2026-30827 / GHSA-46wh-pxpv-q5gq | `8.0.1 - 8.5.0` | ✅ v8.5.1+ | **Low.** Transitive via `@modelcontextprotocol/sdk`. Only relevant if KimiFlare runs the MCP SDK's built-in Express server, which it does not. |
| `ip-address` | 🟠 Moderate | GHSA-v2v4-37r5-5v8g | `<=10.1.0` | ✅ v10.1.1+ | **Low.** Transitive via `express-rate-limit`. XSS in `Address6.html()` — not called by KimiFlare. |
| `hono` | 🟠 Moderate | Multiple (GHSA-m732-5p4w-x69g, etc.) | `<=4.12.17` | ✅ v4.12.18+ | **Low.** Transitive via `@modelcontextprotocol/sdk`. Issues: cache middleware leakage, bodyLimit bypass, JSX HTML injection, JWT NumericDate validation. KimiFlare does not use Hono directly; only exposed if MCP SDK starts a Hono server. |

### 5.2 Root Cause

**All 5 vulnerabilities enter the tree through `@modelcontextprotocol/sdk@1.29.0`.** The MCP SDK bundles both client and server capabilities, pulling in `express`, `hono`, `ajv`, and their transitive deps. KimiFlare only uses the MCP SDK as a **client** to connect to external MCP servers, yet it inherits the entire server-side dependency tree.

---

## 6. Supply-Chain Risk Assessment

### 6.1 Native Binary Downloads (High Risk)

| Package | Mechanism | Risk |
|---------|-----------|------|
| `better-sqlite3` | `prebuild-install` (DEPRECATED) downloads `.tar.gz` from GitHub Releases | If WiseLibs GitHub account or release pipeline is compromised, malicious native code executes at install time. `prebuild-install` itself is unmaintained. |
| `isolated-vm` | Compiles C++ via `node-gyp` at install time | If tarball is compromised, arbitrary C++ compiles and executes. Mitigation: optional dep, falls back gracefully. |

### 6.2 Scoped Packages from Small Maintainers

| Package | Maintainer | Risk |
|---------|-----------|------|
| `@agentclientprotocol/sdk` | 3 individuals, published via GitHub Actions OIDC | Very new (31 versions, ~1 week old). Large unpacked size (1.3 MB). Protocol is legitimate but npm package has no security track record. |
| `@mixmark-io/domino` | orchitech.cz (2 maintainers) | Only 1 version ever published. Fork of abandoned Mozilla dom.js. Small team = higher account takeover risk. |
| `es-toolkit` | toss.im (Korean fintech) | Legitimate and popular, but relatively new (1518 versions suggests rapid iteration). |

### 6.3 Deprecated Dependencies

| Package | Status | Used By |
|---------|--------|---------|
| `prebuild-install` | **DEPRECATED** — "No longer maintained" | `better-sqlite3` |
| `js-yaml@3.x` | Legacy; v4 available since 2021 | `gray-matter` |

---

## 7. Recommendations

### 7.1 Immediate Actions (Do Now)

1. **Upgrade `diff` to v9.0.0** — Low-risk semver-major; KimiFlare's usage is basic.
2. **Upgrade `@modelcontextprotocol/sdk`** — Check if v1.30+ or later trims server deps. If not, file an issue with MCP asking for a `@modelcontextprotocol/sdk-client` sub-package.
3. **Run `npm audit fix`** in `acp/` as well as root — the sub-package is not covered by root audit.
4. **Pin `@agentclientprotocol/sdk` exact version** (`0.21.0` without `^`) until it matures. Review its source code in `node_modules` on every update.

### 7.2 Short-Term (Next Sprint)

5. **Replace or vendor `@modelcontextprotocol/sdk` client** — The SDK pulls in 207 production dependencies including Express and Hono just to speak HTTP+SSE to MCP servers. Consider:
   - **Option A:** Write a lightweight MCP client (~200-400 lines) using only `fetch` + `zod`. The protocol is simple: JSON-RPC over SSE/stdio.
   - **Option B:** Use `npm overrides` to prune `express`, `hono`, `express-rate-limit`, `ajv` from the MCP SDK tree if they are truly unused at runtime.
   - **Option C:** Lobby MCP maintainers to split the package into `sdk-client` and `sdk-server`.

6. **Audit `acp/package.json` duplication** — Convert the repo to npm workspaces or use `file:../` references so `better-sqlite3`, `diff`, etc. are not duplicated with divergent versions.

7. **Replace `prebuild-install` for `better-sqlite3`** — The maintainer should migrate to `prebuildify` + `node-gyp-build` (the modern, maintained alternative). If they won't, consider:
   - Building from source (`npm install better-sqlite3 --build-from-source`)
   - Or switching to `node:sqlite` (built into Node 22.5+) if SQLite feature parity is sufficient.

### 7.3 Medium-Term (Next Quarter)

8. **Evaluate `node:sqlite` (Node 22.5+)** — Node now ships a built-in `node:sqlite` module. If KimiFlare can drop `better-sqlite3`, it eliminates:
   - The `prebuild-install` supply-chain risk
   - 2 native dependencies
   - `@types/better-sqlite3` dev dep
   - The C++ build requirement for users

9. **Evaluate replacing `turndown`** — `turndown` + `@mixmark-io/domino` is 7.9 MB of DOM parsing just to convert HTML→Markdown. Options:
   - **Option A:** Use a lighter WASM-based HTML parser (e.g., `linkedom` is 500 KB and actively maintained).
   - **Option B:** If the HTML input is always from trusted sources (e.g., `web_fetch` or `browser_fetch`), write a small regex-based sanitizer + Markdown converter for the specific tags you encounter.
   - **Option C:** Use `node-html-markdown` or `html-to-md` which have smaller trees.

10. **Evaluate replacing `gray-matter`** — `gray-matter` is 4.0.3 (2019) and depends on legacy `js-yaml@3`. Frontmatter parsing is ~50 lines of code. Writing an internal frontmatter parser would:
    - Remove `js-yaml@3`, `kind-of`, `section-matter`, `strip-bom-string`
    - Allow using `node:util` `parseArgs` or a modern YAML parser if needed

11. **Evaluate replacing `isolated-vm`** — The sandbox is optional and falls back gracefully. If the TypeScript sandbox feature is critical, consider:
    - Using `node:vm` with `timeout` and strict context (less isolation but no native dep)
    - Or using a WebAssembly-based JS sandbox (e.g., `quickjs-emscripten`)

### 7.4 Long-Term / Architectural

12. **Dependency budget cap** — KimiFlare currently has 317 total dependencies for a CLI tool. Set a policy:
    - Max 50 direct production dependencies
    - No new transitive dependency trees >20 packages without justification
    - Prefer built-in `node:*` modules over npm packages

13. **Lockfile integrity verification** — Add a CI step that:
    - Runs `npm audit --audit-level=moderate`
    - Fails on new high/critical CVEs
    - Verifies `package-lock.json` is not manually edited (check git diff for suspicious tarball URLs)

14. **Contributor dependency policy** — Add a `CONTRIBUTING.md` rule:
    - New dependencies require explicit approval
    - No new scoped packages from maintainers with <6 months of npm history
    - Native modules must have a fallback path

---

## 8. Packages to Consider Deleting / Replacing / Vendoring

| Package | Current Role | Recommendation | Effort |
|---------|-------------|----------------|--------|
| `@modelcontextprotocol/sdk` | MCP client | **Replace** with lightweight client or prune server deps | Medium |
| `better-sqlite3` | SQLite DB | **Replace** with `node:sqlite` (Node 22.5+) | Medium-High |
| `prebuild-install` | (transitive) | **Eliminated** automatically if `better-sqlite3` is removed | Free |
| `turndown` | HTML→Markdown | **Replace** with `linkedom` + custom converter, or regex-based | Low-Medium |
| `@mixmark-io/domino` | (transitive) | **Eliminated** if `turndown` is removed | Free |
| `gray-matter` | Frontmatter parsing | **Vendor** (~50 lines) or replace with modern YAML parser | Low |
| `js-yaml@3` | (transitive) | **Eliminated** if `gray-matter` is removed | Free |
| `isolated-vm` | TS sandbox | **Replace** with `node:vm` or `quickjs-emscripten` | Medium |
| `diff` | Text diffing | **Keep** but upgrade to v9.0.0 | Trivial |
| `@agentclientprotocol/sdk` | ACP protocol | **Keep** but pin exact version and audit updates | Trivial |

---

## 9. Conclusion

**KimiFlare is not critically compromised.** No backdoors were found in contributor-introduced code. The two clean contributor PRs (#228, #315) wrote local code with zero new dependencies. The third contributor PR (#262) introduced `@agentclientprotocol/sdk`, which is legitimate but immature.

**The real risk is dependency bloat.** `@modelcontextprotocol/sdk` pulls in an entire web server stack (Express + Hono + AJV + CORS + rate-limiting) just to act as an HTTP client. This bloat introduces 5 known CVEs and hundreds of transitive packages that expand the attack surface.

**Priority order:**
1. Upgrade `diff` and audit-fix MCP transitive deps
2. Split or replace `@modelcontextprotocol/sdk` with a client-only implementation
3. Migrate `better-sqlite3` → `node:sqlite` to kill the native binary download risk
4. Vendor `gray-matter` and slim down `turndown`

---

*Co-authored-by: kimiflare <kimiflare@proton.me>*

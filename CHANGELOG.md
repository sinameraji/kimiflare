# Changelog

## [0.28.0](https://github.com/sinameraji/kimiflare/compare/v0.27.0...v0.28.0) (2026-04-30)


### Features

* add stay-in-the-loop and shipping-fast sections to README ([#195](https://github.com/sinameraji/kimiflare/issues/195)) ([bb499f2](https://github.com/sinameraji/kimiflare/commit/bb499f25a4ac4e8ae98221a1e17fb73b8eb913c5))
* cost attribution by task type ([#196](https://github.com/sinameraji/kimiflare/issues/196)) ([#207](https://github.com/sinameraji/kimiflare/issues/207)) ([43d24d0](https://github.com/sinameraji/kimiflare/commit/43d24d0ed8119c806b2946309870c9b489655db1))
* interrupt current turn with Ctrl+C or Escape without exiting session ([#208](https://github.com/sinameraji/kimiflare/issues/208)) ([3667b2e](https://github.com/sinameraji/kimiflare/commit/3667b2ed646793eb6f693181a486efa1e4ace9de))
* **landing:** redesign with email capture, changelog, Cloudflare Pages ([ae7aaa2](https://github.com/sinameraji/kimiflare/commit/ae7aaa2ad190315f6aab7ae44b69c1e5ae497d1e))
* **landing:** redesign with email capture, changelog, discord, cloudflare pages ([7384d48](https://github.com/sinameraji/kimiflare/commit/7384d487644ee040f6e9769a80aafa93c767ea57))


### Bug Fixes

* avoid isolated-vm build failure in Pages deploy ([20b763e](https://github.com/sinameraji/kimiflare/commit/20b763e3562e2e6fa9ad045657bb059226a08246))
* avoid isolated-vm build failure in Pages deploy action ([7121e12](https://github.com/sinameraji/kimiflare/commit/7121e12ac0002103dfda85df18629cadcee1781e))
* prevent perf_hooks memory leak in long-running TUI sessions ([#211](https://github.com/sinameraji/kimiflare/issues/211)) ([ae8845c](https://github.com/sinameraji/kimiflare/commit/ae8845cc8141d3580bd23395368b350eecfa23fb))

## [0.27.0](https://github.com/sinameraji/kimiflare/compare/v0.26.1...v0.27.0) (2026-04-29)


### Features

* **lsp:** add interactive LSP server configuration wizard ([a060d45](https://github.com/sinameraji/kimiflare/commit/a060d456a8339da93549761fcbf69a305ec29849))
* **lsp:** auto-gitignore project config and add tests ([34acf05](https://github.com/sinameraji/kimiflare/commit/34acf050dcc7a68996f3ac755f7f036fc50ade89))
* **lsp:** auto-nudge when user references code files without LSP ([86736e7](https://github.com/sinameraji/kimiflare/commit/86736e74f5fc72ee823bcf0aee83aa1169855bdc))
* **lsp:** integrate Language Server Protocol for semantic code intelligence ([91fe95f](https://github.com/sinameraji/kimiflare/commit/91fe95f82d74950dd1f3cc87d4987f8d63093e8a))
* **lsp:** integrate Language Server Protocol for semantic code intelligence ([faa7e16](https://github.com/sinameraji/kimiflare/commit/faa7e164ecc89f3338b30a257c541204e2831e79))
* **lsp:** per-project LSP config with wizard scope selection ([e15416e](https://github.com/sinameraji/kimiflare/commit/e15416e36952006c756dc9ce83be9f47517728b0))
* security hardening for custom slash commands ([30a997e](https://github.com/sinameraji/kimiflare/commit/30a997e4260653ed04ace703e1ae57c927e9ac2f))
* security hardening for custom slash commands ([7b1c684](https://github.com/sinameraji/kimiflare/commit/7b1c684bb20768ee5e9de12fa44d3fc5a4a18260))


### Bug Fixes

* **lsp:** address PR review feedback ([d420970](https://github.com/sinameraji/kimiflare/commit/d42097046758c596c9c13a3fdcce496fa57c5f6b))
* **lsp:** mark already-configured presets in Add list ([e1ca073](https://github.com/sinameraji/kimiflare/commit/e1ca073accbdaea206e989c1645034f28297413c))
* **lsp:** remove conditional useMemo calls causing hooks-order crash ([3b610ce](https://github.com/sinameraji/kimiflare/commit/3b610cec0c0656a0b15ea5631b9d98d6eec94887))
* **lsp:** resolve yoga-layout crash and add reload feedback ([83f7bec](https://github.com/sinameraji/kimiflare/commit/83f7becb9af831f8eb137f3abcd7e1226e89e997))

## [0.26.1](https://github.com/sinameraji/kimiflare/compare/v0.26.0...v0.26.1) (2026-04-28)


### Bug Fixes

* **images:** preserve images on early turns and handle paths with spaces ([624a9d2](https://github.com/sinameraji/kimiflare/commit/624a9d2da193f0cb734a15fb6c703aabcd5951fc))
* **messages:** preserve images when user message count is below keepLastTurns threshold ([6c35f5d](https://github.com/sinameraji/kimiflare/commit/6c35f5dfbc6e68168df779ea0dc8e358b6a1639f))
* **plan-mode:** halt agent loop when blocked tool is called in plan mode ([122c86e](https://github.com/sinameraji/kimiflare/commit/122c86e74a1916ecce471423db56488164800101))
* **plan-mode:** halt agent loop when blocked tool is called in plan mode ([542cf43](https://github.com/sinameraji/kimiflare/commit/542cf43dd7d2dd758964c26a7f125a3b7289cd27))

## [0.26.0](https://github.com/sinameraji/kimiflare/compare/v0.25.0...v0.26.0) (2026-04-27)


### Features

* **code-mode:** deterministic TypeScript API generation + cache ([b78eac2](https://github.com/sinameraji/kimiflare/commit/b78eac2eaab54ae569b57bc7242ed18403b5c6d1))
* **code-mode:** deterministic TypeScript API generation + cache ([81ad1f2](https://github.com/sinameraji/kimiflare/commit/81ad1f29ff89f040b8eb73e085bdbf22cb3be35f))
* **commands:** interactive TUI for creating, editing, deleting and listing custom slash commands ([b522099](https://github.com/sinameraji/kimiflare/commit/b522099e28bba586f26779cd76d25ab05d63e8a5))
* **commands:** interactive TUI for custom slash commands ([4b27a04](https://github.com/sinameraji/kimiflare/commit/4b27a04d89b2521a04e58f2f3d725b229ac4791a))
* **commands:** side-by-side template guide in command wizard ([414521c](https://github.com/sinameraji/kimiflare/commit/414521c04a2bf6d867054eae74f7532966a78d68))
* memory polish and loop guardrails ([2d9dbf5](https://github.com/sinameraji/kimiflare/commit/2d9dbf596b81fa46e626ba25fa2bf6ad3d82768a))
* memory polish and loop guardrails ([500b26b](https://github.com/sinameraji/kimiflare/commit/500b26b381bb04c18341f4b3053304c13f436f5b))
* **memory:** session-start and compaction-time memory recall ([cb790f5](https://github.com/sinameraji/kimiflare/commit/cb790f586ba3ad5d7ae379038216b3875b3299ad))
* **memory:** session-start and compaction-time memory recall ([82623b2](https://github.com/sinameraji/kimiflare/commit/82623b2b0a06de72d8a3e5f093c3c695fd687931))
* **memory:** use Llama 4 Scout for plumbing tasks and deterministic topic keys ([1615e2a](https://github.com/sinameraji/kimiflare/commit/1615e2a9c04c520811292502eb100de3c44535bd))
* **memory:** use Llama 4 Scout for plumbing tasks and deterministic topic keys ([467f9a2](https://github.com/sinameraji/kimiflare/commit/467f9a2dbcff9381e7be1c6eba2d582a00d470c6))
* **session:** persist ArtifactStore across session resume ([75b6ece](https://github.com/sinameraji/kimiflare/commit/75b6ece914a2f51d4c9bb90291424a162044391e))
* **session:** persist ArtifactStore across session resume ([c58e86d](https://github.com/sinameraji/kimiflare/commit/c58e86d0a834c72f2ccb5187cfa251634eda259d))

## [0.25.0](https://github.com/sinameraji/kimiflare/compare/v0.24.0...v0.25.0) (2026-04-27)


### Features

* add /memory on and /memory off commands ([5617f68](https://github.com/sinameraji/kimiflare/commit/5617f68d2125b59076cf1b4c3458b00f12ba0466))
* add /memory on and /memory off commands ([a1a3cf3](https://github.com/sinameraji/kimiflare/commit/a1a3cf381f4919a4d2ebe15aa74def0addc92eaf))
* add interactive nested help menu ([6430153](https://github.com/sinameraji/kimiflare/commit/643015305753bd133fbcf9f4c059646562e4b336))
* **commands:** custom slash commands from markdown files ([0121692](https://github.com/sinameraji/kimiflare/commit/01216920df4ffcf250f458ed0df0b3ab3129a601))
* **commands:** custom slash commands from markdown files ([b36926e](https://github.com/sinameraji/kimiflare/commit/b36926ea7207506076e3bca30af00bb9cf5f24ac))
* make help menu interactive with executable commands and Escape navigation ([d2b75c6](https://github.com/sinameraji/kimiflare/commit/d2b75c60c7f80c761853e2804a832f1c136f4ce8))


### Bug Fixes

* auto-compact fallback, diff-friendly bash, tighter failure recall ([5b7984f](https://github.com/sinameraji/kimiflare/commit/5b7984fb7a71908544734ac10c7072ef8b259f0a))
* **compact:** auto-compact via LLM summarizer when compiled context is off ([c84810a](https://github.com/sinameraji/kimiflare/commit/c84810a53da8860c9217abad5e162c7bb39fae6b))
* **compaction:** tighten failure-keyword artifact recall ([9c1521f](https://github.com/sinameraji/kimiflare/commit/9c1521f5f9e09a03f8d630c7be44713789a3c9e2))
* **reducer:** bypass bash reducer for diff-style git commands ([92b2532](https://github.com/sinameraji/kimiflare/commit/92b2532f97e7bd18f385ac6793109eb583ce06a8))
* **status:** restore $ prefix on cost cell in right status bar ([88cfa35](https://github.com/sinameraji/kimiflare/commit/88cfa35f1e25aef6d38608e9ec24ca73fcd1d66a))
* **version:** correct package.json path when bundled ([b024232](https://github.com/sinameraji/kimiflare/commit/b02423234ac2c6e4ed44d12d3f1baebb4d2020ea))
* **version:** correct package.json path when bundled ([ac9dca0](https://github.com/sinameraji/kimiflare/commit/ac9dca00667776283fd20ae65e627fab67979a41))

## [0.24.0](https://github.com/sinameraji/kimiflare/compare/v0.23.0...v0.24.0) (2026-04-26)


### Features

* /hello voice note feedback ([b170496](https://github.com/sinameraji/kimiflare/commit/b17049693b6784239d0fe9cc20ce1b86dee3f0e1))
* add /hello voice note feedback to creator ([8e05b8f](https://github.com/sinameraji/kimiflare/commit/8e05b8f7ccf9ad6ff50ffb67f12dbf3e480b3ca6))
* allow plan mode to prompt for non-whitelisted bash commands ([8c2770d](https://github.com/sinameraji/kimiflare/commit/8c2770dfbe4645c8a8fd9b603c9c92b1795cf4d9))
* allow plan mode to prompt for non-whitelisted bash commands ([75b96c9](https://github.com/sinameraji/kimiflare/commit/75b96c9bc736b3674393b19885d5ac17c63d9e8b))
* **discord:** add /community command and welcome promotion ([c5a3e69](https://github.com/sinameraji/kimiflare/commit/c5a3e697c8e62e94c35245f6bf2763d08cb6a924))
* **feedback:** compact single-screen layout ([1a2f644](https://github.com/sinameraji/kimiflare/commit/1a2f64496194da619a4d5062a9c41391d70f81f0))
* **feedback:** improve visual design and contrast ([19378fd](https://github.com/sinameraji/kimiflare/commit/19378fd2f084aabdc38704b1f88da8b8b153cc22))
* **feedback:** redesign page to match landing page branding ([c05e756](https://github.com/sinameraji/kimiflare/commit/c05e7568cd94e0591b5f575ebcdc51f8cc413f4f))
* **feedback:** use real logo and inline success message ([011b5f1](https://github.com/sinameraji/kimiflare/commit/011b5f19ea5d37db4ff3271dab60972a8a9c5881))


### Bug Fixes

* /cost rendering, Static keys, and status bar token sync ([2050e9f](https://github.com/sinameraji/kimiflare/commit/2050e9fc2c1745b01df267eb1593cfc4f41677fe))
* /cost rendering, Static keys, and status bar token sync ([b7b0a05](https://github.com/sinameraji/kimiflare/commit/b7b0a057a5f2cf90fe73ed588b7e9aadfce193e5))
* /cost rendering, Static keys, and status bar token sync ([7c4042a](https://github.com/sinameraji/kimiflare/commit/7c4042aab02c0c43541f98aaf950f7c9acdd3996)), closes [#152](https://github.com/sinameraji/kimiflare/issues/152)
* **feedback:** add stop button and creator message ([7ecfa59](https://github.com/sinameraji/kimiflare/commit/7ecfa591856cfa7680e3b79b6a80c5597369a703))
* **feedback:** make copy first-person and more personal ([c705edd](https://github.com/sinameraji/kimiflare/commit/c705eddb79ef1815d1965f1e2e14ea81dfd298d1))
* **feedback:** simplify privacy line ([d20fc7e](https://github.com/sinameraji/kimiflare/commit/d20fc7e6d1ec78fd3ddaa3fe9e4889948b309845))
* **feedback:** update privacy copy on recording page ([d419ac6](https://github.com/sinameraji/kimiflare/commit/d419ac659b5aa569bf27c6753d114d64a17338e2))
* prevent co-author injection on git commands that only move HEAD ([2cc0a2f](https://github.com/sinameraji/kimiflare/commit/2cc0a2ff57aa1d26c07736d0be3c5bef7a818a5d))
* prevent co-author injection on git commands that only move HEAD ([0bde202](https://github.com/sinameraji/kimiflare/commit/0bde2026ab89269149a72ffd788205546eb3302b))
* **tui:** remove Static to fix missing user messages; fix plan mode && chains ([049671d](https://github.com/sinameraji/kimiflare/commit/049671d8014e3c6448f0febf21c0806174230412))
* **tui:** restore Static, raise event cap to 500, add visual compaction ([fd14c6d](https://github.com/sinameraji/kimiflare/commit/fd14c6da9de24de7aaa51d265420f0a242f57c4a))
* update feedback worker URL to deployed subdomain ([2af59a5](https://github.com/sinameraji/kimiflare/commit/2af59a587122df04b1eb90cf0aa3d4d9d3eb3a7f))

## [0.23.0](https://github.com/sinameraji/kimiflare/compare/v0.22.0...v0.23.0) (2026-04-26)


### Features

* agent-driven memory with tools, RRF retrieval, verification, and supersession ([12bab38](https://github.com/sinameraji/kimiflare/commit/12bab384321a7660603eed636390eaefe9ae20bf))
* Code Mode — Local TypeScript Sandbox ([fdb4ec2](https://github.com/sinameraji/kimiflare/commit/fdb4ec29af6d5767e8e65d89fdc891ceff237296))
* implement Code Mode — local TypeScript sandbox for tool execution ([2ee4d2a](https://github.com/sinameraji/kimiflare/commit/2ee4d2a226eabba8ab21f2f8bdd23afe2c5c0111)), closes [#146](https://github.com/sinameraji/kimiflare/issues/146)
* Local Structured Agent Memory — SQLite + Embeddings for Cross-Session Context ([956eba8](https://github.com/sinameraji/kimiflare/commit/956eba834ebfb21b4a0d09c3e464e304bcf41bc7))
* Local Structured Agent Memory — SQLite + Embeddings for Cross-Session Context ([00ff896](https://github.com/sinameraji/kimiflare/commit/00ff896c2af77ae9fd0bb9c1427665df0f9ef211))


### Bug Fixes

* add /billable-usage to Cloudflare billing URL ([ebe48ed](https://github.com/sinameraji/kimiflare/commit/ebe48ed0391ac4eaa6f1521b4ad7c7fb8a5380c0))
* add /billable-usage to Cloudflare billing URL in welcome screen ([334711a](https://github.com/sinameraji/kimiflare/commit/334711ad3c2ef573282c2dee3ccf1f481d430913))
* allow pipes and && chains of read-only bash commands in plan mode ([16477be](https://github.com/sinameraji/kimiflare/commit/16477bec2a9e9121b772c6ff65ffabfa5c0f3487))
* allow pipes and && chains of read-only bash commands in plan mode ([2bc0576](https://github.com/sinameraji/kimiflare/commit/2bc05766eab643730f36220454d28f8d7fca9f4f))
* allow pipes and && chains of read-only bash commands in plan mode ([9327c2d](https://github.com/sinameraji/kimiflare/commit/9327c2df6a830b13e68baf8c8ae4a3aa88b8878f))
* bump CI and engines to Node 22 for isolated-vm compatibility ([e77ff30](https://github.com/sinameraji/kimiflare/commit/e77ff30893707ed079c1625e3cd573ab1f6bcfea))
* bump CI and engines to Node 22 for isolated-vm compatibility ([ec57339](https://github.com/sinameraji/kimiflare/commit/ec57339bb53922b339f069b1409385f4a11e801f))
* bump CI and engines to Node 22 for isolated-vm compatibility ([7fbd050](https://github.com/sinameraji/kimiflare/commit/7fbd05053ff7537a1b5a40d79ccfd778139d800d))
* bump CI and engines to Node 22 for isolated-vm compatibility ([43b4720](https://github.com/sinameraji/kimiflare/commit/43b472003cc7d98245f8225f5fa3decb1aaea942))
* show session-level cost and token totals in status bar and /cost command ([3de4cdb](https://github.com/sinameraji/kimiflare/commit/3de4cdb3d48ce918ebc4d2431cd435aa629d210f))
* show session-level cost and token totals in status bar and /cost command ([a7f928c](https://github.com/sinameraji/kimiflare/commit/a7f928cea24f4633c229ff698a8946fcae780df3))
* **tui:** cap Static events and fix task timer restart ([5f17089](https://github.com/sinameraji/kimiflare/commit/5f17089582c973c2bfaaa38df9203347d61cbff7))
* **tui:** cap Static events to prevent incremental rendering from hiding output; fix task timer restart ([c229bb2](https://github.com/sinameraji/kimiflare/commit/c229bb23bf6e751fe97d25abbcedf23e6bdfd632)), closes [#160](https://github.com/sinameraji/kimiflare/issues/160)


### Reverts

* remove intern's session-level token count work from status bar ([931aab7](https://github.com/sinameraji/kimiflare/commit/931aab7029db903378f2c6e6675b5285adc00f1e))

## [0.22.0](https://github.com/sinameraji/kimiflare/compare/v0.21.0...v0.22.0) (2026-04-26)


### Features

* /gateway slash command + model ID validation ([006b3ff](https://github.com/sinameraji/kimiflare/commit/006b3ffc49fafeff74514d02182f498b9b970194))
* add /gateway slash command and validate model IDs ([a012c27](https://github.com/sinameraji/kimiflare/commit/a012c271bc80f7d48b164adde26820cb58d33f97))
* add billing notice to README and terminal welcome screen ([5632b82](https://github.com/sinameraji/kimiflare/commit/5632b82264910555657493d8cef552e618f104c1))
* add billing notice to README and terminal welcome screen ([5cbe1d6](https://github.com/sinameraji/kimiflare/commit/5cbe1d626e369ee4bf1a1c3625517df0c7d77902))
* add billing notice to README and terminal welcome screen ([0918a7e](https://github.com/sinameraji/kimiflare/commit/0918a7e12e28002a5f6a707d82549539c520e965))
* add optional AI Gateway routing ([96ad68c](https://github.com/sinameraji/kimiflare/commit/96ad68cc562c3c5df06d21015cbd97ef216e9e60))
* add optional AI Gateway routing ([5b6ec67](https://github.com/sinameraji/kimiflare/commit/5b6ec6772f96b2e56de2a6a5e29e46ea6bb140a5))


### Bug Fixes

* **tui:** reduce flicker during streaming output ([4d3f543](https://github.com/sinameraji/kimiflare/commit/4d3f54304dc652a58f84cdfd242b87af4ec9aa4e))
* **tui:** reduce flicker during streaming output ([037002d](https://github.com/sinameraji/kimiflare/commit/037002d3100bde72755525acda0d5256bd595376))

## [0.21.0](https://github.com/sinameraji/kimiflare/compare/v0.20.3...v0.21.0) (2026-04-24)


### Features

* **agent:** send x-session-affinity header for prefix caching ([af04d7d](https://github.com/sinameraji/kimiflare/commit/af04d7d932148f935fba24641506d66f31863b9c))
* **agent:** send x-session-affinity header for prefix caching ([af04d7d](https://github.com/sinameraji/kimiflare/commit/af04d7d932148f935fba24641506d66f31863b9c))
* **agent:** send x-session-affinity header for prefix caching ([d4ad35f](https://github.com/sinameraji/kimiflare/commit/d4ad35f51498cfc1c352fffa7889e73011d12fb4))
* **agent:** send x-session-affinity header for prefix caching ([600c1b9](https://github.com/sinameraji/kimiflare/commit/600c1b96b3a6d2fc32784f0e85e0b061a67842d8))


### Bug Fixes

* configure release-please to use plain v tags ([764bd01](https://github.com/sinameraji/kimiflare/commit/764bd01d57038a5ddffb8835530e07b550d56b29))
* configure release-please to use plain v tags ([764bd01](https://github.com/sinameraji/kimiflare/commit/764bd01d57038a5ddffb8835530e07b550d56b29))
* configure release-please to use plain v tags ([86886f0](https://github.com/sinameraji/kimiflare/commit/86886f0b0fc725dd62a865acf77a620bdc186691))

## [0.20.3](https://github.com/sinameraji/kimiflare/compare/v0.18.0...v0.20.3) (2026-04-24)


### Bug Fixes

* manual release to sync stable version from 0.18.0 to 0.20.3 ([64f999d](https://github.com/sinameraji/kimiflare/commit/64f999d))

## [0.18.0](https://github.com/sinameraji/kimiflare/compare/v0.17.0...v0.18.0) (2026-04-24)


### Features

* strip reasoning_content from historical assistant messages ([63ca8aa](https://github.com/sinameraji/kimiflare/commit/63ca8aa6a4aad13861a9e0978d8dea94208e974f))
* strip reasoning_content from historical assistant messages ([d393964](https://github.com/sinameraji/kimiflare/commit/d39396420855935eb1dfb3a354eafbf077858df1)), closes [#94](https://github.com/sinameraji/kimiflare/issues/94)

## [0.17.0](https://github.com/sinameraji/kimiflare/compare/v0.16.0...v0.17.0) (2026-04-23)


### Features

* token-efficient tool result reducers with progressive disclosure ([1e42eb4](https://github.com/sinameraji/kimiflare/commit/1e42eb47104e019840e78338dba6016419491ea0))
* token-efficient tool result reducers with progressive disclosure ([0ce4bf8](https://github.com/sinameraji/kimiflare/commit/0ce4bf891d211a64ddaaa81e6d242857fa23d6a5))


### Bug Fixes

* lock down plan mode to strictly read-only bash commands ([d33c7cb](https://github.com/sinameraji/kimiflare/commit/d33c7cbc13e8b08d3280aa1fd3779f00225c5fdd))
* lock down plan mode to strictly read-only bash commands ([78b87fc](https://github.com/sinameraji/kimiflare/commit/78b87fc741723749700491fc5797e26dd4560f8b))
* show USD currency symbol in status bar cost display ([eb6e0ea](https://github.com/sinameraji/kimiflare/commit/eb6e0eacf2b426e1cf39c7226d2af840924e38d1))
* show USD currency symbol in status bar cost display ([80b43f2](https://github.com/sinameraji/kimiflare/commit/80b43f2360eeb8394794974c128e1bbf104ee059))
* show USD currency symbol in status bar cost display ([2378d8e](https://github.com/sinameraji/kimiflare/commit/2378d8e428472c2645d74f1a849412eb8f3b247c))

## [0.16.0](https://github.com/sinameraji/kimiflare/compare/v0.15.0...v0.16.0) (2026-04-23)


### Features

* compiled context architecture + storage cleanup ([88833f6](https://github.com/sinameraji/kimiflare/commit/88833f6d715b301420a28bf2dd3fd8d733fe1808))
* compiled context architecture + storage cleanup ([b323e80](https://github.com/sinameraji/kimiflare/commit/b323e80c27acc80a205f5b15a22f166d4e55e6c7))

## [0.15.0](https://github.com/sinameraji/kimiflare/compare/v0.14.0...v0.15.0) (2026-04-23)


### Features

* cache-stable prefix engineering + instrumentation ([8725816](https://github.com/sinameraji/kimiflare/commit/87258167a9401824ba8d1e8b40c27f19c5ab9262))
* cache-stable prefix engineering + instrumentation ([6b54723](https://github.com/sinameraji/kimiflare/commit/6b54723b9d80e6fe6d0cbf824dd0d52a7c38df0d))

## [0.14.0](https://github.com/sinameraji/kimiflare/compare/v0.13.7...v0.14.0) (2026-04-23)


### Features

* /cost command + cost debug logging ([1dcda71](https://github.com/sinameraji/kimiflare/commit/1dcda7185e926bdf85a4253907d24d9f9947e3df))
* add /cost command with session/today/month/all-time USD breakdown + cost debug logging ([77826a1](https://github.com/sinameraji/kimiflare/commit/77826a109afa11a12e39bfd1567eff4fdb6bd041))
* MCP server integration ([4660535](https://github.com/sinameraji/kimiflare/commit/46605351fec74a4f34ac572e83eac245c5a0b870))
* MCP server integration ([c5180df](https://github.com/sinameraji/kimiflare/commit/c5180df9a8ceefaddd94a512f8e5a52ca17f48a3))
* MCP server integration ([ad3ceee](https://github.com/sinameraji/kimiflare/commit/ad3ceeeed6bc820fdc64238fd97b98ba8d313cb6)), closes [#83](https://github.com/sinameraji/kimiflare/issues/83)


### Bug Fixes

* always show npm update instructions on /update ([7e491bf](https://github.com/sinameraji/kimiflare/commit/7e491bf15a6ec4877448898c06a48c6b322007de))
* brighten theme-picker hint text and add $ to cost display ([98476a1](https://github.com/sinameraji/kimiflare/commit/98476a110674c854487ff58ffaf3e35f1f458665))
* brighten theme-picker hint text and add $ to cost display ([1bc4616](https://github.com/sinameraji/kimiflare/commit/1bc4616a71b3630c921ebae4a2d84db0abed03a8))
* brighten theme-picker hint text and add $ to cost display ([d41487a](https://github.com/sinameraji/kimiflare/commit/d41487a9e74010e87ccb7406403ef906f1044b43))
* detect npm install correctly for update instructions ([0d6f479](https://github.com/sinameraji/kimiflare/commit/0d6f479e33d637389f9f9c5123601cb371ff2065))
* **ui:** memoize chat components to reduce flicker on large conversations ([342ea5b](https://github.com/sinameraji/kimiflare/commit/342ea5b415392031f7007b8fbde762655c0f9184))
* **ui:** memoize chat components to reduce flicker on large conversations ([c1df330](https://github.com/sinameraji/kimiflare/commit/c1df330e2c60b98590d9b13a73bcfd3bdd6d6f77))
* **ui:** memoize chat components to reduce flicker on large conversations ([7a01b2b](https://github.com/sinameraji/kimiflare/commit/7a01b2b801751a55e46307a35e394eb0801e0dd6))

## [0.13.7](https://github.com/sinameraji/kimiflare/compare/v0.13.6...v0.13.7) (2026-04-23)


### Bug Fixes

* **themes:** replace ANSI colors with truecolor hex and remove redundant themes ([86712a3](https://github.com/sinameraji/kimiflare/commit/86712a378c020472e4bc17d45e305c71d42b592a))
* **themes:** replace ANSI colors with truecolor hex and remove redundant themes ([539657a](https://github.com/sinameraji/kimiflare/commit/539657a31987edd7b6586e842360386d7a1c11d6))
* **themes:** replace ANSI colors with truecolor hex and remove redundant themes ([cb62898](https://github.com/sinameraji/kimiflare/commit/cb6289826223005189ec979cc0a2be3d6fee9eea))

## [0.13.6](https://github.com/sinameraji/kimiflare/compare/v0.13.5...v0.13.6) (2026-04-23)


### Reverts

* roll back memory-optimizations commit to isolate flashing bug ([1cd1bf7](https://github.com/sinameraji/kimiflare/commit/1cd1bf7b1d97cc0d39d1de63f3c400332ed1ca0a))

## [0.13.5](https://github.com/sinameraji/kimiflare/compare/v0.13.4...v0.13.5) (2026-04-23)


### Reverts

* roll ctrl+c interrupt work back to v0.12.0 behavior ([d10c104](https://github.com/sinameraji/kimiflare/commit/d10c104ba5ea0c834f4b0dd4559688585e8b62a5))

## [0.13.4](https://github.com/sinameraji/kimiflare/compare/v0.13.3...v0.13.4) (2026-04-23)


### Bug Fixes

* remove redundant global SIGINT handler causing screen flashing ([d332484](https://github.com/sinameraji/kimiflare/commit/d3324848ede678e6efdde0c8bba1460098a54493))
* remove redundant global SIGINT handler causing screen flashing ([bf46eb8](https://github.com/sinameraji/kimiflare/commit/bf46eb8cdc851149b5ce33490f9eb163847d5179))

## [0.13.3](https://github.com/sinameraji/kimiflare/compare/v0.13.2...v0.13.3) (2026-04-22)


### Bug Fixes

* prevent Ctrl+C from hanging the app ([2c2e7e5](https://github.com/sinameraji/kimiflare/commit/2c2e7e56416f1a9388641c1ec7301aad71360c12))
* prevent Ctrl+C from hanging the app ([c6e9c1f](https://github.com/sinameraji/kimiflare/commit/c6e9c1fd90c1a8cc401c3f53236dc4bd7da0a294))

## [0.13.2](https://github.com/sinameraji/kimiflare/compare/v0.13.1...v0.13.2) (2026-04-22)


### Bug Fixes

* robust co-author injection for all git commit-creating commands ([8698d03](https://github.com/sinameraji/kimiflare/commit/8698d03bd206048600e4897b17ae3f8c4a0770f4))
* robust co-author injection for all git commit-creating commands ([9053488](https://github.com/sinameraji/kimiflare/commit/9053488f74a98aa82647c1045405c88a1eda4a8d))

## [0.13.1](https://github.com/sinameraji/kimiflare/compare/v0.13.0...v0.13.1) (2026-04-22)


### Bug Fixes

* reduce memory growth during long sessions ([510a5bb](https://github.com/sinameraji/kimiflare/commit/510a5bbff24a4319743dcfa5a4d052a581c98967))
* reduce memory growth during long sessions ([de840a6](https://github.com/sinameraji/kimiflare/commit/de840a6cfcf5edf620e79ab1b465407579068c00))

## [0.13.0](https://github.com/sinameraji/kimiflare/compare/v0.12.0...v0.13.0) (2026-04-22)


### Features

* ctrl+c interrupts current operation without exiting session ([6a3da50](https://github.com/sinameraji/kimiflare/commit/6a3da50d312e850a0c45de883db00cd810f8d89a))
* ctrl+c interrupts current operation without exiting session ([3307c8f](https://github.com/sinameraji/kimiflare/commit/3307c8f51da22b461c972af68ab0556d1d22f317))

## [0.12.0](https://github.com/sinameraji/kimiflare/compare/v0.11.0...v0.12.0) (2026-04-22)


### Features

* image understanding support ([cbf9810](https://github.com/sinameraji/kimiflare/commit/cbf9810d1abb3357f2a21a2b9dbe2edcaec82875))
* image understanding support ([14b917f](https://github.com/sinameraji/kimiflare/commit/14b917fae2657944dc67bb3ad348d49c47167dfd))

## [0.11.0](https://github.com/sinameraji/kimiflare/compare/v0.10.0...v0.11.0) (2026-04-22)


### Features

* polished README, landing page, and plan-mode bash support ([#59](https://github.com/sinameraji/kimiflare/issues/59)) ([0b9eedd](https://github.com/sinameraji/kimiflare/commit/0b9eedd2d6a932421e8c9bad2b28255327935e02))

## [0.10.0](https://github.com/sinameraji/kimiflare/compare/v0.9.2...v0.10.0) (2026-04-22)


### Features

* allow read-only bash commands in plan mode ([#54](https://github.com/sinameraji/kimiflare/issues/54)) ([0cf518a](https://github.com/sinameraji/kimiflare/commit/0cf518aed0866a7c7337000b7f9492636137d720))


### Bug Fixes

* **docs:** remove stray X placeholders from landing page buttons ([#57](https://github.com/sinameraji/kimiflare/issues/57)) ([45515d2](https://github.com/sinameraji/kimiflare/commit/45515d2d5ede1a2d657be2b30edabc15faeec93b))

## [0.9.2](https://github.com/sinameraji/kimiflare/compare/v0.9.1...v0.9.2) (2026-04-22)


### Bug Fixes

* validate tool_call arguments JSON to prevent 400 BadRequest loops ([#52](https://github.com/sinameraji/kimiflare/issues/52)) ([e234417](https://github.com/sinameraji/kimiflare/commit/e234417cc0999c3eddd4d8a17532bdecc7d4220e))

## [0.9.1](https://github.com/sinameraji/kimiflare/compare/v0.9.0...v0.9.1) (2026-04-22)


### Bug Fixes

* make events capping automatic for all setEvents calls ([59da63b](https://github.com/sinameraji/kimiflare/commit/59da63b9556af5ae2d19a8564a2d7366337dc896))
* prevent memory leaks from unbounded events and timer churn ([6d91b89](https://github.com/sinameraji/kimiflare/commit/6d91b897d21554c7508ffeffe026ee6ef8fd086b))
* prevent memory leaks from unbounded events and timer churn ([ba0195b](https://github.com/sinameraji/kimiflare/commit/ba0195b9eb9b5bf515859e91c355211752320d18))

## [0.9.0](https://github.com/sinameraji/kimiflare/compare/v0.8.2...v0.9.0) (2026-04-22)


### Features

* add logo, badges, and MIT license ([c4d27ee](https://github.com/sinameraji/kimiflare/commit/c4d27ee08cfde50192fdfd86c9f4251d737ef607))
* add logo, badges, and MIT license to README ([4dc3249](https://github.com/sinameraji/kimiflare/commit/4dc3249077fd12091b837a50ee7f624112a6e451))


### Bug Fixes

* update default co-author email to kimiflare@proton.me ([84400ce](https://github.com/sinameraji/kimiflare/commit/84400ceccf95e19fc9f42100265e94ef2a2f04c4))
* update default co-author email to kimiflare@proton.me ([abe96cc](https://github.com/sinameraji/kimiflare/commit/abe96cc7c8d46a7d5e92e0e195d08bde5a36be9d))
* use existing project logo instead of generated SVG ([d7ca1ce](https://github.com/sinameraji/kimiflare/commit/d7ca1ce60a66e0ab75dea2c47b338cb05fc188ef))
* use existing project logo instead of generated SVG ([2112085](https://github.com/sinameraji/kimiflare/commit/21120851b596481876716f8d61f4672d8728ba6e))

## [0.8.2](https://github.com/sinameraji/kimiflare/compare/v0.8.1...v0.8.2) (2026-04-22)


### Bug Fixes

* prevent theme picker from closing on arrow keys ([a0bac95](https://github.com/sinameraji/kimiflare/commit/a0bac95d55932e2defa0f2b87a2c677ef089bf56))
* prevent theme picker from closing on arrow keys ([fc115fe](https://github.com/sinameraji/kimiflare/commit/fc115fedfbc45eeeb2e057b5d8f5b012889e1c70))

## [0.8.1](https://github.com/sinameraji/kimiflare/compare/v0.8.0...v0.8.1) (2026-04-22)


### Bug Fixes

* stale update cache and double arrow in theme picker ([913c230](https://github.com/sinameraji/kimiflare/commit/913c2301f53c9a02628c111ebdc1ad50abdcd432))
* stale update cache and double arrow in theme picker ([4572494](https://github.com/sinameraji/kimiflare/commit/4572494c02077ce50aa0b413d22c7c48428ac5ab))

## [0.8.0](https://github.com/sinameraji/kimiflare/compare/v0.7.1...v0.8.0) (2026-04-22)


### Features

* paginate /resume picker and add interactive theme picker with live preview ([e1239a9](https://github.com/sinameraji/kimiflare/commit/e1239a9782b80990578b7663d0d31a8d0b516e6a))
* paginate /resume picker and add interactive theme picker with live preview ([878dd89](https://github.com/sinameraji/kimiflare/commit/878dd893ae6b5884896b97a28a366b3404677764))
* runtime update nudge on startup + periodic checks ([e423678](https://github.com/sinameraji/kimiflare/commit/e423678eba25201043eb25593cb75ef854382da3))
* runtime update nudge on startup + periodic checks ([b8a1c31](https://github.com/sinameraji/kimiflare/commit/b8a1c31353c5c7cadfcce17410fb71bdf10e987d))

## [0.7.1](https://github.com/sinameraji/kimiflare/compare/v0.7.0...v0.7.1) (2026-04-22)


### Bug Fixes

* sanitize lone surrogates and improve AI error handling ([9f7fa71](https://github.com/sinameraji/kimiflare/commit/9f7fa71faea31ec31f7ce5be00d3dee08843d884))
* sanitize lone surrogates and improve AI error handling ([7b0a87f](https://github.com/sinameraji/kimiflare/commit/7b0a87fba58b2a368b1b9525d76039b90ac46b38))

## [0.7.0](https://github.com/sinameraji/kimiflare/compare/v0.6.0...v0.7.0) (2026-04-22)


### Features

* **ui:** add progress animations and clearer idle/busy states ([d0c43ae](https://github.com/sinameraji/kimiflare/commit/d0c43ae7dbcf0df93e218e4793154aa48ff66b4a))
* **ui:** add progress animations and clearer idle/busy states ([c08cb29](https://github.com/sinameraji/kimiflare/commit/c08cb299e8cae0907ca6205effe8c4a601980703))


### Bug Fixes

* remove clear msg, proactive updates, paste cursor, compact logs ([4a27c0e](https://github.com/sinameraji/kimiflare/commit/4a27c0ec99a890db2830df58a53a9e4051393249))
* remove clear msg, proactive updates, paste cursor, compact logs ([4f6068f](https://github.com/sinameraji/kimiflare/commit/4f6068fca908f47af7ccf683f6b7d68ced538ef0))

## [0.6.0](https://github.com/sinameraji/kimiflare/compare/v0.5.0...v0.6.0) (2026-04-22)


### Features

* **docs:** add Product Hunt badge, favicon, and SEO meta tags ([9a924a7](https://github.com/sinameraji/kimiflare/commit/9a924a769819e6d694096dbf140a2f427bd9eefd))
* **docs:** add Product Hunt badge, favicon, and SEO meta tags ([7641b7e](https://github.com/sinameraji/kimiflare/commit/7641b7ede4679388415a5a5d45aa8de096fb1986))
* **docs:** remove Claude Code reference and subscription language from landing copy ([f2eef80](https://github.com/sinameraji/kimiflare/commit/f2eef8085bcfa6fc4ac6d2b34977f5b546617efd))
* **docs:** update landing page terminal and copy ([b86954a](https://github.com/sinameraji/kimiflare/commit/b86954af225ea4c0129251a5e7898c85ec9bb645))
* **docs:** update landing page terminal simulation to match current UI/UX ([9ddaad8](https://github.com/sinameraji/kimiflare/commit/9ddaad8a493dc5bb63bc3995303833b4c2f94d66))


### Bug Fixes

* use sinameraji@gmail.com as default co-author email ([f82a45b](https://github.com/sinameraji/kimiflare/commit/f82a45bfbe893ef49f52a035d3bebc58a9771776))
* use sinameraji@gmail.com as default co-author email ([2456bc8](https://github.com/sinameraji/kimiflare/commit/2456bc8528026ad0ff2a6b208a092456049e4f21))

## [0.5.0](https://github.com/sinameraji/kimiflare/compare/v0.4.1...v0.5.0) (2026-04-22)


### Features

* auto-append co-author trailer to git commits ([fd6caf2](https://github.com/sinameraji/kimiflare/commit/fd6caf23d3abf889ff432dfe54c54f1d0b03a220))
* auto-append co-author trailer to git commits ([efb3ff6](https://github.com/sinameraji/kimiflare/commit/efb3ff69e98b5ce15c385b5d0270a0d44dc13668))

## [0.4.1](https://github.com/sinameraji/kimiflare/compare/v0.4.0...v0.4.1) (2026-04-22)


### Bug Fixes

* **update-check:** walk up dirs to find package.json and .git ([4198ed8](https://github.com/sinameraji/kimiflare/commit/4198ed8cd03552865bc5b5e7b4533c5b80f3e68e))
* **update-check:** walk up dirs to find package.json and .git ([66f4627](https://github.com/sinameraji/kimiflare/commit/66f4627985514fa1b6900234a859a687b6de5121))

## [0.4.0](https://github.com/sinameraji/kimiflare/compare/v0.3.1...v0.4.0) (2026-04-22)


### Features

* clean up first-run UI, chat layout, and onboarding ([d5eb188](https://github.com/sinameraji/kimiflare/commit/d5eb188ddf099aa22ca14c0899ac92175a3ddaae))
* clean up first-run UI, chat layout, and onboarding ([0bf41ae](https://github.com/sinameraji/kimiflare/commit/0bf41ae5c1bdae51b7c77ce2bf7155e369ef0e91))


### Bug Fixes

* remove automatic update-check spam on startup ([6826cca](https://github.com/sinameraji/kimiflare/commit/6826cca07d530d30228fe59117016ac066c9081b))
* remove unused onSuggestion prop from Welcome component ([9aef3fb](https://github.com/sinameraji/kimiflare/commit/9aef3fbe9a9a1793e28a72a21e15892dacbddef0))
* remove unused prop + configure release-please for ui commits ([03def7c](https://github.com/sinameraji/kimiflare/commit/03def7cb62746fd914359246fc67235c99b30ba7))

## [0.3.1](https://github.com/sinameraji/kimiflare/compare/v0.3.0...v0.3.1) (2026-04-21)


### Bug Fixes

* --version reads from package.json (was hardcoded 0.1.0) ([78952a1](https://github.com/sinameraji/kimiflare/commit/78952a11a9ffc66b6193102535b1dd885a75f919))
* --version reads from package.json instead of hardcoded 0.1.0 ([9e38b33](https://github.com/sinameraji/kimiflare/commit/9e38b33aa31ff8730ba594e9935e66e400a36960))

## [0.3.0](https://github.com/sinameraji/kimiflare/compare/v0.2.0...v0.3.0) (2026-04-21)


### Features

* UI polish, /init + KIMI.md, release-please ([6f38ea7](https://github.com/sinameraji/kimiflare/commit/6f38ea7bd566bcab87b0820522ad74f032f269cd))
* UI polish, /init + KIMI.md, release-please ([3d1f2f4](https://github.com/sinameraji/kimiflare/commit/3d1f2f4810288ee67a8081cafe12f89ffe25f69a))


### Bug Fixes

* dark theme legibility on Terminal.app — drop dim attribute ([bdbab32](https://github.com/sinameraji/kimiflare/commit/bdbab323ca1f2e4ac4858ff9b7dd1234021ddc69))
* dark theme legibility on Terminal.app (0.2.1) ([186a488](https://github.com/sinameraji/kimiflare/commit/186a48878459bc33e5407dbfb74d1ee9b56371e1))

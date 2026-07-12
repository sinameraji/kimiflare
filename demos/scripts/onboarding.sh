#!/usr/bin/env bash
# Simulates KimiFlare onboarding TUI output

clear
echo -e "\033[38;5;208mkimiflare\033[0m  Ready when you are."
echo ""
echo -e "  \033[90m› Explain this codebase\033[0m"
echo -e "  \033[90m› Find and fix a bug\033[0m"
echo -e "  \033[90m› Refactor a file\033[0m"
echo ""
echo -e "\033[90mType a message or /help for commands · ctrl-c to exit · shift+tab to cycle modes\033[0m"
echo ""
echo -e "\033[90m› \033[0m\033[97madd a /health endpoint\033[0m"
sleep 0.5
echo -e "\033[90m────────────────────────────────────────\033[0m"
sleep 0.3
echo -e "\033[90m  thinking… I'll need to read the server file first, then add the endpoint.\033[0m"
sleep 0.5
echo -e "  \033[90m⠋\033[0m read(src/server.ts)"
sleep 0.6
echo -e "  \033[32m✓\033[0m read(src/server.ts)"
sleep 0.3
echo -e "  \033[90m⠋\033[0m edit src/server.ts"
sleep 0.5
echo ""
echo -e "\033[38;5;208mPermission requested\033[0m"
echo -e "tool: \033[96medit\033[0m"
echo "action: edit src/server.ts"
echo ""
echo -e "\033[90m@@ -42,6 +42,10 @@"
echo -e "  app.get('/', …)"
echo -e "\033[32m+  app.get('/health', (_, res) => res.json({ ok: true }))\033[0m"
echo -e "  …\033[0m"
echo ""
echo -e "\033[38;5;208m›\033[0m Allow once   Allow for this session   Deny"
sleep 1
echo ""
echo -e "  \033[32m✓\033[0m edit src/server.ts"
sleep 0.3
echo -e "\033[97m  Done — added /health that returns { ok: true }.\033[0m"
sleep 0.5
echo -e "\033[90m────────────────────────────────────────\033[0m"
sleep 0.2
echo -e "\033[90m[edit]  k2.7  ·  medium  ·  done\033[0m"
sleep 0.2
echo -e "\033[90min 2,847 (1,203 cached)  ·  out 412  ·  ctx 12%  ·  \$0.00321\033[0m"
sleep 0.2
echo -e "\033[90m› \033[0m\033[97m_\033[0m"
sleep 2

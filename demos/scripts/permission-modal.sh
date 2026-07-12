#!/usr/bin/env bash
# Simulates KimiFlare permission modal with inline feedback

clear
echo -e "\033[90m› \033[0m\033[97mrefactor auth middleware into its own file\033[0m"
sleep 0.5
echo -e "\033[90m  thinking… I'll extract the auth logic to auth.ts and update imports.\033[0m"
sleep 0.5
echo -e "  \033[90m⠋\033[0m read(src/middleware/auth.ts)"
sleep 0.6
echo -e "  \033[32m✓\033[0m read(src/middleware/auth.ts)"
sleep 0.3
echo -e "  \033[90m⠋\033[0m edit src/middleware/auth.ts"
sleep 0.5
echo ""
echo -e "\033[38;5;208mPermission requested\033[0m"
echo -e "tool: \033[96medit\033[0m"
echo "action: edit src/middleware/auth.ts"
echo ""
echo -e "\033[90m@@ -1,15 +1,5 @@"
echo -e "- export function auth(req, res, next) {"
echo -e "-   const token = req.headers.authorization;"
echo -e "-   ..."
echo -e "+ export { auth } from './auth';\033[0m"
echo ""
echo -e "\033[38;5;208m›\033[0m Allow once   Allow for this session   Deny"
sleep 1.5
echo ""
echo -e "\033[31m✗ Denied\033[0m edit src/middleware/auth.ts"
sleep 0.5
echo -e "\033[90m  What should I do instead? (inline feedback)\033[0m"
sleep 0.3
echo -e "\033[97m  › create a new file instead of editing the existing one\033[0m"
sleep 0.6
echo -e "\033[90m  thinking… I'll create src/auth/index.ts with the extracted logic.\033[0m"
sleep 0.5
echo -e "  \033[90m⠋\033[0m write src/auth/index.ts"
sleep 0.6
echo -e "  \033[32m✓\033[0m write src/auth/index.ts"
sleep 0.3
echo -e "\033[97m  Created src/auth/index.ts with the extracted middleware. Updated imports in app.ts.\033[0m"
sleep 2

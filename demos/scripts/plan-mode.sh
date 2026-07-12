#!/usr/bin/env bash
# Simulates KimiFlare plan mode blocking mutations

clear
echo -e "\033[90m› \033[0m\033[97m/mode plan\033[0m"
sleep 0.4
echo -e "\033[33m[plan]\033[0m \033[90mMode switched to plan. Mutating tools are blocked.\033[0m"
sleep 0.3
echo ""
echo -e "\033[90m› \033[0m\033[97mhow does the auth flow work in this codebase?\033[0m"
sleep 0.5
echo -e "\033[90m  thinking… I'll search for auth-related files and read the middleware.\033[0m"
sleep 0.5
echo -e "  \033[90m⠋\033[0m glob **/*auth*"
sleep 0.6
echo -e "  \033[32m✓\033[0m glob **/*auth*"
sleep 0.3
echo -e "  \033[90m⠋\033[0m read(src/middleware/auth.ts)"
sleep 0.6
echo -e "  \033[32m✓\033[0m read(src/middleware/auth.ts)"
sleep 0.3
echo -e "  \033[90m⠋\033[0m grep 'authenticate|authorize|jwt|token' src/"
sleep 0.6
echo -e "  \033[32m✓\033[0m grep 'authenticate|authorize|jwt|token' src/"
sleep 0.3
echo -e "  \033[90m⠋\033[0m web-search 'best practices JWT auth middleware express'"
sleep 0.8
echo -e "  \033[32m✓\033[0m web-search 'best practices JWT auth middleware express'"
sleep 0.3
echo -e "\033[97m  The auth flow uses JWT tokens in an Authorization header.\033[0m"
sleep 0.2
echo -e "\033[97m  1. Client sends Bearer token in request header\033[0m"
sleep 0.2
echo -e "\033[97m  2. Middleware verifies signature with SECRET_KEY\033[0m"
sleep 0.2
echo -e "\033[97m  3. Decoded payload attached to req.user\033[0m"
sleep 0.2
echo -e "\033[97m  4. Role-based access control checked per route\033[0m"
sleep 0.4
echo -e "  \033[90m⠋ edit src/middleware/auth.ts\033[0m"
sleep 0.3
echo -e "\033[31m✗ BLOCKED\033[0m \033[90medit is not allowed in plan mode. Switch to /mode edit or /mode auto.\033[0m"
sleep 2

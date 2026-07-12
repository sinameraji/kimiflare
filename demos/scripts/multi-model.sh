#!/usr/bin/env bash
# Simulates KimiFlare switching between models

clear
echo -e "\033[90m› \033[0m\033[97m--model kimi-k2.7\033[0m"
sleep 0.4
echo -e "\033[33m[kimi-k2.7]\033[0m \033[90mSwitched to Kimi K2.7 (262k context)\033[0m"
sleep 0.3
echo ""
echo -e "\033[90m› \033[0m\033[97mexplain the trade-offs between REST and GraphQL\033[0m"
sleep 0.5
echo -e "\033[97m  REST and GraphQL both expose APIs over HTTP, but differ in flexibility:\033[0m"
echo ""
echo -e "  \033[97mREST\033[0m"
echo -e "    • Simple, cache-friendly, widely supported"
echo -e "    • Fixed endpoints can over/under-fetch"
echo -e "    • Versioning via URL (v1, v2)"
echo ""
echo -e "  \033[97mGraphQL\033[0m"
echo -e "    • Client specifies exact fields needed"
echo -e "    • Single endpoint, introspection built-in"
echo -e "    • More complex caching, N+1 risk"
sleep 1.5
echo ""
echo -e "\033[90m› \033[0m\033[97m--model glm-5.2\033[0m"
sleep 0.4
echo -e "\033[33m[glm-5.2]\033[0m \033[90mSwitched to GLM-5.2 (128k context)\033[0m"
sleep 0.3
echo ""
echo -e "\033[90m› \033[0m\033[97mexplain the trade-offs between REST and GraphQL\033[0m"
sleep 0.5
echo -e "\033[97m  Here's a concise comparison:\033[0m"
echo ""
echo -e "  \033[97mREST:\033[0m Standard HTTP verbs, easy to cache, good for simple CRUD."
echo -e "        Risk: multiple round-trips, fixed response shapes."
echo ""
echo -e "  \033[97mGraphQL:\033[0m Query language, precise data fetching, strong typing."
echo -e "           Risk: resolver complexity, caching challenges."
echo ""
echo -e "  \033[97mChoose REST for simplicity and caching.\033[0m"
echo -e "  \033[97mChoose GraphQL for complex, evolving data requirements.\033[0m"
sleep 2

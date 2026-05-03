FROM node:20-slim

WORKDIR /opt/kimiflare

# Copy built agent bundle
COPY agent/dist/remote-agent.mjs ./dist/remote-agent.js
COPY agent/dist/remote-agent.mjs.map ./dist/remote-agent.mjs.map

# Install git for repo operations
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

# The agent runs from /workspace
WORKDIR /workspace

ENTRYPOINT ["node", "/opt/kimiflare/dist/remote-agent.js"]

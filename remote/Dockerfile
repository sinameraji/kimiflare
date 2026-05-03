# kimiflare remote agent sandbox image
# Based on node:20-bookworm for rich build toolchain support

FROM node:20-bookworm

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    wget \
    jq \
    build-essential \
    python3 \
    python3-pip \
    python3-venv \
    golang-go \
    rustc \
    cargo \
    && rm -rf /var/lib/apt/lists/*

# Install Rust via rustup (system rustc may be outdated)
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

# Set up workspace
WORKDIR /workspace

# Pre-install common package managers
RUN npm install -g pnpm yarn

# Copy and install remote agent dependencies
COPY remote/agent/package.json /opt/kimiflare/package.json
WORKDIR /opt/kimiflare
RUN npm install

# Copy remote agent source
COPY remote/agent/src /opt/kimiflare/src
COPY src/agent /opt/kimiflare/src/agent
COPY src/tools /opt/kimiflare/src/tools
COPY src/tasks-state.ts /opt/kimiflare/src/tasks-state.ts
COPY src/mode.ts /opt/kimiflare/src/mode.ts
COPY src/util /opt/kimiflare/src/util
COPY src/memory /opt/kimiflare/src/memory
COPY src/pricing.ts /opt/kimiflare/src/pricing.ts
COPY src/storage-limits.ts /opt/kimiflare/src/storage-limits.ts
COPY src/cost-debug.ts /opt/kimiflare/src/cost-debug.ts
COPY src/usage-tracker.ts /opt/kimiflare/src/usage-tracker.ts
COPY tsconfig.json /opt/kimiflare/tsconfig.json

# Build the remote agent
RUN npx tsc --outDir dist --module esnext --moduleResolution bundler --target es2022 --esModuleInterop --skipLibCheck

# Entrypoint
ENV NODE_ENV=production
WORKDIR /workspace
ENTRYPOINT ["node", "/opt/kimiflare/dist/remote-agent.js"]

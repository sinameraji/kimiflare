# kimiflare remote agent sandbox image
# This image runs the pre-built remote agent bundle inside a Cloudflare Sandbox.

FROM node:20-bookworm

# Install system dependencies for common build toolchains
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

# Pre-install common package managers
RUN npm install -g pnpm yarn

# Set up workspace
WORKDIR /workspace

# Copy pre-built remote agent bundle
# This bundle is built by `npm run build:remote-agent` before building the image
COPY dist/remote-agent.mjs /opt/kimiflare/remote-agent.mjs

ENV NODE_ENV=production
WORKDIR /workspace
ENTRYPOINT ["node", "/opt/kimiflare/remote-agent.mjs"]

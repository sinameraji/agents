# Dreamweav sandbox image: OpenCode preinstalled + git/python/tools + the pi & KimiFlare harnesses
# + the Dreamweav bridge that hosts pi / KimiFlare / the built-in AI-SDK loop.
FROM docker.io/cloudflare/sandbox:0.12.7-opencode

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ripgrep unzip zstd ca-certificates curl python3 python-is-python3 \
  && rm -rf /var/lib/apt/lists/*

RUN git config --system user.email "agent@dreamweav.com" \
  && git config --system user.name "Dreamweav Agent" \
  && git config --system init.defaultBranch main

# Harness CLIs (best-effort — if a registry hiccups the image still builds with OpenCode + AI-SDK).
RUN npm install -g --ignore-scripts @earendil-works/pi-coding-agent kimiflare || true

# The Dreamweav bridge (built by `npm run build -w bridge`).
COPY bridge/dist/bridge.mjs /opt/dreamweav/bridge.mjs

EXPOSE 7700 4096 3000 5173 8080

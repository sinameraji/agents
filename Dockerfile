# Dreamweav sandbox image: OpenCode preinstalled + git/python/tools + the pi & KimiFlare harnesses
# + the Dreamweav bridge that hosts pi / KimiFlare / the built-in AI-SDK loop.
FROM docker.io/cloudflare/sandbox:0.12.7-opencode

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ripgrep unzip zstd ca-certificates curl gnupg python3 python-is-python3 \
  && rm -rf /var/lib/apt/lists/*

# Node.js 22 — the base opencode image ships a compiled binary and has no Node runtime, which the
# Dreamweav bridge (and the pi/KimiFlare npm CLIs) need.
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
  && apt-get install -y --no-install-recommends nodejs \
  && rm -rf /var/lib/apt/lists/* \
  && node --version

RUN git config --system user.email "agent@dreamweav.com" \
  && git config --system user.name "Dreamweav Agent" \
  && git config --system init.defaultBranch main

# cloudflared: the Sandbox SDK's quick-tunnel API (sandbox.tunnels) spawns this to mint
# trycloudflare.com preview URLs — the domain-less preview fallback for self-hosters.
RUN curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
      -o /usr/local/bin/cloudflared \
  && chmod +x /usr/local/bin/cloudflared \
  && cloudflared --version

# Harness CLIs (best-effort — if a registry hiccups the image still builds with OpenCode + AI-SDK).
# Pinned: version drift against pi's version-sensitive RPC (and a silently harness-less image
# when the registry hiccups) is worse than a deliberate bump. Update versions consciously.
RUN npm install -g --ignore-scripts @earendil-works/pi-coding-agent@0.84.2 kimiflare@0.99.0


EXPOSE 7700 4096 3000 5173 8080

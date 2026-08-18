# Dreamweav sandbox image: OpenCode preinstalled + git/ripgrep/gh for repo work.
FROM docker.io/cloudflare/sandbox:0.12.7-opencode

# Repo + search tooling (some may already be present in the base image; harmless if so).
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ripgrep unzip zstd ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

# Default git identity for agent commits (overridden per-session where needed).
RUN git config --system user.email "agent@dreamweav.com" \
  && git config --system user.name "Dreamweav Agent" \
  && git config --system init.defaultBranch main

# Ports exposed for local `wrangler dev` (production auto-exposes). 4096 = OpenCode server.
EXPOSE 4096 3000 5173 8080

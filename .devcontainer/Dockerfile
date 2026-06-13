FROM node:24-bookworm

# Dev + firewall tooling, plus Chromium for the headless CDP UI smoke.
RUN apt-get update && apt-get install -y --no-install-recommends \
      git jq curl ca-certificates procps lsof less \
      iptables ipset iproute2 dnsutils \
      chromium \
      sudo \
    && rm -rf /var/lib/apt/lists/*

# Yarn 4 through Corepack (the repo pins yarn@4.17.0 via `packageManager`, and
# ships the release under .yarn/releases, so Corepack just needs enabling).
RUN corepack enable

# Firewall entrypoint. NOTE: we do NOT use /usr/local/bin/init-firewall.sh — the
# claude-code devcontainer feature installs its OWN upstream init-firewall.sh at
# that path (after this stage), and that upstream script flushes the nat table,
# which breaks Docker's embedded DNS. So we bake a differently-named wrapper that
# the feature won't clobber; it execs the repo's real script from the bind mount
# (via bash, so it doesn't depend on the file's executable bit). The non-root
# `node` user may run ONLY this wrapper and the node_modules chown via sudo.
RUN printf '#!/bin/bash\nexec bash /workspace/.devcontainer/init-firewall.sh "$@"\n' \
       > /usr/local/bin/terrain-firewall \
    && chmod +x /usr/local/bin/terrain-firewall \
    && printf 'node ALL=(root) NOPASSWD: /usr/local/bin/terrain-firewall, /usr/bin/chown * /workspace/node_modules\n' \
       > /etc/sudoers.d/terrain \
    && chmod 0440 /etc/sudoers.d/terrain

# Pre-create the claude-code-config volume's mountpoint as `node`-owned. Without
# this, Docker creates the named volume root-owned on first mount (the image has
# nothing at this path to inherit ownership from), and the non-root `node` user
# can't write to it — breaking every Claude Code session that uses this container.
RUN mkdir -p /home/node/.claude && chown -R node:node /home/node/.claude

# Browser-based `claude /login` can't complete its localhost OAuth callback inside
# a container, so we authenticate with a long-lived token from `claude setup-token`
# (run on the host). Every interactive shell loads it from the gitignored repo file
# .devcontainer/claude-auth.env (bind-mounted at /workspace), if present.
RUN printf '\n# Load Claude Code OAuth token from the gitignored repo env file, if present.\nif [ -f /workspace/.devcontainer/claude-auth.env ]; then set -a; . /workspace/.devcontainer/claude-auth.env; set +a; fi\n' \
       >> /home/node/.bashrc

USER node

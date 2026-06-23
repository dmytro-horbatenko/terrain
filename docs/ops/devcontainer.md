# Hardened devcontainer (for `--dangerously-skip-permissions`)

Run Claude Code inside an isolated Docker container so a bypassed session can't
touch your host or reach arbitrary network hosts. Claude runs as the non-root
`node` user; your repo is bind-mounted in, so edits still land in your local
working tree. Postgres runs as a sibling Compose service; egress is firewalled to
an allowlist.

> ⚠️ A container is not airtight: with `--dangerously-skip-permissions` a malicious
> project could still exfiltrate anything *inside* the container (including the
> Claude credentials in `~/.claude`). Use it only with trusted repos (this one is
> yours), don't mount host secrets, and keep an eye on what Claude does.

## What's in `.devcontainer/`

| File | Role |
|---|---|
| `devcontainer.json` | Compose wiring, `node` user, port forwards (3000/5180), `~/.claude` persistence, post-create/start hooks |
| `docker-compose.yml` | Adds the `app` service next to the repo-root `db` (Postgres) service; sets `DATABASE_URL=…@db:5432` |
| `Dockerfile` | `node:24` + Yarn 4 (Corepack) + Chromium (for the UI smoke) + firewall tooling; scoped `sudo` for `node` |
| `init-firewall.sh` | Default-deny egress with an editable allowlist; allows the Compose subnet so the app reaches `db` |
| `install-claude-plugins.sh` | Installs the superpowers/skill-creator/code-simplifier plugins into the container's `~/.claude` (see below) |

### Claude Code plugins

The `claude-code-config` volume (`~/.claude` inside the container) starts empty —
it's deliberately decoupled from your host `~/.claude`, so none of your host
plugins carry over automatically. `postCreateCommand` runs
`install-claude-plugins.sh`, which adds the `claude-plugins-official` marketplace
and installs/enables **superpowers** (brainstorming, subagent-driven-development,
dispatching-parallel-agents, TDD, writing-plans, systematic-debugging, etc.),
**skill-creator**, and **code-simplifier** at user scope. Every subcommand is
idempotent, so it's safe on rebuilds. This does *not* carry over loose personal
skills from your host's `~/.claude/skills/` (those aren't plugins) — only what's
installable from the marketplace.

## What you need installed (one time)

1. **Docker** — you already run OrbStack, which works.
2. **VS Code** + the **Dev Containers** extension
   (`ms-vscode-remote.remote-containers`).
   - No VS Code? Use the CLI instead: `npm i -g @devcontainers/cli`.

## Using it

1. **Commit a baseline first.** Bypass mode has no per-action review; a git commit
   is your only clean recovery point.
2. Open the repo in VS Code → Command Palette (`Cmd+Shift+P`) →
   **Dev Containers: Reopen in Container**. First build takes a few minutes
   (pulls images, installs deps, runs `prisma generate` + `yarn build`).
   - CLI equivalent: `devcontainer up --workspace-folder .` then
     `devcontainer exec --workspace-folder . bash`.
3. **Sign in** (first time only — it persists in the `claude-code-config` volume):
   ```bash
   claude          # then follow the auth prompt
   ```
   If the browser callback doesn't reach the container, copy the code and paste it
   at the prompt.
4. **Bring up the app data** (Postgres is already running as the `db` service):
   ```bash
   yarn workspace @terrain/api exec prisma migrate deploy
   yarn workspace @terrain/api exec tsx prisma/seed.ts
   ```
5. **Run Claude in bypass mode:**
   ```bash
   claude --dangerously-skip-permissions
   ```
6. **Run / verify the app** (inside the container):
   ```bash
   yarn workspace @terrain/api start &     # :3000 (forwarded to your host)
   yarn workspace @terrain/web dev &       # :5180 (forwarded)
   node scripts/smoke.mjs                  # uses Chromium via $BRAVE_BIN
   ```
   Open http://localhost:5180 in your host browser (ports are auto-forwarded).

## What changes vs. host development

- **No `docker compose up`** for Postgres — it starts automatically as the `db`
  service. `DATABASE_URL` points at `db:5432` (set in the Compose overlay), so
  `apps/api/.env`'s `localhost:5433` is ignored inside the container.
- **UI smoke uses Chromium**, not host Brave — `BRAVE_BIN=/usr/bin/chromium` is
  preset and `scripts/smoke.mjs` passes `--no-sandbox`. No action needed.
- **node_modules is container-local** (a named volume), so host darwin binaries and
  container linux binaries don't collide. First boot runs `yarn install` for you.

## Customizing

- **Network allowlist:** edit `ALLOWED_DOMAINS` in `.devcontainer/init-firewall.sh`
  and rebuild (or re-run `sudo /usr/local/bin/init-firewall.sh`). If a tool can't
  reach a host, it's almost always a missing allowlist entry — the script prints a
  warning if `api.anthropic.com` is unreachable or if egress isn't locked down.
- **Drop the firewall** (rely on host network controls): remove `cap_add` from the
  Compose overlay and the `postStartCommand` from `devcontainer.json`.
- **Forbid bypass entirely** on a machine: set
  `permissions.disableBypassPermissionsMode: "disable"` in managed settings.

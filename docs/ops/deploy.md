# Production deploy runbook (self-hosted Linux VPS)

Companion to `docs/ops/local-dev.md`. Covers taking Terrain from "runs on my
laptop" to "runs on my rented server," matching the hardening described in
the security review report.

The local SSH alias `game` connects as `uyuyuy@terrain.yarre.uk` with the
configured personal key. The deployment
directory is `/home/uyuyuy/apps/terrain/consistency`. That directory is not a
Git checkout. The server is too small for image builds. Build Linux images on
a stronger machine, transfer them, and run Compose with `--no-build`.
Commands below use fish on the server.

## 1. Server prep (one time)

- Point `DOMAIN`'s A/AAAA record at the server's IP before starting Caddy —
  it requests a Let's Encrypt certificate for that name on first boot and
  will fail (or fall back to HTTP) if the DNS isn't live yet.
- Install Docker Engine + the Compose plugin.
- Firewall: only 22 (SSH), 80/tcp, and 443/tcp need to be open for Terrain.
  ```bash
  sudo ufw allow 80/tcp
  sudo ufw allow 443/tcp
  ```
  If `ufw` isn't active yet on this box, also run `sudo ufw allow 22/tcp` and
  `sudo ufw enable` — but check `sudo ufw status verbose` **first**. On a box
  already running something else (e.g. a game server, a VPN), `ufw` may
  already be active with its own rules; `allow` only adds a rule, it never
  removes existing ones, so it's always safe to run — but `enable` on an
  *inactive* firewall applies its default-deny policy immediately, which can
  cut off a service's ports that were reachable un-firewalled until now. Add
  rules for any other service's ports first if you're enabling `ufw` for the
  first time on a box that already runs something else.

  Postgres (5432) and the API (3000) are **not** exposed on the host at all —
  `docker-compose.prod.yml` keeps them on an internal Docker network only, so
  there's nothing to firewall there. Caddy's global options
  (`apps/web/Caddyfile`) also restrict it to HTTP/1.1 + HTTP/2, so it never
  tries to bind UDP/443 — safe even if another service already owns that port
  (e.g. a UDP-443 VPN/proxy), since it's a distinct protocol+port pair from
  the TCP/443 Caddy actually needs.
- SSH: key-only auth, disable root login and password auth
  (`PasswordAuthentication no`, `PermitRootLogin no` in `sshd_config`), and
  turn on unattended security upgrades (`unattended-upgrades` package).
- These are general server-hardening steps, not Terrain-specific — worth
  doing for any box exposed to the internet.

## 2. Configure secrets

Neither file below is committed — both are gitignored.

```bash
cp .env.production.example .env.production
# fill in POSTGRES_PASSWORD (openssl rand -hex 24 — hex, not base64; the
# value is spliced unescaped into a connection-string URL, and base64's `/`
# and `+` break URL parsing there) and DOMAIN

cp apps/api/.env.example apps/api/.env
# fill in JWT_SECRET (openssl rand -base64 48)
# CORS_ORIGIN=https://<your-domain>
# NODE_ENV=production
```

### Read-only MCP connections (optional)

Terrain exposes one read-only remote MCP tool at
`https://<your-domain>/api/mcp`. ChatGPT and Claude connect from their cloud
services, so the URL must be reachable over public HTTPS; a server running only
on localhost cannot be connected directly.

Availability depends on the client account and workspace:

- ChatGPT custom MCP apps use developer mode. The account/workspace must permit
  custom apps, and workspace roles or RBAC may restrict who can create, test,
  or publish one. Check the current
  [ChatGPT developer mode requirements](https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt-beta)
  rather than assuming a particular plan has access.
- Claude must show custom remote connectors for the account. On Team and
  Enterprise, an Owner or Primary Owner must add the connector before members
  connect it; follow Anthropic's
  [remote MCP connector instructions](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).

Configure each client as follows:

1. Start creating the custom app/connector with the remote server URL
   `https://<your-domain>/api/mcp`, choose OAuth, and copy the **exact callback
   URL displayed by that client**. Do not guess or normalize it.
2. Generate three independent values. Never reuse `JWT_SECRET`,
   `MCP_TOKEN_SECRET`, or a client secret:

   ```bash
   openssl rand -hex 32 # MCP_TOKEN_SECRET
   openssl rand -hex 32 # ChatGPT OAuth client secret
   openssl rand -hex 32 # Claude OAuth client secret
   ```

3. Set the following in `apps/api/.env`. Paste the separately generated value
   into the `MCP_TOKEN_SECRET` setting. Keep `MCP_OAUTH_CLIENTS` on one line and
   replace every `$...` placeholder with its generated value or exact callback:

   ```dotenv
   MCP_PUBLIC_API_URL=https://<your-domain>/api
   WEB_BASE_URL=https://<your-domain>
   MCP_TOKEN_SECRET=
   MCP_OAUTH_CLIENTS=[{"id":"chatgpt","name":"ChatGPT","secret":"$CHATGPT_CLIENT_SECRET","redirectUris":["$EXACT_CHATGPT_CALLBACK_URL"]},{"id":"claude","name":"Claude","secret":"$CLAUDE_CLIENT_SECRET","redirectUris":["$EXACT_CLAUDE_CALLBACK_URL"]}]
   MCP_ALLOWED_ORIGINS=
   ```

   `MCP_PUBLIC_API_URL` is the public API URL ending in `/api`, not the MCP
   endpoint itself. `WEB_BASE_URL` is the public web origin used for the
   browser approval redirect. Leave `MCP_ALLOWED_ORIGINS` empty unless a client
   actually sends an `Origin`; server-to-server clients normally omit it.
4. In each client's advanced OAuth settings, enter its matching client ID
   (`chatgpt` or `claude`) and matching generated client secret. For ChatGPT,
   select `client_secret_post`; its current connector flow includes PKCE with
   that method. The callback configured in Terrain must remain byte-for-byte
   identical to the callback shown by that client.
5. Complete the client setup. Terrain's discovery metadata advertises
   `offline_access`, and the authorization request must include it for durable
   connectivity. Terrain then issues a rotating refresh token; advertising the
   scope without actually issuing a refresh token is insufficient.
6. Deploy the changed images using steps 3–4 below. Confirm
   `20260724000002_mcp_oauth` is applied. Never use `migrate reset`.

After authorization, **Settings → AI connections** lists the client grant.
Disconnecting there revokes that client's grant and its refresh-token families;
already-issued access tokens and old refresh tokens stop working immediately.
Removing the app only in ChatGPT or Claude does not replace server-side
revocation.

Verify the deployed connection before relying on it:

```bash
curl -fsS https://<your-domain>/.well-known/oauth-protected-resource
curl -fsS https://<your-domain>/.well-known/oauth-authorization-server
curl -i https://<your-domain>/api/mcp \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"smoke","version":"1"}}}'
```

The discovery documents must name the public issuer, `/api/oauth/*` endpoints,
`learning:read`, and `offline_access`. The unauthenticated MCP request must
return `401` with `resource_metadata` and `scope="learning:read"`. Then complete
OAuth in each permitted client, confirm `tools/list` exposes only
`get_learning_context`, and compare calls with no topic and with
`Accounts, transactions & gas` against the same user's
`/api/learning/context` REST responses. Finally disconnect in Terrain Settings
and confirm the old access and refresh credentials can no longer reconnect.

## 3. Build and transfer images off-server

Commit the intended source changes on the build machine first. On the server, run
`uname -m`: use `linux/amd64` for `x86_64` or `linux/arm64` for `aarch64`.
Start Docker/OrbStack on the build machine. From the app revision to deploy,
run these commands locally (shown for a POSIX shell):

```sh
tag=$(git rev-parse --short HEAD)
platform=linux/amd64 # change to linux/arm64 for an aarch64 server
docker buildx build --platform "$platform" --load -t "terrain-api:$tag" -f apps/api/Dockerfile .
docker buildx build --platform "$platform" --load -t "terrain-web:$tag" -f apps/web/Dockerfile .
docker save "terrain-api:$tag" "terrain-web:$tag" | gzip -1 > "/tmp/terrain-images-$tag.tar.gz"
scp "/tmp/terrain-images-$tag.tar.gz" game:/tmp/
```

The archive is a transfer artifact, not a database backup. Its tag identifies
the app revision used to build it. Rebuild it for app-code changes; a later
documentation-only commit does not change the image payload.

## 4. Load, migrate, and start on the server

Connect with `ssh game`. In fish, use the tag in the
transferred archive name (for example, `8a40163`):

```fish
cd /home/uyuyuy/apps/terrain/consistency
ls -l docker-compose.prod.yml .env.production apps/api/.env # confirm files exist; do not print secrets
set -gx TERRAIN_IMAGE_TAG 8a40163 # replace with the transferred archive's tag
gzip -dc /tmp/terrain-images-$TERRAIN_IMAGE_TAG.tar.gz | docker load
printf 'services:\n  api:\n    image: terrain-api:%s\n    pull_policy: never\n  web:\n    image: terrain-web:%s\n    pull_policy: never\n' $TERRAIN_IMAGE_TAG $TERRAIN_IMAGE_TAG > /tmp/terrain-prebuilt.yml

docker compose -f docker-compose.prod.yml --env-file .env.production up -d db
docker compose -f docker-compose.prod.yml --env-file .env.production exec db sh -c 'until pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"; do sleep 1; done'
mkdir -p backups
set backup "backups/terrain-before-update-"(date -u +%Y%m%dT%H%M%SZ)".dump"
docker compose -f docker-compose.prod.yml --env-file .env.production exec -T db sh -c 'exec pg_dump -Fc -U "$POSTGRES_USER" "$POSTGRES_DB"' > $backup
docker compose -f docker-compose.prod.yml --env-file .env.production exec -T db pg_restore --list < $backup > /dev/null

docker compose -f docker-compose.prod.yml -f /tmp/terrain-prebuilt.yml --env-file .env.production run --rm --no-deps api ../../node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma
docker compose -f docker-compose.prod.yml -f /tmp/terrain-prebuilt.yml --env-file .env.production run --rm --no-deps api ../../node_modules/.bin/prisma migrate status --schema prisma/schema.prisma
docker compose -f docker-compose.prod.yml -f /tmp/terrain-prebuilt.yml --env-file .env.production up -d --no-build api web
docker compose -f docker-compose.prod.yml -f /tmp/terrain-prebuilt.yml --env-file .env.production ps
```

Stop if the backup or migration command fails. `migrate deploy` applies pending
migrations without resetting existing data. The API image contains Prisma;
the server only loads images, runs the migration, and restarts containers.
Compose only auto-loads a file named `.env`, so keep `--env-file .env.production`
on every production command. Use both Compose files for later API/web commands
in this deployment; the override selects the loaded images and `--no-build`
prevents a server build.

## 5. Verify

- `https://<your-domain>` loads the app and the browser shows a valid
  Let's Encrypt cert (Caddy handles renewal automatically).
- `docker compose -f docker-compose.prod.yml --env-file .env.production logs -f api` — no `JWT_SECRET`
  or CORS startup errors.
- Register a real account and confirm login/logout round-trips (cookie is
  `Secure` + `httpOnly` in production — check the browser's cookie inspector).

## 6. Updates

Repeat steps 3–4 with a new tag. Keep the previous images on the server until
the updated app is verified, so rollback remains possible. There is no Git
repository on this server: transferred images carry application code and
migrations. If `docker-compose.prod.yml` itself changes, copy that file
separately and review it before replacing the server copy; keep the server's
`.env.production` and `apps/api/.env` files. A local database dump is not an
app image.

## 7. Telegram digest

Set the following optional env vars in `apps/api/.env` to enable hourly
digest summaries and streak nudges via Telegram:

```
TELEGRAM_BOT_TOKEN=<from @BotFather>
TELEGRAM_BOT_USERNAME=<@yourbot>
TELEGRAM_WEBHOOK_URL=https://<DOMAIN>/api/telegram/webhook
TELEGRAM_WEBHOOK_SECRET=<openssl rand -hex 32>
WEB_BASE_URL=https://<DOMAIN>
```

In production:
- The webhook URL is `https://<DOMAIN>/api/telegram/webhook`.
- Caddy's `handle_path /api/*` already strips the `/api` prefix and forwards to
  `api:3000`, so **no Caddyfile change is needed**.
- The webhook registers itself on API boot (idempotent).

All five env vars are optional; if unset, the bot integration is disabled.

## 8. Backups

The only state that matters is the `terrain_pg` Postgres volume. Take a
logical backup regularly and copy it off-box:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production exec db \
  sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > terrain-$(date +%F).sql
```

Never run `docker compose down -v` on this file — it deletes the volume (and
your only copy of your learning history) along with the containers.

## One-user Web3 source-plan rollout

The legacy Web3 reset is a deployment-ordered, one-user operation with stricter
backup, count, cross-domain, and human-commit gates. Use
[`web3-source-plan-production-rollout.md`](web3-source-plan-production-rollout.md);
its build-before-migrate-before-API-start order supersedes steps 3–4 above for
that rollout. Do not adapt the general update commands into an ad hoc reset.

## What this deliberately does not cover

- Multi-factor auth, password reset / email verification — not built into
  the app yet (see the security report's "proposed, not fixed" section).
- A CI pipeline / automated dependency scanning (`yarn npm audit`, Dependabot,
  or similar) — worth adding once this is pushed to a real git remote.
- Centralized log shipping / alerting — `docker compose logs` is the extent
  of it today; fine for a single-user instance, revisit if that changes.

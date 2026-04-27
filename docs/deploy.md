# Production Deploy Guide

This guide walks you through deploying LucidIndex on your homelab, fronted by
your existing host Caddy. Same shape as Project-DS deploys — if you've done
that, most of this will look familiar.

**What you'll end up with:** four Docker containers (`web`, `cron`, `mcp-store`,
`postgres`) running on your homelab, reachable over HTTPS at a domain you own,
fully automated TLS via Let's Encrypt, no tunnel daemon, no Cloudflare account.

---

## Prerequisites

- A homelab host with **Docker + Docker Compose** (Compose v2) installed
- **Host Caddy** already running on the homelab — LucidIndex does not ship its
  own reverse proxy (same posture as Project-DS; see the Caddyfile snippet below)
- A **domain you control** with DNS managed anywhere (Cloudflare, Namecheap,
  your registrar's panel — whatever you already use)
- **Port 443 open** at your home router and forwarded to the host running Caddy

---

## Step 1: Clone and configure

```sh
git clone https://github.com/lxrbckl-dev/Project-LucidIndex.git
cd Project-LucidIndex
cp apps/web/.env.example .env
```

Now edit `.env`. The minimum required values for production:

```sh
# Generate a strong Postgres password — keep it; you'll need it if you ever
# rotate it manually inside the DB.
POSTGRES_PASSWORD=$(openssl rand -hex 24)

# iron-session cookie encryption — must be 32+ characters.
IRON_SESSION_PASSWORD=$(openssl rand -hex 32)

# WebAuthn relying-party config — use your bare domain (no https://, no port).
WEBAUTHN_RP_ID=your-domain.com
WEBAUTHN_ORIGIN=https://your-domain.com

# Founding-admin token — one-time gate so no one can claim admin before you do.
# Generate now; drop from .env after your first login (see Step 5).
LUCIDINDEX_FOUNDING_TOKEN=$(openssl rand -hex 32)
```

The `DATABASE_URL` in `.env.example` defaults to the local dev URL. In production,
`docker-compose.yml` constructs the container-network URL from `POSTGRES_PASSWORD`
automatically — you don't need to change it.

> **Keep `.env` secret.** It is gitignored by default. Never commit it.

---

## Step 2: DNS

Point an A record at your homelab's public IP:

```
your-domain.com  A  <your-homelab-public-IP>  TTL 300
```

If your home IP is not static, set up a DDNS client (ddclient, cloudflared
Tunnel DNS, duckdns, or your registrar's own DDNS — LucidIndex has no opinion
on which you pick). The A record just needs to resolve to the host running Caddy
before you attempt Let's Encrypt issuance in Step 3.

---

## Step 3: Host Caddy site block

Drop the following block into your existing Caddyfile, replacing `your-domain.com`
with the hostname you own. Then reload Caddy.

```caddyfile
your-domain.com {
    handle /mcp/* {
        reverse_proxy <mcp-target>:4000
    }
    handle {
        reverse_proxy <web-target>:3000
    }
}
```

Pick `<web-target>` and `<mcp-target>` based on how Caddy runs:

| How Caddy runs | `<web-target>` | `<mcp-target>` |
|---|---|---|
| Native binary or systemd on the host | `localhost` | `localhost` |
| Docker container on the same host (macOS / Docker Desktop) | `host.docker.internal` | `host.docker.internal` |
| Docker container in the same Compose network as LucidIndex | `web` | `mcp-store` |

**Why this matters:** if Caddy is in a container, `localhost` resolves to the
Caddy container itself, not the host. Using `localhost` in that case gives you
502s. The Compose file already binds `web` to `127.0.0.1:3000` and `mcp-store`
to `127.0.0.1:4000` — only the host (and therefore Caddy) can reach them. Do
not change these to `0.0.0.0:PORT` bindings.

**Reload Caddy after editing:**

```sh
# Native / systemd
caddy reload --config /etc/caddy/Caddyfile
# or
sudo systemctl reload caddy

# Containerized
docker exec caddy caddy reload --config /etc/caddy/Caddyfile
# or
docker restart caddy
```

Caddy issues and auto-renews the TLS cert via Let's Encrypt. Wait 30–60 seconds
after reload and verify with:

```sh
curl -I https://your-domain.com/
# HTTP 200 (or 307 → /settings/login) with a valid TLS cert
```

---

## Step 4: Boot the stack

From the repo root on the homelab host:

```sh
docker compose up -d --build
```

This builds and starts all four services in dependency order:

1. `postgres` boots and becomes healthy (schema not yet migrated)
2. `web` runs Drizzle migrations + idempotent seed, then binds port 3000
3. `mcp-store` and `cron` wait for `web` to report healthy before starting

Watch startup with:

```sh
docker compose logs -f
```

**Expected log sequence:**

```
web  | [entrypoint] running migrations...
web  | [entrypoint] migrations complete.
web  | [entrypoint] running seed (idempotent)...
web  | [entrypoint] starting web...
```

Once you see those lines, the stack is ready. Verify all four services are up:

```sh
docker compose ps
# All four services: postgres, web, mcp-store, cron — status "healthy" or "running"
```

Quick health checks:

```sh
curl http://127.0.0.1:3000/      # should return HTML (the dashboard or login redirect)
curl http://127.0.0.1:4000/healthz  # should return {"status":"ok"}
```

---

## Step 5: Claim founding admin

This step closes the enrollment window. Until you complete it, the app is in a
"no admin enrolled" state and `mcp-store` tools return `no_admin_enrolled`.

Open a browser and navigate to:

```
https://your-domain.com/settings?token=<your LUCIDINDEX_FOUNDING_TOKEN>
```

(Use the exact value you set in `.env` in Step 1.)

The founding-admin ceremony runs:

1. **Register a passkey.** Your browser prompts for biometrics or a security
   key — use whichever you'll have with you most often (Face ID, Touch ID,
   hardware key, etc.).
2. **Save the recovery code.** A one-time recovery code is displayed after
   successful enrollment. Copy it somewhere safe (password manager, printed
   and stored off-device). It is **never shown again**. This is your only
   fallback if you lose all passkeys. See Troubleshooting below for what
   "lost all passkeys" looks like in practice.
3. **Drop `LUCIDINDEX_FOUNDING_TOKEN` from `.env`** after enrollment succeeds.
   The token is already invalidated server-side (subsequent attempts with the
   same value are rejected), but removing it from `.env` keeps things clean.

```sh
# After enrollment, edit .env and set LUCIDINDEX_FOUNDING_TOKEN= (blank)
# or remove the line entirely, then restart the web container to reload env:
docker compose up -d web
```

After this step, `/settings` is passkey-gated. The dashboard (`/`) and article
pages (`/a/[slug]`) remain public so share links unfurl for anyone without auth.

---

## Step 6: Configure your first agent token and watch target

Sign in at `https://your-domain.com/settings/login` with the passkey you just
registered.

**Issue an agent token:**

1. Go to **Settings → Agent Tokens** → **New token**
2. Give it a label (e.g. `claude-reference-agent`)
3. Copy the cleartext token **now** — it is shown exactly once and never stored
   in plaintext

**Add your first watch target:**

1. Go to **Settings → Targets** → **New target**
2. Fill in:
   - **Label** — a human-readable name (e.g. `OpenAI Blog`)
   - **URL or handle** — the URL or social handle you want followed
   - **Cadence** — how often to re-enqueue (`hourly`, `daily`, etc.)
   - **Prompt template** — select from the seven starter templates (`website`,
     `youtube`, `blog`, `newsletter`, `news`, `instagram`, `x`) or create a
     custom template first under **Settings → Templates**
3. Save. The cron scheduler sweeps due targets every minute and enqueues them
   automatically — no manual trigger needed.

---

## Step 7: Run the reference agent

The reference agent lives in the sibling repo
[`Project-LucidIndex-Agent`](https://github.com/lxrbckl-dev/Project-LucidIndex-Agent).

```sh
git clone https://github.com/lxrbckl-dev/Project-LucidIndex-Agent.git
cd Project-LucidIndex-Agent
cp .env.example .env
```

Edit `.env`:

```sh
MCP_URL=https://your-domain.com/mcp
MCP_BEARER_TOKEN=<the cleartext agent token from Step 6>
```

Install and build:

```sh
pnpm install
pnpm build
```

Invoke via Claude Code skill or directly per the agent repo's README. The agent
will call `pull_queue_item`, do its research, and call `write_articles` to write
back. An article should appear on the dashboard within a minute of the cron
scheduler next enqueueing a due target (cron fires every minute).

---

## Step 8: Verify share-link unfurls

1. Open an article on the dashboard
2. Copy the share link from the address bar (`https://your-domain.com/a/<slug>`)
3. Send it via iMessage, Slack, or any platform that fetches OpenGraph metadata
4. The preview should show the article's hero image + headline

If the unfurl shows a blank card or no image: check that `WEBAUTHN_ORIGIN` in
`.env` matches your public URL exactly (including `https://`). The OG meta tags
are rendered server-side using this value as the base URL. See Troubleshooting
below.

---

## Troubleshooting

### `Cannot find module @node-rs/argon2`

The runner stage in `apps/web/Dockerfile` needs to include argon2's native
binary. If you see this on container start, rebuild the image:

```sh
docker compose build --no-cache web
docker compose up -d web
```

This was addressed in PR #132 (argon2 bundling) — if you're on a recent `main`
you shouldn't hit it, but a `--no-cache` rebuild resolves it if you do.

### Cron not writing `cron_runs` rows

```sh
docker compose logs cron
```

Check for database connectivity errors. The cron sidecar `depends_on: web:
service_healthy` — if `web` never became healthy (migrations failed), cron
won't start. Confirm `web` is healthy first:

```sh
docker compose ps web
# Status should show "healthy"
```

If web is healthy but cron logs show schema errors, the migrations may have run
against the wrong database. Verify `POSTGRES_PASSWORD` in `.env` matches what
Postgres was initialized with (see "Rotating the Postgres password" below).

### Web 500 on first visit

Check the web container's migration log:

```sh
docker compose logs web | grep -E "entrypoint|migration|error" -i
```

A 500 on the very first visit almost always means migrations didn't complete.
If you see `[entrypoint] migrations complete.` in the logs, the schema is fine —
check the application logs for a different root cause (e.g. missing env var).

### `mcp-store` returns 401

The agent token you're presenting doesn't match any row in `agent_tokens`. Verify:

1. You copied the **cleartext** token at creation time (it's shown once; the DB
   stores only the argon2id hash)
2. `MCP_BEARER_TOKEN` in the agent's `.env` is set to that exact string with no
   trailing whitespace or quotes

If you've lost the cleartext, create a new token under **Settings → Agent Tokens**
and update the agent's `.env`.

### Share link doesn't unfurl

The OpenGraph base URL is derived from `WEBAUTHN_ORIGIN`. Verify it matches your
public HTTPS URL exactly:

```sh
docker compose exec web env | grep WEBAUTHN_ORIGIN
# Should print: WEBAUTHN_ORIGIN=https://your-domain.com
```

If it shows `http://localhost:3000`, you haven't set `WEBAUTHN_ORIGIN` in `.env`.
Update `.env` and restart: `docker compose up -d web`.

### Lost all passkeys (recovery path)

Recovery runs the `admin:reset` CLI directly on the host — no email or SMS
fallback by design. This truncates sessions and credentials so the next visit
re-claims via the founding-token flow or passkey re-registration.

```sh
# Run on the homelab host in the cloned repo root:
docker compose exec web node /app/apps/cli/dist/reset-credentials.js --yes
```

Drop `--yes` to be prompted for confirmation (type `RESET` to proceed). After
the reset, visit `https://your-domain.com/settings?token=<LUCIDINDEX_FOUNDING_TOKEN>`
to re-enroll. If you cleared `LUCIDINDEX_FOUNDING_TOKEN` from `.env` after
Step 5, re-add it temporarily, restart `web`, run the ceremony, then remove it
again.

> **TODO:** The `apps/cli` package and `reset-credentials.js` script are
> referenced in README.md and CLAUDE.md but were not present in the repo at the
> time this guide was written (Phase 8). Verify the exact path via
> `docker compose exec web ls /app/apps/cli/` before relying on this command.
> The Project-DS equivalent is `docker compose exec app node /app/apps/cli/dist/reset-credentials.js --yes`.

### Rotating the Postgres password

Postgres bakes `POSTGRES_PASSWORD` into its data directory on first init and
ignores the env var on subsequent starts. If you change it in `.env` after the
volume already exists, `web` will fail to start with `password authentication
failed`. Rotate inside the DB instead:

```sh
docker compose exec postgres psql -U lucidindex -d lucidindex \
  -c "ALTER USER lucidindex WITH PASSWORD '<new-password>';"
```

Then update `POSTGRES_PASSWORD` in `.env` and restart the stack:

```sh
docker compose up -d
```

---

## Backup configuration

LucidIndex ships an off-site backup job in the `cron` sidecar. Configure it at
**Settings → Off-site backup**:

- **rclone remote name** — the name you gave the remote in your `rclone.conf`
  (e.g. `b2`, `s3`, `nas`)
- **Credentials blob** — your rclone config block, encrypted at rest
  (AES-256-GCM). Supported backends: Backblaze B2, AWS S3-compatible, any
  rclone-supported remote.

Test your restore path against a separate Postgres before relying on it in
anger — a backup you've never restored is not a backup you can trust.

---

## Updating

```sh
git pull
docker compose up -d --build
```

Drizzle migrations apply automatically on `web` boot — the entrypoint runs
`drizzle-kit migrate` before binding port 3000. On a populated database the
migration journal makes it a no-op if nothing new landed.

Zero-downtime rolling updates are not a v0.1 goal. Expect a brief outage
(typically under 60 seconds) while `web` restarts and re-migrates. `mcp-store`
and `cron` wait for `web` to become healthy before accepting connections, so
no service ever queries an unmigrated schema.

---

## Quick reference

| Env var | What it does | Generate with |
|---|---|---|
| `POSTGRES_PASSWORD` | Postgres user password | `openssl rand -hex 24` |
| `IRON_SESSION_PASSWORD` | Cookie encryption key (32+ chars) | `openssl rand -hex 32` |
| `WEBAUTHN_RP_ID` | WebAuthn relying-party ID (bare domain) | your domain, e.g. `lucid.example.com` |
| `WEBAUTHN_ORIGIN` | WebAuthn origin (full URL) | `https://lucid.example.com` |
| `LUCIDINDEX_FOUNDING_TOKEN` | One-time admin claim gate | `openssl rand -hex 32` |

Full env var reference: [`apps/web/.env.example`](../apps/web/.env.example)

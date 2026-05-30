# Publish deployment

This stack is the production-oriented deployment path. It keeps Postgres and Redis private, exposes only `80/443`, and places the web app and API behind Caddy with automatic TLS.

## Files

- `infra/docker-compose.publish.yml`: public-facing stack
- `infra/.env.publish.example`: production env template
- `infra/Caddyfile`: reverse proxy and TLS config

## Before you start

- You need a server with Docker Engine and the Docker Compose plugin.
- You need DNS records for:
  - `PUBLIC_WEB_HOST` -> your server IP
  - `PUBLIC_API_HOST` -> your server IP
- Open inbound ports `80` and `443` on the server firewall.
- Copy `infra/.env.publish.example` to `infra/.env.publish` and replace every placeholder.

You can generate a first production env file with strong local secrets:

```bash
npm run deploy:create-env
```

Review the generated `infra/.env.publish` before deploying, especially email,
Discord, YouTube, SMTP, OpenAI, and optional Studio remove.bg values.

## Start the publish stack

Run the deployment preflight before starting or updating the stack:

```bash
npm run deploy:preflight
```

That command validates `infra/.env.publish`, checks the Studio production env
wiring, and runs `docker compose config` when Docker Compose is available.

```bash
docker compose --env-file infra/.env.publish -f infra/docker-compose.publish.yml up --build -d
```

The same command is available as:

```bash
npm run deploy:up
```

Do not use `next dev` on `localhost:3001` as a production parity check. For a true comparison, use the web app's production preview so the same build metadata and `BUILD_ID` flow are exercised locally:

```bash
npm --prefix apps/arenzyra-web run preview:prod
```

Only the reverse proxy is exposed publicly:

- Web: `https://PUBLIC_WEB_HOST`
- API: `https://PUBLIC_API_HOST`

Postgres and Redis stay internal to Docker in this stack.

## Data and storage

- Postgres data is stored in the named volume `postgres-data`.
- Redis data is stored in the named volume `redis-data`.
- API uploads are stored in the named volume `api-uploads`.
- API media/storage files are stored in the named volume `api-storage`.

Restore your existing database after the stack is up if you want your current data in production.

## Required env values

The API still requires these startup values:

- `JWT_SECRET`
- `COLLECTOR_SECRET`
- `PCOB_SECRET`
- `SUPERADMIN_EMAIL`
- `SUPERADMIN_PASSWORD`
- `OP_EMAIL`
- `OP_PASSWORD`

Set these public URLs correctly too:

- `WEB_APP_ORIGIN`
- `FRONTEND_ORIGIN`
- `NEXT_PUBLIC_API_URL`
- `API_BASE_URL`
- `API_PUBLIC_URL`

Set `ASSET_BASE_URL` if uploaded/team media should resolve from a different public host than the API.

Studio uses `DATABASE_URL` by default for cloud workspaces, media, published
runtime links, and review links. Set `STUDIO_DATABASE_URL` only if Studio should
use a separate Postgres database. `MEDIA_AI_URL` enables no-key local AI
background removal through the bundled media-ai service. Set
`STUDIO_REMOVE_BG_API_KEY` only if you want the external remove.bg provider;
without it, Studio uses media-ai when available and then the built-in
server-local remove-background, enhancer, and upscaler. Keep
`STUDIO_ALLOW_LOCAL_DEV_WORKSPACE=false` for production so unauthenticated users
cannot access the local development Studio workspace.

Set `STUDIO_REQUIRE_EXTERNAL_IMAGE_PROVIDER=true` only when deployment should
fail if production-grade background removal is not configured.

For the Discord bot API access that does not expire, set these API service-token values:

- `ARENZYRA_API_SERVICE_TOKEN_SHA256`
- `STUDIO_QA_SERVICE_TOKEN_SHA256` (optional, for temporary live Studio QA tokens)
- `ARENZYRA_API_SERVICE_ORGANIZATION_ID`
- `ARENZYRA_API_SERVICE_USER_ID`
- `ARENZYRA_API_SERVICE_USER_EMAIL`

## Optional integrations

If you use observer/live-shadow features, set the related endpoints in `infra/.env.publish`:

- `OBSERVER_BASE_URL`
- `PCOB_BASE_URL`
- `SHADOW_API_BASE`
- `MATCH_STATE_BASE`
- `MEDIA_AI_URL`
- `OPENAI_API_KEY`
- `OPENAI_VISION_MODEL` (defaults to `gpt-4.1-mini`)
- `OPENAI_VISION_MAX_IMAGE_EDGE` (defaults to `2048`)

If those services run on the same server outside Docker, `host.docker.internal` can be used as a starting point.

## Useful commands

```bash
docker compose --env-file infra/.env.publish -f infra/docker-compose.publish.yml ps
docker compose --env-file infra/.env.publish -f infra/docker-compose.publish.yml logs -f
docker compose --env-file infra/.env.publish -f infra/docker-compose.publish.yml down
```

## Verify parity after deploy

After the stack is updated, verify the live site is serving the same build as a local production preview:

```bash
npm --prefix apps/arenzyra-web run verify:live
```

That command rebuilds the local web app, starts a local production preview on `http://127.0.0.1:3011`, fetches `/api/version` from both local and live, and compares the homepage build metadata, title, and `h1`.

Then verify the deployed public stack and Studio auth gates:

```bash
npm run deploy:verify
```

For the authenticated Studio path, run the live QA script with a real organizer
session. Prefer environment variables so secrets are not stored in shell history:

```bash
STUDIO_QA_EMAIL="organizer@example.com" \
STUDIO_QA_PASSWORD="..." \
npm run deploy:studio-qa
```

PowerShell:

```powershell
$env:STUDIO_QA_EMAIL = "organizer@example.com"
$env:STUDIO_QA_PASSWORD = "..."
npm run deploy:studio-qa
Remove-Item Env:\STUDIO_QA_EMAIL, Env:\STUDIO_QA_PASSWORD
```

You can also pass a current access token:

```bash
STUDIO_QA_AUTH_TOKEN="..." npm run deploy:studio-qa
```

For automated production checks, the existing API service token can be used
without an organizer password:

```bash
STUDIO_QA_SERVICE_TOKEN="..." npm run deploy:studio-qa
```

If you do not keep the plaintext service token, set only
`STUDIO_QA_SERVICE_TOKEN_SHA256` on the API and pass the matching plaintext token
to the QA script. This can be a temporary one-time token and does not replace the
Discord bot service token.

The script creates temporary media, published runtime, and review records, then
cleans them up. It only writes to the main Studio workspace if
`STUDIO_QA_INCLUDE_WORKSPACE_WRITE=1` or `--include-workspace-write` is set;
use that option only when no one else is actively editing the same organizer
workspace.

Use `STUDIO_QA_REQUIRE_EXTERNAL_IMAGE_PROVIDER=1` to fail QA when remove.bg is
not configured. Use `STUDIO_QA_TEST_EXTERNAL_IMAGE_PROVIDER=1` to run one real
external background-removal request; this can consume provider credits.

## Notes

- This publish stack is intentionally separate from the existing local stack in `infra/docker-compose.yml`.
- If you do not have a domain yet, keep using the direct-port stack temporarily. The publish stack here is prepared for real domain-based deployment with HTTPS.

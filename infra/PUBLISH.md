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

## Start the publish stack

```bash
docker compose --env-file infra/.env.publish -f infra/docker-compose.publish.yml up --build -d
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

## Optional integrations

If you use observer/live-shadow features, set the related endpoints in `infra/.env.publish`:

- `OBSERVER_BASE_URL`
- `PCOB_BASE_URL`
- `SHADOW_API_BASE`
- `MATCH_STATE_BASE`
- `MEDIA_AI_URL`

If those services run on the same server outside Docker, `host.docker.internal` can be used as a starting point.

## Useful commands

```bash
docker compose --env-file infra/.env.publish -f infra/docker-compose.publish.yml ps
docker compose --env-file infra/.env.publish -f infra/docker-compose.publish.yml logs -f
docker compose --env-file infra/.env.publish -f infra/docker-compose.publish.yml down
```

## Notes

- This publish stack is intentionally separate from the existing local stack in `infra/docker-compose.yml`.
- If you do not have a domain yet, keep using the direct-port stack temporarily. The publish stack here is prepared for real domain-based deployment with HTTPS.

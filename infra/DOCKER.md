# Docker quickstart

Run the full stack (API + Postgres + Redis + Web) with a single command.
This file is for the local/direct-port stack. For a public deployment with a reverse proxy, use [infra/PUBLISH.md](PUBLISH.md).

## Prerequisites
- Docker Engine + Docker Compose plugin.
- Ports free: API `3000`, Web `3005`, Postgres `5434`, Redis `6379`.
- Copy [infra/.env.example](.env.example) to `infra/.env` and replace the placeholder secrets.

## Build and start
```bash
docker compose --env-file infra/.env -f infra/docker-compose.yml up --build -d
```

Services:
- API: http://localhost:3000
- Web: http://localhost:3005
- Postgres: localhost:5434 (db `pubg_prod`, user/password `postgres`)
- Redis: localhost:6379

The API container runs `prisma migrate deploy` on startup. The compose stack also bind-mounts `apps/api/uploads` and `apps/api/storage`, so the current local assets remain available inside the container.

To seed data after the DB is up:
```bash
docker compose --env-file infra/.env -f infra/docker-compose.yml exec api npx prisma db seed
```
Seed data also requires `PLATFORM_ADMIN_EMAIL` and `PLATFORM_ADMIN_PASSWORD` to be set in `infra/.env`.

## Customizing
- Change exposed ports or credentials in `docker-compose.yml`.
- Keep `NEXT_PUBLIC_API_URL` browser-facing, for example `http://localhost:3000`.
- Use `INTERNAL_API_URL` for server-side Next routes inside Docker, for example `http://api:3000`.
- Use `OBSERVER_BASE_URL` for host-side observer tooling, for example `http://host.docker.internal:10086`.
- Set API CORS origins with `WEB_APP_ORIGIN` and `FRONTEND_ORIGIN`.
- Set the API public base URL with `API_BASE_URL` or `API_PUBLIC_URL` if the API is published behind a different host.
- Set `ASSET_BASE_URL` if media assets need a different public base URL than the API itself.
- Required API credentials for production startup are `JWT_SECRET`,
  `IDP_CREDENTIAL_ENCRYPTION_KEY`, `SUPERADMIN_MFA_ENCRYPTION_KEY`,
  `SUPERADMIN_MFA_RECOVERY_PEPPER`, `COLLECTOR_SECRET`, and `PCOB_SECRET`;
  `SUPERADMIN_MFA_REQUIRED` must be `true`.
  The IDP key must be a separate random value; it encrypts Discord room
  passwords and must not reuse the JWT signing secret.
  Both platform-superadministrator MFA secrets must be at least 32 bytes and
  distinct from every listed application secret and from each other.
- Login-triggered superadmin/operator creation is disabled by default. For a disposable local database only, explicitly set `AUTH_DEV_BOOTSTRAP_ENABLED=true` with the four `SUPERADMIN_*`/`OP_*` values. The API rejects that mode in production.

## Stopping/cleaning
```bash
docker compose --env-file infra/.env -f infra/docker-compose.yml down
docker compose --env-file infra/.env -f infra/docker-compose.yml down -v
```

# Arenzyra production deployment safety

These rules apply to every production deployment or production service rebuild
under `/opt/arenzyra`, including partial API, web, Discord bot, media service,
proxy, and launcher deployments.

Start every production shell entrypoint from a clean parent environment. At a
minimum, clear `BASH_ENV`, `ENV`, `NODE_OPTIONS`, `NODE_PATH`, and all ambient
`GIT_*` variables before Bash or Node starts. Prefer the exact `env -i` launcher
documented in `infra/PUBLISH.md`; an in-script check runs too late to undo a
malicious `BASH_ENV`.

1. Immediately before any production build, pull, recreate, restart, or
   `docker compose up`, run:

   ```bash
   cd /opt/arenzyra
   bash scripts/production-deploy-preflight.sh
   ```

2. Do not start or continue a deployment unless the preflight exits with status
   `0` in the same working session. The default requirement is at least 30 GiB
   free on the production root filesystem.
3. If the preflight prints `DEPLOYMENT BLOCKED`, stop and report the reason to
   the user. Do not automatically delete backups, images, logs, volumes, or
   other production data to make room.
4. Never use `docker system prune --volumes` or otherwise prune production
   volumes. PostgreSQL, Redis, uploads, and API storage volumes must be
   preserved.
5. Prefer the guarded `npm run deploy:up` or
   `npm run deploy:up:discord-bot` commands. For a custom/partial deployment,
   run the same preflight explicitly before the custom command.
6. After deployment, verify container health and the public HTTPS endpoint.

# Local ignored-data safety

Ignored paths are not disposable by default. They can contain user data, test
evidence, or runtime state that Git cannot restore.

1. Never use `git clean` to remove individual files inside an ignored
   directory. Git may select and remove the ignored parent directory instead
   of only the named descendants.
2. Before removing any ignored or untracked item, inventory the exact target
   and its parent, confirm that no additional contents are in scope, and make a
   recoverable copy when the bytes may matter.
3. Prefer leaving harmless test output in place or moving exact inspected
   files to a quarantine outside the release/build context. Do not broaden a
   cleanup target merely because a narrow command is inconvenient.
4. If a cleanup command affects more than the verified target, stop all writes,
   preserve the remaining state, and record both the known and unknown scope.

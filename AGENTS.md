# Arenzyra production deployment safety

These rules apply to every production deployment or production service rebuild
under `/opt/arenzyra`, including partial API, web, Discord bot, media service,
proxy, and launcher deployments.

Start every production shell entrypoint from the one exact clean-parent,
reviewed-commit outer launcher documented in `infra/PUBLISH.md`. It loads the
committed allowlisted dispatcher with absolute sanitized `git show` and passes
only the reviewed Root/API/Web commits required by that workflow. At a minimum, clear `BASH_ENV`,
`ENV`, `NODE_OPTIONS`, `NODE_PATH`, and all ambient `GIT_*` variables before Bash
or Node starts. A raw npm alias or checkout script is not a trusted production
entrypoint; an in-script check runs too late to undo a malicious `BASH_ENV` or a
replaced wrapper. The dispatcher enforces the narrower reviewed-current-Root
boundary for Discord rollback and the reviewed nested-assembly boundary for
deploy, IDP inspection, role checks, verification, and Studio QA.

1. The reviewed dispatcher and selected wrapper must run the following preflight
   immediately before any production build, pull, recreate, restart, or
   `docker compose up`:

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
5. Use only an allowlisted command ID through the reviewed production entrypoint
   documented in `infra/PUBLISH.md`. Raw production npm aliases intentionally
   fail closed, including deployment, API/host maintenance, backup/restore,
   role, observation, verification, and QA aliases. For a custom/partial
   deployment, first establish the same reviewed source trust, then run the same
   preflight explicitly before the custom command; leave the action blocked if
   it cannot be expressed by the reviewed allowlist.
6. After deployment, verify container health and the public HTTPS endpoint.
7. Live-match deployment policy is service-aware. Full, API-affecting, media,
   proxy, and Discord deployments remain blocked until the aggregate live-match
   gate is quiescent. The sole exception is activation of an already-built,
   archived, immutable Web candidate through the reviewed web-candidate command;
   it must use `--no-deps`, preserve every non-Web container identity, perform no
   build/migration/backup, and leave the full-release pointer unchanged.
8. At or above 80% root-disk usage, a routine build may automatically release
   only dangling Docker build cache older than seven days under the inherited
   production deployment lock. It must preflight before and after that action.
   Do not automatically remove backups, images, containers, volumes, logs,
   source archives, or customer data. Keep the 30-GiB absolute deployment floor;
   if regenerable cache cleanup is insufficient, stop for explicit review.

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

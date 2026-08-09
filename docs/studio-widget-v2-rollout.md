# Studio Widget v2 rollout

Studio Widget v2 is additive. Existing Studio publishes, OBS URLs, Discord
session snapshots, and custom result templates remain the fallback path.

## Deploy order

1. Back up the production database and deploy the API migration:
   `20260713130000_studio_widget_release_foundation`.
   It only adds tables, enums, indexes, foreign keys, and ownership triggers.
2. Deploy the API, web app, and Discord bot/API client together.
3. Leave `STUDIO_WIDGETS_V2_ENABLED` unset for an initial dark deployment.
   In production the feature fails closed unless this variable is set to
   `true`, `1`, or `yes`.
4. After API and web health checks, set
   `STUDIO_WIDGETS_V2_ENABLED=true` and restart the API.

## First release checklist

- Create a Studio Widget v2 revision from the final Studio page.
- Activate the immutable release only after reviewing its page and static data.
- For OBS, issue a new opaque token and use its secure runtime URL. Tokens are
  hashed in storage, have a bounded expiry, and are rechecked by OBS every
  30 seconds.
- For Discord, create a session binding in its disabled state, verify the
  release, then explicitly enable it. Legacy Studio/custom/default rendering
  remains the automatic fallback for any v2 resolver or render failure.
- Discord PNG releases must use Studio-owned assets (`/api/studio/media/`,
  `/assets/`, `/uploads/`, or `/media/`). Upload external images/fonts first;
  server-rendered releases intentionally do not fetch arbitrary URLs.

## Rollback

- Set `STUDIO_WIDGETS_V2_ENABLED=false` (or remove it) and restart the API.
  New v2 activation and public outputs fail closed; legacy output is unchanged.
- Disable Discord bindings to return immediately to legacy rendering.
- Revoke affected OBS tokens or releases. A running OBS browser source clears
  within its next 30-second validation interval.

Do not repurpose the legacy `discordStudio*` session fields. They are kept for
backward compatibility and remain independent from v2 bindings.

-- Bounded, read-only organization summary for operator-requested diagnosis.
-- This is separate from the identifier-free deployment gate. It emits only
-- organization names and protected-state counts; no match, player, session,
-- credential, or operator identifiers are selected.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '2s';
SET LOCAL idle_in_transaction_session_timeout = '20s';

WITH match_snapshot AS MATERIALIZED (
  SELECT
    match_row."organizationId" AS organization_id,
    match_row.status::text AS business_status,
    match_row."liveState"::text AS live_state,
    control_row.state::text AS control_state,
    (
      match_row."pcobLastSeenAt" IS NOT NULL
      AND match_row."pcobLastSeenAt" >= transaction_timestamp() - interval '2 minutes'
    ) AS recent_telemetry,
    EXISTS (
      SELECT 1
      FROM "MatchRound" AS round_row
      WHERE round_row."matchId" = match_row.id
        AND round_row.status::text = 'LIVE'
    ) AS live_round
  FROM "Match" AS match_row
  LEFT JOIN "MatchControlState" AS control_row
    ON control_row."matchId" = match_row.id
  WHERE match_row."deletedAt" IS NULL
),
classified AS MATERIALIZED (
  SELECT
    *,
    (
      business_status IS NULL
      OR business_status NOT IN (
        'DRAFT', 'LIVE', 'ENDED', 'FINISH_PENDING', 'FINISHED'
      )
    ) AS unknown_business_status,
    (
      live_state IS NULL
      OR live_state NOT IN ('UPCOMING', 'LIVE', 'ENDED')
    ) AS unknown_live_state,
    control_state IS NOT NULL
      AND control_state NOT IN (
        'READY', 'COUNTDOWN', 'LIVE', 'PAUSED', 'ENDED', 'CONFIRMED',
        'FINISH_PENDING'
      ) AS unknown_control_state
  FROM match_snapshot
),
protected AS MATERIALIZED (
  SELECT
    *,
    (
      COALESCE(business_status IN ('LIVE', 'FINISH_PENDING'), FALSE)
      OR COALESCE(live_state = 'LIVE', FALSE)
      OR COALESCE(
        control_state IN ('COUNTDOWN', 'LIVE', 'PAUSED', 'FINISH_PENDING'),
        FALSE
      )
      OR recent_telemetry
      OR live_round
      OR unknown_business_status
      OR unknown_live_state
      OR unknown_control_state
    ) AS deployment_protected
  FROM classified
),
organization_summary AS MATERIALIZED (
  SELECT
    organization_row.name AS organization_name,
    count(*) AS protected_matches,
    count(*) FILTER (WHERE business_status = 'LIVE') AS business_live,
    count(*) FILTER (WHERE business_status = 'FINISH_PENDING') AS business_finish_pending,
    count(*) FILTER (WHERE control_state = 'COUNTDOWN') AS control_countdown,
    count(*) FILTER (WHERE control_state = 'LIVE') AS control_live,
    count(*) FILTER (WHERE control_state = 'PAUSED') AS control_paused,
    count(*) FILTER (WHERE control_state = 'FINISH_PENDING') AS control_finish_pending,
    count(*) FILTER (WHERE recent_telemetry) AS recent_telemetry,
    count(*) FILTER (WHERE live_round) AS live_round,
    count(*) FILTER (
      WHERE unknown_business_status OR unknown_live_state OR unknown_control_state
    ) AS unknown_state
  FROM protected
  INNER JOIN "Organization" AS organization_row
    ON organization_row.id = protected.organization_id
  WHERE deployment_protected
  GROUP BY organization_row.id, organization_row.name
)
SELECT json_build_object(
  'schemaVersion', 1,
  'totalOrganizations', count(*),
  'organizations', COALESCE(
    json_agg(
      json_build_object(
        'organizationName', organization_name,
        'protectedMatches', protected_matches,
        'businessLive', business_live,
        'businessFinishPending', business_finish_pending,
        'controlCountdown', control_countdown,
        'controlLive', control_live,
        'controlPaused', control_paused,
        'controlFinishPending', control_finish_pending,
        'recentTelemetry', recent_telemetry,
        'liveRound', live_round,
        'unknownState', unknown_state
      ) ORDER BY organization_name
    ),
    '[]'::json
  )
)
FROM organization_summary;

COMMIT;

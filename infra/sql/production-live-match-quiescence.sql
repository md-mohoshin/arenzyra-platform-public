-- Aggregate-only deployment quiescence inventory.
--
-- The deployment wrapper separately enforces a read-only connection default.
-- This transaction repeats that boundary and returns counts only: no match,
-- organization, session, player, or operator identifier leaves PostgreSQL.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '2s';
SET LOCAL idle_in_transaction_session_timeout = '20s';

WITH match_snapshot AS MATERIALIZED (
  SELECT
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
)
SELECT json_build_object(
  'schemaVersion', 1,
  'matches', json_build_object(
    'totalNonDeleted', count(*),
    'deploymentProtected', count(*) FILTER (WHERE deployment_protected),
    'quiescent', count(*) FILTER (WHERE NOT deployment_protected)
  ),
  'businessStatus', json_build_object(
    'draft', count(*) FILTER (WHERE business_status = 'DRAFT'),
    'live', count(*) FILTER (WHERE business_status = 'LIVE'),
    'ended', count(*) FILTER (WHERE business_status = 'ENDED'),
    'finishPending', count(*) FILTER (WHERE business_status = 'FINISH_PENDING'),
    'finished', count(*) FILTER (WHERE business_status = 'FINISHED'),
    'unknown', count(*) FILTER (WHERE unknown_business_status)
  ),
  'liveState', json_build_object(
    'upcoming', count(*) FILTER (WHERE live_state = 'UPCOMING'),
    'live', count(*) FILTER (WHERE live_state = 'LIVE'),
    'ended', count(*) FILTER (WHERE live_state = 'ENDED'),
    'unknown', count(*) FILTER (WHERE unknown_live_state)
  ),
  'controlState', json_build_object(
    'none', count(*) FILTER (WHERE control_state IS NULL),
    'ready', count(*) FILTER (WHERE control_state = 'READY'),
    'countdown', count(*) FILTER (WHERE control_state = 'COUNTDOWN'),
    'live', count(*) FILTER (WHERE control_state = 'LIVE'),
    'paused', count(*) FILTER (WHERE control_state = 'PAUSED'),
    'ended', count(*) FILTER (WHERE control_state = 'ENDED'),
    'confirmed', count(*) FILTER (WHERE control_state = 'CONFIRMED'),
    'finishPending', count(*) FILTER (WHERE control_state = 'FINISH_PENDING'),
    'unknown', count(*) FILTER (WHERE unknown_control_state)
  ),
  'activitySignals', json_build_object(
    'recentTelemetry', count(*) FILTER (WHERE recent_telemetry),
    'liveRound', count(*) FILTER (WHERE live_round)
  )
)
FROM protected;

COMMIT;

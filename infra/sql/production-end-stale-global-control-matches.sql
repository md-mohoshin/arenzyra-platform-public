-- One-time, fail-closed recovery for the exact stale Global Control state
-- observed on 2026-08-12. This deliberately ends the abandoned control
-- sessions without calculating or publishing match results.
BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';
SET LOCAL idle_in_transaction_session_timeout = '40s';

DO $arenzyra$
DECLARE
  organization_id text;
  target_ids text[];
  target_count integer;
  countdown_count integer;
  live_count integer;
  protected_count integer;
  updated_count integer;
  parent_id text;
  parent_total integer;
  parent_live integer;
  parent_ended integer;
  group_total integer;
  next_live_state text;
  operation_time timestamptz := transaction_timestamp();
  operation_reason text := 'OPERATOR_ENDED_STALE_MATCH_FOR_SAFE_DEPLOYMENT';
BEGIN
  SELECT organization_row.id
    INTO organization_id
    FROM "Organization" AS organization_row
   WHERE organization_row.name = 'Global Control'
     AND organization_row."deletedAt" IS NULL
     AND organization_row."isActive" = TRUE
   FOR UPDATE;

  IF organization_id IS NULL THEN
    RAISE EXCEPTION 'STALE MATCH RECOVERY BLOCKED: active Global Control organization was not found';
  END IF;

  -- Lock the organization inventory before evaluating it. The organization
  -- row lock also prevents a concurrent match insert through its foreign key.
  PERFORM match_row.id
    FROM "Match" AS match_row
   WHERE match_row."organizationId" = organization_id
     AND match_row."deletedAt" IS NULL
   ORDER BY match_row.id
   FOR UPDATE;

  PERFORM control_row.id
    FROM "MatchControlState" AS control_row
    JOIN "Match" AS match_row ON match_row.id = control_row."matchId"
   WHERE match_row."organizationId" = organization_id
     AND match_row."deletedAt" IS NULL
   ORDER BY control_row.id
   FOR UPDATE;

  PERFORM round_row.id
    FROM "MatchRound" AS round_row
    JOIN "Match" AS match_row ON match_row.id = round_row."matchId"
   WHERE match_row."organizationId" = organization_id
     AND match_row."deletedAt" IS NULL
   ORDER BY round_row.id
   FOR UPDATE;

  SELECT
    array_agg(match_row.id ORDER BY match_row.id),
    count(*),
    count(*) FILTER (
      WHERE match_row.status::text = 'DRAFT'
        AND match_row."liveState"::text = 'UPCOMING'
        AND control_row.state::text = 'COUNTDOWN'
    ),
    count(*) FILTER (
      WHERE match_row.status::text = 'LIVE'
        AND match_row."liveState"::text = 'LIVE'
        AND control_row.state::text = 'LIVE'
    )
    INTO target_ids, target_count, countdown_count, live_count
    FROM "Match" AS match_row
    JOIN "MatchControlState" AS control_row
      ON control_row."matchId" = match_row.id
   WHERE match_row."organizationId" = organization_id
     AND match_row."deletedAt" IS NULL
     AND control_row."organizationId" = organization_id
     AND (
       (
         match_row.status::text = 'DRAFT'
         AND match_row."liveState"::text = 'UPCOMING'
         AND control_row.state::text = 'COUNTDOWN'
       ) OR (
         match_row.status::text = 'LIVE'
         AND match_row."liveState"::text = 'LIVE'
         AND control_row.state::text = 'LIVE'
       )
     )
     AND match_row."updatedAt" <= operation_time - interval '15 minutes'
     AND control_row."updatedAt" <= operation_time - interval '15 minutes'
     AND (
       match_row."pcobLastSeenAt" IS NULL
       OR match_row."pcobLastSeenAt" <= operation_time - interval '15 minutes'
     )
     AND NOT EXISTS (
       SELECT 1
         FROM "MatchRound" AS round_row
        WHERE round_row."matchId" = match_row.id
          AND round_row.status::text = 'LIVE'
     );

  IF target_count <> 3 OR countdown_count <> 2 OR live_count <> 1 THEN
    RAISE EXCEPTION
      'STALE MATCH RECOVERY BLOCKED: exact stale pattern changed (total %, countdown %, live %)',
      target_count, countdown_count, live_count;
  END IF;

  SELECT count(*)
    INTO protected_count
    FROM "Match" AS match_row
    LEFT JOIN "MatchControlState" AS control_row
      ON control_row."matchId" = match_row.id
   WHERE match_row."organizationId" = organization_id
     AND match_row."deletedAt" IS NULL
     AND (
       match_row.status IS NULL
       OR match_row.status::text NOT IN (
         'DRAFT', 'LIVE', 'ENDED', 'FINISH_PENDING', 'FINISHED'
       )
       OR match_row."liveState" IS NULL
       OR match_row."liveState"::text NOT IN ('UPCOMING', 'LIVE', 'ENDED')
       OR (
         control_row.state IS NOT NULL
         AND control_row.state::text NOT IN (
           'READY', 'COUNTDOWN', 'LIVE', 'PAUSED', 'ENDED', 'CONFIRMED',
           'FINISH_PENDING'
         )
       )
       OR match_row.status::text IN ('LIVE', 'FINISH_PENDING')
       OR match_row."liveState"::text = 'LIVE'
       OR control_row.state::text IN (
         'COUNTDOWN', 'LIVE', 'PAUSED', 'FINISH_PENDING'
       )
       OR (
         match_row."pcobLastSeenAt" IS NOT NULL
         AND match_row."pcobLastSeenAt" >= operation_time - interval '2 minutes'
       )
       OR EXISTS (
         SELECT 1
           FROM "MatchRound" AS round_row
          WHERE round_row."matchId" = match_row.id
            AND round_row.status::text = 'LIVE'
       )
     );

  IF protected_count <> 3 THEN
    RAISE EXCEPTION
      'STALE MATCH RECOVERY BLOCKED: protected inventory changed (count %)',
      protected_count;
  END IF;

  UPDATE "Match"
     SET status = 'ENDED'::"MatchStatus",
         "liveState" = 'ENDED'::"LiveState",
         "endedAt" = operation_time,
         "endedReason" = operation_reason,
         "updatedAt" = operation_time
   WHERE id = ANY(target_ids)
     AND "organizationId" = organization_id
     AND "deletedAt" IS NULL;
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count <> 3 THEN
    RAISE EXCEPTION 'STALE MATCH RECOVERY BLOCKED: match update count was %', updated_count;
  END IF;

  UPDATE "MatchControlState"
     SET state = 'ENDED'::"ControlState",
         version = version + 1,
         reason = operation_reason,
         "updatedAt" = operation_time
   WHERE "matchId" = ANY(target_ids)
     AND "organizationId" = organization_id
     AND state::text IN ('COUNTDOWN', 'LIVE');
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count <> 3 THEN
    RAISE EXCEPTION 'STALE MATCH RECOVERY BLOCKED: control update count was %', updated_count;
  END IF;

  SELECT count(*)
    INTO protected_count
    FROM "Match" AS match_row
    LEFT JOIN "MatchControlState" AS control_row
      ON control_row."matchId" = match_row.id
   WHERE match_row."organizationId" = organization_id
     AND match_row."deletedAt" IS NULL
     AND (
       match_row.status IS NULL
       OR match_row.status::text NOT IN (
         'DRAFT', 'LIVE', 'ENDED', 'FINISH_PENDING', 'FINISHED'
       )
       OR match_row."liveState" IS NULL
       OR match_row."liveState"::text NOT IN ('UPCOMING', 'LIVE', 'ENDED')
       OR (
         control_row.state IS NOT NULL
         AND control_row.state::text NOT IN (
           'READY', 'COUNTDOWN', 'LIVE', 'PAUSED', 'ENDED', 'CONFIRMED',
           'FINISH_PENDING'
         )
       )
       OR match_row.status::text IN ('LIVE', 'FINISH_PENDING')
       OR match_row."liveState"::text = 'LIVE'
       OR control_row.state::text IN (
         'COUNTDOWN', 'LIVE', 'PAUSED', 'FINISH_PENDING'
       )
       OR (
         match_row."pcobLastSeenAt" IS NOT NULL
         AND match_row."pcobLastSeenAt" >= operation_time - interval '2 minutes'
       )
       OR EXISTS (
         SELECT 1
           FROM "MatchRound" AS round_row
          WHERE round_row."matchId" = match_row.id
            AND round_row.status::text = 'LIVE'
       )
     );
  IF protected_count <> 0 THEN
    RAISE EXCEPTION
      'STALE MATCH RECOVERY BLOCKED: transactional quiescence postcondition failed (count %)',
      protected_count;
  END IF;

  -- Recompute the affected hierarchy using the same control-state mapping as
  -- the API: LIVE/PAUSED => LIVE; terminal aliases => ENDED; otherwise UPCOMING.
  FOR parent_id IN
    SELECT DISTINCT match_row."groupId"
      FROM "Match" AS match_row
     WHERE match_row.id = ANY(target_ids)
       AND match_row."groupId" IS NOT NULL
  LOOP
    SELECT
      count(match_row.id),
      count(match_row.id) FILTER (
        WHERE control_row.state::text IN ('LIVE', 'PAUSED')
      ),
      count(match_row.id) FILTER (
        WHERE control_row.state::text IN (
          'FINISH_PENDING', 'FINISHED', 'ENDED', 'CONFIRMED'
        )
      )
      INTO parent_total, parent_live, parent_ended
      FROM "Match" AS match_row
      LEFT JOIN "MatchControlState" AS control_row
        ON control_row."matchId" = match_row.id
     WHERE match_row."groupId" = parent_id
       AND match_row."deletedAt" IS NULL;
    next_live_state := CASE
      WHEN parent_live > 0 THEN 'LIVE'
      WHEN parent_total > 0 AND parent_ended = parent_total THEN 'ENDED'
      ELSE 'UPCOMING'
    END;
    UPDATE "Group"
       SET "liveState" = next_live_state::"LiveState",
           "liveAt" = CASE
             WHEN next_live_state = 'LIVE' THEN COALESCE("liveAt", operation_time)
             ELSE "liveAt"
           END,
           "endedAt" = CASE
             WHEN next_live_state = 'ENDED' THEN COALESCE("endedAt", operation_time)
             ELSE "endedAt"
           END,
           "updatedAt" = operation_time
     WHERE id = parent_id
       AND "deletedAt" IS NULL
       AND (
         "liveState"::text IS DISTINCT FROM next_live_state
         OR (next_live_state = 'LIVE' AND "liveAt" IS NULL)
         OR (next_live_state = 'ENDED' AND "endedAt" IS NULL)
       );
  END LOOP;

  FOR parent_id IN
    SELECT match_row."stageId"
      FROM "Match" AS match_row
     WHERE match_row.id = ANY(target_ids)
       AND match_row."stageId" IS NOT NULL
    UNION
    SELECT group_row."stageId"
      FROM "Group" AS group_row
      JOIN "Match" AS match_row ON match_row."groupId" = group_row.id
     WHERE match_row.id = ANY(target_ids)
       AND group_row."deletedAt" IS NULL
  LOOP
    SELECT count(*)
      INTO group_total
      FROM "Group" AS group_row
     WHERE group_row."stageId" = parent_id
       AND group_row."deletedAt" IS NULL;

    IF group_total > 0 THEN
      SELECT
        count(*) FILTER (
          WHERE EXISTS (
            SELECT 1
              FROM "Match" AS match_row
              JOIN "MatchControlState" AS control_row
                ON control_row."matchId" = match_row.id
             WHERE match_row."groupId" = group_row.id
               AND match_row."deletedAt" IS NULL
               AND control_row.state::text IN ('LIVE', 'PAUSED')
          )
        ),
        count(*) FILTER (
          WHERE EXISTS (
            SELECT 1
              FROM "Match" AS match_row
             WHERE match_row."groupId" = group_row.id
               AND match_row."deletedAt" IS NULL
          )
          AND NOT EXISTS (
            SELECT 1
              FROM "Match" AS match_row
              LEFT JOIN "MatchControlState" AS control_row
                ON control_row."matchId" = match_row.id
             WHERE match_row."groupId" = group_row.id
               AND match_row."deletedAt" IS NULL
               AND COALESCE(control_row.state::text, '') NOT IN (
                 'FINISH_PENDING', 'FINISHED', 'ENDED', 'CONFIRMED'
               )
          )
        )
        INTO parent_live, parent_ended
        FROM "Group" AS group_row
       WHERE group_row."stageId" = parent_id
         AND group_row."deletedAt" IS NULL;
      parent_total := group_total;
    ELSE
      SELECT
        count(match_row.id),
        count(match_row.id) FILTER (
          WHERE control_row.state::text IN ('LIVE', 'PAUSED')
        ),
        count(match_row.id) FILTER (
          WHERE control_row.state::text IN (
            'FINISH_PENDING', 'FINISHED', 'ENDED', 'CONFIRMED'
          )
        )
        INTO parent_total, parent_live, parent_ended
        FROM "Match" AS match_row
        LEFT JOIN "MatchControlState" AS control_row
          ON control_row."matchId" = match_row.id
       WHERE match_row."stageId" = parent_id
         AND match_row."deletedAt" IS NULL;
    END IF;

    next_live_state := CASE
      WHEN parent_live > 0 THEN 'LIVE'
      WHEN parent_total > 0 AND parent_ended = parent_total THEN 'ENDED'
      ELSE 'UPCOMING'
    END;
    UPDATE "Stage"
       SET "liveState" = next_live_state::"LiveState",
           "liveAt" = CASE
             WHEN next_live_state = 'LIVE' THEN COALESCE("liveAt", operation_time)
             ELSE "liveAt"
           END,
           "endedAt" = CASE
             WHEN next_live_state = 'ENDED' THEN COALESCE("endedAt", operation_time)
             ELSE "endedAt"
           END,
           "updatedAt" = operation_time
     WHERE id = parent_id
       AND "deletedAt" IS NULL
       AND (
         "liveState"::text IS DISTINCT FROM next_live_state
         OR (next_live_state = 'LIVE' AND "liveAt" IS NULL)
         OR (next_live_state = 'ENDED' AND "endedAt" IS NULL)
       );
  END LOOP;

  FOR parent_id IN
    SELECT DISTINCT match_row."tournamentId"
      FROM "Match" AS match_row
     WHERE match_row.id = ANY(target_ids)
       AND match_row."tournamentId" IS NOT NULL
  LOOP
    SELECT
      count(match_row.id),
      count(match_row.id) FILTER (
        WHERE control_row.state::text IN ('LIVE', 'PAUSED')
      ),
      count(match_row.id) FILTER (
        WHERE control_row.state::text IN (
          'FINISH_PENDING', 'FINISHED', 'ENDED', 'CONFIRMED'
        )
      )
      INTO parent_total, parent_live, parent_ended
      FROM "Match" AS match_row
      LEFT JOIN "MatchControlState" AS control_row
        ON control_row."matchId" = match_row.id
     WHERE match_row."tournamentId" = parent_id
       AND match_row."deletedAt" IS NULL;
    next_live_state := CASE
      WHEN parent_live > 0 THEN 'LIVE'
      WHEN parent_total > 0 AND parent_ended = parent_total THEN 'ENDED'
      ELSE 'UPCOMING'
    END;
    UPDATE "Tournament"
       SET "liveState" = next_live_state::"LiveState",
           "liveAt" = CASE
             WHEN next_live_state = 'LIVE' THEN COALESCE("liveAt", operation_time)
             ELSE "liveAt"
           END,
           "endedAt" = CASE
             WHEN next_live_state = 'ENDED' THEN COALESCE("endedAt", operation_time)
             ELSE "endedAt"
           END,
           "updatedAt" = operation_time
     WHERE id = parent_id
       AND "deletedAt" IS NULL
       AND (
         "liveState"::text IS DISTINCT FROM next_live_state
         OR (next_live_state = 'LIVE' AND "liveAt" IS NULL)
         OR (next_live_state = 'ENDED' AND "endedAt" IS NULL)
       );
  END LOOP;

  IF EXISTS (
    SELECT 1
      FROM "Match" AS match_row
      JOIN "MatchControlState" AS control_row
        ON control_row."matchId" = match_row.id
     WHERE match_row.id = ANY(target_ids)
       AND (
         match_row.status::text <> 'ENDED'
         OR match_row."liveState"::text <> 'ENDED'
         OR match_row."endedReason" <> operation_reason
         OR control_row.state::text <> 'ENDED'
         OR control_row.reason <> operation_reason
       )
  ) THEN
    RAISE EXCEPTION 'STALE MATCH RECOVERY BLOCKED: transactional postcondition failed';
  END IF;
END
$arenzyra$;

SELECT json_build_object(
  'schemaVersion', 1,
  'organizationName', 'Global Control',
  'endedMatches', 3,
  'resultFinalizationPerformed', FALSE
);

COMMIT;

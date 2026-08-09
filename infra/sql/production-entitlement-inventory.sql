-- Aggregate-only production entitlement inventory.
-- The caller must also enforce a read-only connection default. This transaction
-- repeats that boundary so an accidental future statement fails closed.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '2s';
SET LOCAL idle_in_transaction_session_timeout = '20s';

WITH inventory_clock AS MATERIALIZED (
  SELECT transaction_timestamp() AT TIME ZONE 'UTC' AS observed_at
),
organization_snapshot AS MATERIALIZED (
  SELECT
    o."deletedAt" IS NULL AS non_deleted,
    o."isActive" AS organization_is_active,
    o."status"::text AS organization_status,
    o."subscriptionStatus"::text AS subscription_status,
    o."trialStartedAt" AS trial_started_at,
    o."trialEndsAt" AS trial_ends_at,
    o."paidUntil" AS paid_until,
    o."planId" AS plan_id,
    o."ownerUserId" IS NOT NULL AS owner_reference_present,
    owner."id" IS NOT NULL AS owner_row_present,
    owner."deletedAt" IS NOT NULL AS owner_deleted,
    owner."status"::text AS owner_status,
    owner."organizationId" IS NOT DISTINCT FROM o."id"
      AS owner_organization_matches,
    inventory_clock.observed_at
  FROM "Organization" AS o
  CROSS JOIN inventory_clock
  LEFT JOIN "User" AS owner ON owner."id" = o."ownerUserId"
),
classified AS MATERIALIZED (
  SELECT
    *,
    (
      organization_status = 'APPROVED'
      AND organization_is_active IS TRUE
    ) IS TRUE AS organization_access_ready,
    (
      paid_until IS NULL
      AND trial_started_at IS NOT NULL
      AND trial_ends_at IS NOT NULL
      AND trial_started_at < trial_ends_at
      AND trial_started_at <= observed_at
      AND trial_ends_at > observed_at
    ) AS trialing_is_canonical_and_current
  FROM organization_snapshot
)
SELECT json_build_object(
  'schemaVersion', 1,
  'organizations', json_build_object(
    'total', count(*),
    'deleted', count(*) FILTER (WHERE NOT non_deleted),
    'nonDeleted', count(*) FILTER (WHERE non_deleted),
    'approvedAndActive', count(*) FILTER (
      WHERE non_deleted AND organization_access_ready
    ),
    'notApprovedOrInactive', count(*) FILTER (
      WHERE non_deleted AND NOT organization_access_ready
    )
  ),
  'nonDeletedOrganizationStatus', json_build_object(
    'pending', count(*) FILTER (
      WHERE non_deleted AND organization_status = 'PENDING'
    ),
    'approved', count(*) FILTER (
      WHERE non_deleted AND organization_status = 'APPROVED'
    ),
    'suspended', count(*) FILTER (
      WHERE non_deleted AND organization_status = 'SUSPENDED'
    ),
    'legacyOrUnknown', count(*) FILTER (
      WHERE non_deleted AND (
        organization_status IS NULL
        OR organization_status NOT IN ('PENDING', 'APPROVED', 'SUSPENDED')
      )
    )
  ),
  'nonDeletedIsActive', json_build_object(
    'active', count(*) FILTER (
      WHERE non_deleted AND organization_is_active IS TRUE
    ),
    'inactive', count(*) FILTER (
      WHERE non_deleted AND organization_is_active IS FALSE
    ),
    'legacyOrUnknown', count(*) FILTER (
      WHERE non_deleted AND organization_is_active IS NULL
    )
  ),
  'nonDeletedSubscriptionStatus', json_build_object(
    'active', count(*) FILTER (
      WHERE non_deleted AND subscription_status = 'ACTIVE'
    ),
    'trialing', count(*) FILTER (
      WHERE non_deleted AND subscription_status = 'TRIALING'
    ),
    'expired', count(*) FILTER (
      WHERE non_deleted AND subscription_status = 'EXPIRED'
    ),
    'legacyOrUnknown', count(*) FILTER (
      WHERE non_deleted AND (
        subscription_status IS NULL
        OR subscription_status NOT IN ('ACTIVE', 'TRIALING', 'EXPIRED')
      )
    )
  ),
  'nonDeletedPaidUntil', json_build_object(
    'null', count(*) FILTER (
      WHERE non_deleted AND paid_until IS NULL
    ),
    'future', count(*) FILTER (
      WHERE non_deleted AND paid_until > observed_at
    ),
    'expired', count(*) FILTER (
      WHERE non_deleted AND paid_until <= observed_at
    )
  ),
  'nonDeletedTrialEndsAt', json_build_object(
    'null', count(*) FILTER (
      WHERE non_deleted AND trial_ends_at IS NULL
    ),
    'future', count(*) FILTER (
      WHERE non_deleted AND trial_ends_at > observed_at
    ),
    'expired', count(*) FILTER (
      WHERE non_deleted AND trial_ends_at <= observed_at
    )
  ),
  'nonDeletedTrialDates', json_build_object(
    'bothMissing', count(*) FILTER (
      WHERE non_deleted
        AND trial_started_at IS NULL
        AND trial_ends_at IS NULL
    ),
    'startOnly', count(*) FILTER (
      WHERE non_deleted
        AND trial_started_at IS NOT NULL
        AND trial_ends_at IS NULL
    ),
    'endOnly', count(*) FILTER (
      WHERE non_deleted
        AND trial_started_at IS NULL
        AND trial_ends_at IS NOT NULL
    ),
    'orderedAndStarted', count(*) FILTER (
      WHERE non_deleted
        AND trial_started_at IS NOT NULL
        AND trial_ends_at IS NOT NULL
        AND trial_started_at < trial_ends_at
        AND trial_started_at <= observed_at
    ),
    'orderedWithFutureStart', count(*) FILTER (
      WHERE non_deleted
        AND trial_started_at IS NOT NULL
        AND trial_ends_at IS NOT NULL
        AND trial_started_at < trial_ends_at
        AND trial_started_at > observed_at
    ),
    'invalidOrder', count(*) FILTER (
      WHERE non_deleted
        AND trial_started_at IS NOT NULL
        AND trial_ends_at IS NOT NULL
        AND trial_started_at >= trial_ends_at
    )
  ),
  'activeState', json_build_object(
    'paidUntilNull', count(*) FILTER (
      WHERE non_deleted
        AND subscription_status = 'ACTIVE'
        AND paid_until IS NULL
    ),
    'paidUntilFuture', count(*) FILTER (
      WHERE non_deleted
        AND subscription_status = 'ACTIVE'
        AND paid_until > observed_at
    ),
    'paidUntilExpired', count(*) FILTER (
      WHERE non_deleted
        AND subscription_status = 'ACTIVE'
        AND paid_until <= observed_at
    ),
    'trialStartedAtPresent', count(*) FILTER (
      WHERE non_deleted
        AND subscription_status = 'ACTIVE'
        AND trial_started_at IS NOT NULL
    ),
    'trialEndsAtPresent', count(*) FILTER (
      WHERE non_deleted
        AND subscription_status = 'ACTIVE'
        AND trial_ends_at IS NOT NULL
    )
  ),
  'trialingState', json_build_object(
    'valid', count(*) FILTER (
      WHERE non_deleted
        AND subscription_status = 'TRIALING'
        AND trialing_is_canonical_and_current
    ),
    'expired', count(*) FILTER (
      WHERE non_deleted
        AND subscription_status = 'TRIALING'
        AND paid_until IS NULL
        AND trial_started_at IS NOT NULL
        AND trial_ends_at IS NOT NULL
        AND trial_started_at < trial_ends_at
        AND trial_started_at <= observed_at
        AND trial_ends_at <= observed_at
    ),
    'missingDates', count(*) FILTER (
      WHERE non_deleted
        AND subscription_status = 'TRIALING'
        AND (trial_started_at IS NULL OR trial_ends_at IS NULL)
    ),
    'paidUntilPresentWithCompleteDates', count(*) FILTER (
      WHERE non_deleted
        AND subscription_status = 'TRIALING'
        AND trial_started_at IS NOT NULL
        AND trial_ends_at IS NOT NULL
        AND paid_until IS NOT NULL
    ),
    'invalidOrderOrFutureStart', count(*) FILTER (
      WHERE non_deleted
        AND subscription_status = 'TRIALING'
        AND trial_started_at IS NOT NULL
        AND trial_ends_at IS NOT NULL
        AND paid_until IS NULL
        AND (
          trial_started_at >= trial_ends_at
          OR trial_started_at > observed_at
        )
    ),
    'anyPaidUntilPresent', count(*) FILTER (
      WHERE non_deleted
        AND subscription_status = 'TRIALING'
        AND paid_until IS NOT NULL
    )
  ),
  'expiredState', json_build_object(
    'paidUntilNull', count(*) FILTER (
      WHERE non_deleted
        AND subscription_status = 'EXPIRED'
        AND paid_until IS NULL
    ),
    'paidUntilFuture', count(*) FILTER (
      WHERE non_deleted
        AND subscription_status = 'EXPIRED'
        AND paid_until > observed_at
    ),
    'paidUntilExpired', count(*) FILTER (
      WHERE non_deleted
        AND subscription_status = 'EXPIRED'
        AND paid_until <= observed_at
    ),
    'trialEndsAtNull', count(*) FILTER (
      WHERE non_deleted
        AND subscription_status = 'EXPIRED'
        AND trial_ends_at IS NULL
    ),
    'trialEndsAtFuture', count(*) FILTER (
      WHERE non_deleted
        AND subscription_status = 'EXPIRED'
        AND trial_ends_at > observed_at
    ),
    'trialEndsAtExpired', count(*) FILTER (
      WHERE non_deleted
        AND subscription_status = 'EXPIRED'
        AND trial_ends_at <= observed_at
    ),
    'trialStartedAtPresent', count(*) FILTER (
      WHERE non_deleted
        AND subscription_status = 'EXPIRED'
        AND trial_started_at IS NOT NULL
    )
  ),
  'nonDeletedPlans', json_build_object(
    'null', count(*) FILTER (
      WHERE non_deleted AND plan_id IS NULL
    ),
    'nonNull', count(*) FILTER (
      WHERE non_deleted AND plan_id IS NOT NULL
    ),
    'discordBasic', count(*) FILTER (
      WHERE non_deleted AND plan_id = 'discord-basic'
    ),
    'discordOps', count(*) FILTER (
      WHERE non_deleted AND plan_id = 'discord-ops'
    ),
    'production', count(*) FILTER (
      WHERE non_deleted AND plan_id = 'production'
    ),
    'sportsProduction', count(*) FILTER (
      WHERE non_deleted AND plan_id = 'sports-production'
    ),
    'multiGameProduction', count(*) FILTER (
      WHERE non_deleted AND plan_id = 'multi-game-production'
    ),
    'pubgAutoLauncher', count(*) FILTER (
      WHERE non_deleted AND plan_id = 'pubg-auto-launcher'
    ),
    'legacyOrUnknown', count(*) FILTER (
      WHERE non_deleted
        AND plan_id IS NOT NULL
        AND plan_id NOT IN (
          'discord-basic',
          'discord-ops',
          'production',
          'sports-production',
          'multi-game-production',
          'pubg-auto-launcher'
        )
    )
  ),
  'ownerReferences', json_build_object(
    'missing', count(*) FILTER (
      WHERE non_deleted AND NOT owner_reference_present
    ),
    'linked', count(*) FILTER (
      WHERE non_deleted AND owner_reference_present AND owner_row_present
    ),
    'dangling', count(*) FILTER (
      WHERE non_deleted AND owner_reference_present AND NOT owner_row_present
    )
  ),
  'ownerAnomalies', json_build_object(
    'linkedOwnerDeleted', count(*) FILTER (
      WHERE non_deleted
        AND owner_reference_present
        AND owner_row_present
        AND owner_deleted
    ),
    'linkedOwnerNotActive', count(*) FILTER (
      WHERE non_deleted
        AND owner_reference_present
        AND owner_row_present
        AND owner_status IS DISTINCT FROM 'ACTIVE'
    ),
    'linkedOwnerOrganizationMismatch', count(*) FILTER (
      WHERE non_deleted
        AND owner_reference_present
        AND owner_row_present
        AND NOT owner_organization_matches
    )
  ),
  'clockBoundedAccessCandidate', json_build_object(
    'organizationBlocked', count(*) FILTER (
      WHERE non_deleted AND NOT organization_access_ready
    ),
    'activePaidUntilFuture', count(*) FILTER (
      WHERE non_deleted
        AND organization_access_ready
        AND subscription_status = 'ACTIVE'
        AND paid_until > observed_at
    ),
    'activePaidUntilNull', count(*) FILTER (
      WHERE non_deleted
        AND organization_access_ready
        AND subscription_status = 'ACTIVE'
        AND paid_until IS NULL
    ),
    'activePaidUntilExpired', count(*) FILTER (
      WHERE non_deleted
        AND organization_access_ready
        AND subscription_status = 'ACTIVE'
        AND paid_until <= observed_at
    ),
    'trialingValid', count(*) FILTER (
      WHERE non_deleted
        AND organization_access_ready
        AND subscription_status = 'TRIALING'
        AND trialing_is_canonical_and_current
    ),
    'trialingInvalid', count(*) FILTER (
      WHERE non_deleted
        AND organization_access_ready
        AND subscription_status = 'TRIALING'
        AND NOT trialing_is_canonical_and_current
    ),
    'expired', count(*) FILTER (
      WHERE non_deleted
        AND organization_access_ready
        AND subscription_status = 'EXPIRED'
    ),
    'legacyOrUnknownSubscription', count(*) FILTER (
      WHERE non_deleted
        AND organization_access_ready
        AND (
          subscription_status IS NULL
          OR subscription_status NOT IN ('ACTIVE', 'TRIALING', 'EXPIRED')
        )
    )
  )
)
FROM classified;

COMMIT;

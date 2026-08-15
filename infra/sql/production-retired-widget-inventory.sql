-- Fixed-key, aggregate-only inventory for the exact widget capabilities retired
-- by the reviewed API release. No organization, instance, approval, credential,
-- capability, or operator identifiers are selected.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '2s';
SET LOCAL idle_in_transaction_session_timeout = '20s';

WITH retired_widget_keys(widget_key, ordinal) AS (
  VALUES
    ('style.focal'::text, 1),
    ('team-status'::text, 2),
    ('teams-alive'::text, 3),
    ('kill-feed'::text, 4),
    ('player-card'::text, 5),
    ('map-overlay'::text, 6),
    ('winner'::text, 7)
),
instance_counts AS MATERIALIZED (
  SELECT
    instance_row."widgetKey" AS widget_key,
    count(*) AS widget_instances,
    count(*) FILTER (WHERE instance_row."isActive") AS active_widget_instances
  FROM "WidgetInstance" AS instance_row
  INNER JOIN retired_widget_keys AS reviewed_instance
    ON reviewed_instance.widget_key = instance_row."widgetKey"
  GROUP BY instance_row."widgetKey"
),
approval_counts AS MATERIALIZED (
  SELECT
    approval_row."widgetKey" AS widget_key,
    count(*) AS approval_rows,
    count(*) FILTER (WHERE approval_row."isApproved") AS approved_rows
  FROM "OrganizationWidgetApproval" AS approval_row
  INNER JOIN retired_widget_keys AS reviewed_approval
    ON reviewed_approval.widget_key = approval_row."widgetKey"
  GROUP BY approval_row."widgetKey"
)
SELECT json_build_object(
  'schemaVersion', 1,
  'retiredWidgets', json_agg(
    json_build_object(
      'widgetKey', retired.widget_key,
      'widgetInstances', COALESCE(instances.widget_instances, 0),
      'activeWidgetInstances', COALESCE(instances.active_widget_instances, 0),
      'approvalRows', COALESCE(approvals.approval_rows, 0),
      'approvedRows', COALESCE(approvals.approved_rows, 0)
    ) ORDER BY retired.ordinal
  )
)
FROM retired_widget_keys AS retired
LEFT JOIN instance_counts AS instances
  ON instances.widget_key = retired.widget_key
LEFT JOIN approval_counts AS approvals
  ON approvals.widget_key = retired.widget_key;

COMMIT;

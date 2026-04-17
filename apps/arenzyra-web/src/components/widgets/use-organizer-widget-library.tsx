"use client";

import { LIVE_WIDGETS } from "@/components/widgets/live-widgets";
import { useOrganization } from "@/context/OrganizationContext";
import { apiFetch } from "@/lib/api";
import { useCallback, useEffect, useMemo, useState } from "react";
import { slugify } from "./organizer-widget-catalog";

type MeResponse = {
  user?: {
    actingOrgId?: string | null;
    actingOrgName?: string | null;
    organizationName?: string | null;
  } | null;
  organization?: {
    id?: string | null;
    name?: string | null;
  } | null;
};

export type WidgetApprovalRecord = {
  widgetKey: string;
  isApproved: boolean;
  approvedAt: string | null;
  approvedBy: string | null;
};

export type WidgetAccessListResponse = {
  organizationId: string;
  organizationSlug: string;
  enforced: boolean;
  approvals: WidgetApprovalRecord[];
};

export function useOrganizerWidgetLibrary() {
  const { organizationId, organizationName } = useOrganization();
  const [sessionOrganizationId, setSessionOrganizationId] = useState<string | null>(null);
  const [sessionOrganizationName, setSessionOrganizationName] = useState<string | null>(null);
  const [widgetAccess, setWidgetAccess] = useState<WidgetAccessListResponse | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadSession = async () => {
      try {
        const res = await apiFetch("/auth/me", { cache: "no-store" });
        const payload = (await res.json()) as MeResponse;
        if (cancelled) return;
        setSessionOrganizationId(
          payload.user?.actingOrgId ?? payload.organization?.id ?? null,
        );
        setSessionOrganizationName(
          payload.user?.actingOrgName ??
            payload.organization?.name ??
            payload.user?.organizationName ??
            null,
        );
      } catch {
        if (!cancelled) {
          setSessionOrganizationId(null);
          setSessionOrganizationName(null);
        }
      }
    };

    void loadSession();

    return () => {
      cancelled = true;
    };
  }, []);

  const resolvedOrganizationId = useMemo(
    () => organizationId ?? sessionOrganizationId ?? null,
    [organizationId, sessionOrganizationId],
  );
  const fallbackOrgSlug = useMemo(() => {
    const rawOrganizationName = organizationName ?? sessionOrganizationName;
    return rawOrganizationName ? slugify(rawOrganizationName) : null;
  }, [organizationName, sessionOrganizationName]);
  const resolvedOrganizationSlug = useMemo(
    () => widgetAccess?.organizationSlug ?? fallbackOrgSlug ?? null,
    [fallbackOrgSlug, widgetAccess?.organizationSlug],
  );

  useEffect(() => {
    let cancelled = false;

    const loadWidgetAccess = async () => {
      if (!resolvedOrganizationId && !fallbackOrgSlug) {
        if (!cancelled) {
          setWidgetAccess(null);
        }
        return;
      }

      try {
        const query = resolvedOrganizationId
          ? `organizationId=${encodeURIComponent(resolvedOrganizationId)}`
          : `orgSlug=${encodeURIComponent(fallbackOrgSlug ?? "")}`;
        const res = await apiFetch(`/api/widgets/access-list?${query}`, {
          cache: "no-store",
        });
        const payload = (await res.json()) as WidgetAccessListResponse;
        if (cancelled) return;
        setWidgetAccess(payload);
      } catch {
        if (!cancelled) {
          setWidgetAccess(null);
        }
      }
    };

    void loadWidgetAccess();

    return () => {
      cancelled = true;
    };
  }, [fallbackOrgSlug, resolvedOrganizationId]);

  const widgetApprovalByKey = useMemo(
    () =>
      new Map(
        (widgetAccess?.approvals ?? []).map((approval) => [approval.widgetKey, approval] as const),
      ),
    [widgetAccess],
  );

  const isWidgetApproved = useCallback(
    (widgetKey: string) => {
      const approval = widgetApprovalByKey.get(widgetKey);
      if (approval) return approval.isApproved;
      return !(widgetAccess?.enforced ?? false);
    },
    [widgetAccess?.enforced, widgetApprovalByKey],
  );

  const approvedLiveWidgets = useMemo(
    () => LIVE_WIDGETS.filter((widget) => isWidgetApproved(widget.key)),
    [isWidgetApproved],
  );

  return {
    resolvedOrganizationId,
    resolvedOrganizationSlug,
    widgetAccess,
    isWidgetApproved,
    approvedLiveWidgets,
  };
}

"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRightLeft,
  Ban,
  Building2,
  CalendarDays,
  ChevronDown,
  ImagePlus,
  LayoutTemplate,
  Palette,
  ShieldCheck,
  Trash2,
  Trophy,
  UserRound,
  Users,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { AppError } from "@/components/ui/AppError";
import { AppSkeleton } from "@/components/ui/AppSkeleton";
import ConfirmDeleteModal from "@/components/common/ConfirmDeleteModal";
import { useAuth } from "@/context/AuthContext";
import { fetchSession } from "@/lib/auth";
import {
  clearImpersonationTokens,
  restoreImpersonationTokens,
  stashImpersonationTokens,
  storeAuthTokensFromResponse,
} from "@/lib/auth-storage";

type Organization = {
  id: string;
  name: string;
  slug: string;
  status: string;
  kycStatus: string;
  widgetApprovalEnforced?: boolean;
  ownerUserId: string | null;
  ownerEmail: string | null;
  ownerName: string | null;
  createdAt: string;
  updatedAt: string;
};

type Branding = {
  primaryColor?: string | null;
  accent?: string | null;
  widgetBackground?: string | null;
  mode?: string | null;
};

type OrganizationUser = {
  id: string;
  name?: string | null;
  email?: string | null;
  organizationId?: string | null;
  organization?: { id?: string | null; name?: string | null } | null;
  createdAt?: string | null;
};

type OrganizerSummary = {
  id: string;
  tournamentsActive?: number | null;
  _count?: {
    tournaments?: number | null;
    teams?: number | null;
    players?: number | null;
    users?: number | null;
  } | null;
};

type OrganizationStats = {
  tournaments: number | null;
  teams: number | null;
  players: number | null;
  users: number | null;
};

type OrganizationLicense = {
  id: string;
  organizationId: string;
  licenseKey: string;
  type: string;
  status: string;
  maxObservers: number;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  valid: boolean;
};

type LicenseFormState = {
  licenseKey: string;
  type: string;
  status: string;
  maxObservers: string;
  expiresAt: string;
};

type WidgetApprovalRecord = {
  widgetKey: string;
  isApproved: boolean;
  approvedAt: string | null;
  approvedBy: string | null;
  approvedByName?: string | null;
  approvedByEmail?: string | null;
};

type WidgetApprovalResponse = {
  organizationId: string;
  organizationSlug: string;
  enforced: boolean;
  approvals: WidgetApprovalRecord[];
};

type WidgetApprovalCatalogItem = {
  key: string;
  title: string;
  description: string;
  family: "live" | "legacy";
};

type WidgetApprovalMutationResponse = {
  organizationId: string;
  enforced: boolean;
  approval: WidgetApprovalRecord | null;
};

type DetailSection =
  | "overview"
  | "ownership"
  | "licenses"
  | "branding"
  | "widgets"
  | "danger";

const STATUS_OPTIONS = [
  { value: "PENDING", label: "Pending" },
  { value: "APPROVED", label: "Approved" },
  { value: "SUSPENDED", label: "Suspended" },
];

const KYC_OPTIONS = [
  { value: "PENDING", label: "Pending" },
  { value: "APPROVED", label: "Verified" },
  { value: "REJECTED", label: "Rejected" },
];

const LICENSE_TYPE_OPTIONS = [
  { value: "TRIAL", label: "Trial" },
  { value: "STANDARD", label: "Standard" },
  { value: "ENTERPRISE", label: "Enterprise" },
];

const LICENSE_STATUS_OPTIONS = [
  { value: "ACTIVE", label: "Active" },
  { value: "EXPIRED", label: "Expired" },
  { value: "SUSPENDED", label: "Suspended" },
];

const EMPTY_STATS: OrganizationStats = {
  tournaments: null,
  teams: null,
  players: null,
  users: null,
};

const EMPTY_LICENSE_FORM: LicenseFormState = {
  licenseKey: "",
  type: "STANDARD",
  status: "ACTIVE",
  maxObservers: "1",
  expiresAt: "",
};

function sortWidgetApprovals(left: WidgetApprovalRecord, right: WidgetApprovalRecord) {
  return left.widgetKey.localeCompare(right.widgetKey);
}

function normalizeWidgetApprovalRecord(value: unknown): WidgetApprovalRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<WidgetApprovalRecord> & {
    widgetKey?: unknown;
    isApproved?: unknown;
    approvedAt?: unknown;
    approvedBy?: unknown;
    approvedByName?: unknown;
    approvedByEmail?: unknown;
  };

  if (typeof candidate.widgetKey !== "string" || candidate.widgetKey.trim().length === 0) {
    return null;
  }

  return {
    widgetKey: candidate.widgetKey,
    isApproved: candidate.isApproved === true,
    approvedAt: typeof candidate.approvedAt === "string" ? candidate.approvedAt : null,
    approvedBy: typeof candidate.approvedBy === "string" ? candidate.approvedBy : null,
    approvedByName:
      typeof candidate.approvedByName === "string" ? candidate.approvedByName : null,
    approvedByEmail:
      typeof candidate.approvedByEmail === "string" ? candidate.approvedByEmail : null,
  };
}

function normalizeWidgetApprovalList(value: unknown): WidgetApprovalRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => normalizeWidgetApprovalRecord(item))
    .filter((item): item is WidgetApprovalRecord => item !== null)
    .sort(sortWidgetApprovals);
}

const WIDGET_APPROVAL_CATALOG: WidgetApprovalCatalogItem[] = [
  {
    key: "countdown",
    title: "Countdown",
    description: "Pre-show countdown for lobbies and match starts.",
    family: "legacy",
  },
  {
    key: "match-intro",
    title: "Match Intro",
    description: "Opening slate with tournament, match, and map context.",
    family: "legacy",
  },
  {
    key: "teams-lineup",
    title: "Teams Lineup",
    description: "Pre-match lineup board using assigned lobby slots.",
    family: "legacy",
  },
  {
    key: "map-card",
    title: "Map Card",
    description: "Fullscreen map spotlight slate for the upcoming game.",
    family: "legacy",
  },
  {
    key: "lobby-slot-list",
    title: "Lobby / Slot List",
    description: "Slot-by-slot lobby readiness board for the upcoming match.",
    family: "legacy",
  },
  {
    key: "sponsor-banner",
    title: "Sponsor Banner",
    description: "Pre-show sponsor showcase banner for tournament partners.",
    family: "legacy",
  },
  {
    key: "next-match",
    title: "Next Match",
    description: "Upcoming match reminder card with countdown and map context.",
    family: "legacy",
  },
  {
    key: "team-status",
    title: "Team Status",
    description: "Team-by-team status board for organizer broadcast routes.",
    family: "legacy",
  },
  {
    key: "match-results",
    title: "Match Results",
    description: "Post-match results card for organizer routes.",
    family: "legacy",
  },
  {
    key: "match-summary",
    title: "Match Summary",
    description: "Post-match totals board for kills, knocks, assists, damage, and duration.",
    family: "legacy",
  },
  {
    key: "head-to-head-comparison",
    title: "Head to Head Comparison",
    description: "Post-match winner versus runner-up comparison once telemetry confirms the finish.",
    family: "legacy",
  },
  {
    key: "winner-celebration",
    title: "Winner Celebration",
    description: "Post-match winner hero slate for organizer routes.",
    family: "legacy",
  },
  {
    key: "overall-standings",
    title: "Overall Standings",
    description: "Post-match standings board for organizer routes.",
    family: "legacy",
  },
  {
    key: "mvp-top-fragger",
    title: "MVP / Top Fragger",
    description: "Post-match feature card for MVP and final top fragger.",
    family: "legacy",
  },
  {
    key: "points-breakdown",
    title: "Points Breakdown",
    description: "Post-match scoring split for placement, kill, and adjustment points.",
    family: "legacy",
  },
  {
    key: "next-match-break",
    title: "Next Match / Break",
    description: "Post-match transition card for desk breaks and the upcoming match.",
    family: "legacy",
  },
  {
    key: "teams-alive",
    title: "Teams Alive",
    description: "Live survival counter overlay.",
    family: "live",
  },
  {
    key: "leaderboard",
    title: "Leaderboard",
    description: "Right-side live standings widget.",
    family: "live",
  },
  {
    key: "overall-live-ranking",
    title: "Overall Live Ranking",
    description: "Tournament or group standings during the live match.",
    family: "live",
  },
  {
    key: "match-lower-third",
    title: "Match Lower Third",
    description: "Bottom-left match identification overlay.",
    family: "live",
  },
  {
    key: "kill-feed",
    title: "Kill Feed",
    description: "Live elimination ticker.",
    family: "live",
  },
  {
    key: "player-card",
    title: "Player Card",
    description: "Focused player stats card.",
    family: "live",
  },
  {
    key: "player-photo",
    title: "Player Photo",
    description: "Photo-only focused player portrait.",
    family: "live",
  },
  {
    key: "map-overlay",
    title: "Map Overlay",
    description: "Enhanced tactical map overlay with live zones and team positions.",
    family: "live",
  },
  {
    key: "next-zone-update",
    title: "Next Zone Update",
    description: "Final 20-second next-zone countdown widget.",
    family: "live",
  },
  {
    key: "wwcd",
    title: "WWCD",
    description: "Winner Winner Chicken Dinner slate shown only after match finalization.",
    family: "live",
  },
  {
    key: "winner",
    title: "Winner",
    description: "Winner slate for chicken dinner moments.",
    family: "live",
  },
  {
    key: "fight-alert",
    title: "Fight Alert",
    description: "Fight detection banner for high-attention engagements.",
    family: "live",
  },
  {
    key: "replay-marker",
    title: "Replay Marker",
    description: "Desktop replay moment banner fed by observer-assist match markers.",
    family: "live",
  },
  {
    key: "achievement-alert",
    title: "Achievement Alert",
    description: "Live player achievement popup.",
    family: "live",
  },
  {
    key: "team-eliminated-alert",
    title: "Team Eliminated Alert",
    description: "Team elimination event banner.",
    family: "live",
  },
];

const DEFAULT_DETAIL_SECTION: DetailSection = "overview";

const DETAIL_SECTIONS: Array<{
  key: DetailSection;
  label: string;
  description: string;
  icon: typeof Building2;
}> = [
  {
    key: "overview",
    label: "Overview",
    description: "Core identity, compliance status, and organization usage at a glance.",
    icon: Building2,
  },
  {
    key: "ownership",
    label: "Ownership",
    description: "Assign the responsible operator account for this organization.",
    icon: UserRound,
  },
  {
    key: "licenses",
    label: "Licenses",
    description: "Manage launcher licenses, observer limits, and expiry windows.",
    icon: ShieldCheck,
  },
  {
    key: "branding",
    label: "Branding",
    description: "Configure overlay colors and future-ready logo assets.",
    icon: Palette,
  },
  {
    key: "widgets",
    label: "Widget Access",
    description: "Approve, block, and enforce widget route access for this organization.",
    icon: LayoutTemplate,
  },
  {
    key: "danger",
    label: "Danger Zone",
    description: "High-impact actions that immediately affect organization access.",
    icon: Ban,
  },
];

export default function OrganizationDetailPage() {
  const { user, refresh } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const params = useParams<{ id: string }>();
  const orgId = params?.id;

  const [org, setOrg] = useState<Organization | null>(null);
  const [branding, setBranding] = useState<Branding | null>(null);
  const [users, setUsers] = useState<OrganizationUser[]>([]);
  const [stats, setStats] = useState<OrganizationStats>(EMPTY_STATS);
  const [licenses, setLicenses] = useState<OrganizationLicense[]>([]);
  const [widgetApprovals, setWidgetApprovals] = useState<WidgetApprovalRecord[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usersLoading, setUsersLoading] = useState(false);

  const [complianceSaving, setComplianceSaving] = useState(false);
  const [ownerUpdating, setOwnerUpdating] = useState(false);
  const [brandingSaving, setBrandingSaving] = useState(false);
  const [impersonating, setImpersonating] = useState(false);
  const [suspending, setSuspending] = useState(false);
  const [deletingOrganization, setDeletingOrganization] = useState(false);
  const [licenseSaving, setLicenseSaving] = useState(false);
  const [widgetApprovalSavingKey, setWidgetApprovalSavingKey] = useState<string | null>(null);
  const [widgetApprovalConfigSaving, setWidgetApprovalConfigSaving] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const [ownerInput, setOwnerInput] = useState("");
  const [kycStatus, setKycStatus] = useState("PENDING");
  const [kycNote, setKycNote] = useState("");
  const [savedKycNote, setSavedKycNote] = useState("");
  const [orgStatus, setOrgStatus] = useState("PENDING");
  const [primaryColor, setPrimaryColor] = useState("");
  const [widgetBackground, setWidgetBackground] = useState("");
  const [logoFileName, setLogoFileName] = useState("");
  const [selectedLicenseId, setSelectedLicenseId] = useState<string>("new");
  const [licenseForm, setLicenseForm] = useState<LicenseFormState>(EMPTY_LICENSE_FORM);
  const [widgetApprovalEnforced, setWidgetApprovalEnforced] = useState(false);

  const load = useCallback(async () => {
    if (!orgId) {
      setError("Organization id missing.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setUsersLoading(true);
    setError(null);
    setStats(EMPTY_STATS);

    try {
      const [
        orgResult,
        brandingResult,
        usersResult,
        orgUsersResult,
        organizersResult,
        licensesResult,
        widgetApprovalsResult,
      ] = await Promise.allSettled([
        apiFetch(`/super/organizations/${orgId}`, { cache: "no-store" }),
        apiFetch(`/branding/${orgId}`, { cache: "no-store" }),
        apiFetch("/super/managed-users", { cache: "no-store" }),
        apiFetch(`/super/users?orgId=${encodeURIComponent(orgId)}&pageSize=1`, {
          cache: "no-store",
        }),
        apiFetch("/super/organizers", { cache: "no-store" }),
        apiFetch(`/super/organizations/${orgId}/licenses`, { cache: "no-store" }),
        apiFetch(`/super/organizations/${orgId}/widget-approvals`, {
          cache: "no-store",
        }),
      ]);

      if (orgResult.status === "rejected") {
        throw orgResult.reason;
      }

      const orgJson = await orgResult.value.json();
      const orgData =
        ((orgJson as { data?: Organization }).data ??
          (orgJson as Organization | null)) ??
        null;

      if (!orgData) {
        throw new Error("Failed to load organization.");
      }

      setOrg(orgData);
      setOrgStatus(orgData.status);
      setKycStatus(orgData.kycStatus);
      setOwnerInput(orgData.ownerUserId ?? "");
      setKycNote("");
      setSavedKycNote("");
      setLogoFileName("");
      setWidgetApprovalEnforced(orgData.widgetApprovalEnforced === true);

      if (brandingResult.status === "fulfilled") {
        const brandingJson = await brandingResult.value.json();
        const brandingData =
          ((brandingJson as { branding?: Branding; data?: Branding }).branding ??
            (brandingJson as { data?: Branding }).data ??
            null) as Branding | null;
        setBranding(brandingData);
        setPrimaryColor(brandingData?.primaryColor ?? "");
        setWidgetBackground(brandingData?.widgetBackground ?? "");
      } else {
        setBranding(null);
        setPrimaryColor("");
        setWidgetBackground("");
      }

      if (licensesResult.status === "fulfilled") {
        const licensesJson = await licensesResult.value.json();
        const nextLicenses = extractArray<OrganizationLicense>(licensesJson).sort(
          sortLicenses,
        );
        setLicenses(nextLicenses);
        if (nextLicenses.length > 0) {
          setSelectedLicenseId(nextLicenses[0].id);
          setLicenseForm(toLicenseForm(nextLicenses[0]));
        } else {
          setSelectedLicenseId("new");
          setLicenseForm(EMPTY_LICENSE_FORM);
        }
      } else {
        setLicenses([]);
        setSelectedLicenseId("new");
        setLicenseForm(EMPTY_LICENSE_FORM);
      }

      if (widgetApprovalsResult.status === "fulfilled") {
        const widgetApprovalsJson = (await widgetApprovalsResult.value.json()) as {
          data?: WidgetApprovalResponse;
        };
        const widgetApprovalData = widgetApprovalsJson.data ?? null;
        setWidgetApprovals(normalizeWidgetApprovalList(widgetApprovalData?.approvals));
        setWidgetApprovalEnforced(
          widgetApprovalData?.enforced ?? (orgData.widgetApprovalEnforced === true),
        );
      } else {
        setWidgetApprovals([]);
        setWidgetApprovalEnforced(orgData.widgetApprovalEnforced === true);
      }

      if (usersResult.status === "fulfilled") {
        const usersJson = await usersResult.value.json();
        setUsers(extractArray<OrganizationUser>(usersJson));
      } else {
        setUsers([]);
      }

      const nextStats: OrganizationStats = { ...EMPTY_STATS };

      if (orgUsersResult.status === "fulfilled") {
        const orgUsersJson = await orgUsersResult.value.json();
        nextStats.users =
          typeof (orgUsersJson as { total?: number }).total === "number"
            ? (orgUsersJson as { total: number }).total
            : extractArray<OrganizationUser>(orgUsersJson).length;
      }

      if (organizersResult.status === "fulfilled") {
        const organizersJson = await organizersResult.value.json();
        const organizers = extractArray<OrganizerSummary>(organizersJson);
        const summary = organizers.find((item) => item.id === orgData.id);
        if (summary) {
          nextStats.tournaments =
            summary._count?.tournaments ?? summary.tournamentsActive ?? null;
          nextStats.teams = summary._count?.teams ?? null;
          nextStats.players = summary._count?.players ?? null;
        }
      }

      setStats(nextStats);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load organization");
    } finally {
      setLoading(false);
      setUsersLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const actingOrgId =
    ((user as { actingOrgId?: string | null } | null)?.actingOrgId ?? null);

  const activeSection = normalizeDetailSection(searchParams.get("section"));

  const setActiveSection = useCallback(
    (nextSection: DetailSection) => {
      if (!orgId) return;

      const nextParams = new URLSearchParams(searchParams.toString());
      if (nextSection === DEFAULT_DETAIL_SECTION) {
        nextParams.delete("section");
      } else {
        nextParams.set("section", nextSection);
      }

      const query = nextParams.toString();
      router.replace(
        query
          ? `/super-admin/organizations/${orgId}?${query}`
          : `/super-admin/organizations/${orgId}`,
        { scroll: false },
      );
    },
    [orgId, router, searchParams],
  );

  const ownerOptions = useMemo(() => {
    const options = users.map((candidate) => ({
      value: candidate.id,
      label: getUserLabel(candidate),
    }));

    if (
      org?.ownerUserId &&
      !options.some((candidate) => candidate.value === org.ownerUserId)
    ) {
      options.unshift({
        value: org.ownerUserId,
        label: org.ownerEmail
          ? `${org.ownerName?.trim() || org.ownerEmail} (${org.ownerEmail})`
          : org.ownerUserId,
      });
    }

    return [{ value: "", label: "Unassigned" }, ...options];
  }, [org, users]);

  const complianceDirty =
    !!org &&
    (orgStatus !== org.status ||
      kycStatus !== org.kycStatus ||
      kycNote.trim() !== savedKycNote);

  const ownerDirty = !!org && ownerInput !== (org.ownerUserId ?? "");

  const brandingDirty =
    primaryColor !== (branding?.primaryColor ?? "") ||
    widgetBackground !== (branding?.widgetBackground ?? "");

  const selectedLicense = useMemo(
    () => licenses.find((license) => license.id === selectedLicenseId) ?? null,
    [licenses, selectedLicenseId],
  );

  const currentValidLicense = useMemo(
    () =>
      licenses.find((license) => license.valid) ??
      licenses.find((license) => license.status === "ACTIVE") ??
      null,
    [licenses],
  );

  const licenseDirty = useMemo(() => {
    if (!selectedLicense) {
      return (
        licenseForm.licenseKey.trim() !== "" ||
        licenseForm.type !== EMPTY_LICENSE_FORM.type ||
        licenseForm.status !== EMPTY_LICENSE_FORM.status ||
        licenseForm.maxObservers !== EMPTY_LICENSE_FORM.maxObservers ||
        licenseForm.expiresAt !== EMPTY_LICENSE_FORM.expiresAt
      );
    }

    const normalizedObservers = String(
      Math.max(1, Number(licenseForm.maxObservers || "1")),
    );

    return (
      licenseForm.licenseKey.trim() !== selectedLicense.licenseKey ||
      licenseForm.type !== selectedLicense.type ||
      licenseForm.status !== selectedLicense.status ||
      normalizedObservers !== String(selectedLicense.maxObservers) ||
      licenseForm.expiresAt !== isoToDateTimeLocal(selectedLicense.expiresAt)
    );
  }, [licenseForm, selectedLicense]);

  const canSaveLicense =
    licenseForm.licenseKey.trim().length > 0 &&
    Number(licenseForm.maxObservers) >= 1 &&
    licenseForm.expiresAt.trim().length > 0;

  const widgetApprovalMap = useMemo(
    () => new Map(widgetApprovals.map((approval) => [approval.widgetKey, approval])),
    [widgetApprovals],
  );

  const widgetApprovalGroups = useMemo(
    () => ({
      live: WIDGET_APPROVAL_CATALOG.filter((item) => item.family === "live"),
      legacy: WIDGET_APPROVAL_CATALOG.filter((item) => item.family === "legacy"),
    }),
    [],
  );

  function getWidgetApprovalState(widgetKey: string) {
    const approval = widgetApprovalMap.get(widgetKey) ?? null;

    if (approval?.isApproved) {
      return {
        tone: "approved" as const,
        label: "Approved",
        helper: approval.approvedAt
          ? `Approved ${formatDateTime(approval.approvedAt)}`
          : "Approved for this organization.",
      };
    }

    if (approval && !approval.isApproved) {
      return {
        tone: "blocked" as const,
        label: "Blocked",
        helper: "Explicitly blocked for this organization.",
      };
    }

    if (widgetApprovalEnforced) {
      return {
        tone: "pending" as const,
        label: "Approval required",
        helper: "This widget stays unavailable until approved.",
      };
    }

    return {
      tone: "open" as const,
      label: "Open by default",
      helper: "Currently available because org enforcement is off.",
    };
  }

  const statItems = [
    {
      label: "Total tournaments",
      value: stats.tournaments,
      description: "Published across the organization.",
      icon: Trophy,
    },
    {
      label: "Teams",
      value: stats.teams,
      description: "Registered team records.",
      icon: Users,
    },
    {
      label: "Players",
      value: stats.players,
      description: "Managed player profiles.",
      icon: UserRound,
    },
    {
      label: "Users",
      value: stats.users,
      description: "Accounts assigned to this organization.",
      icon: ShieldCheck,
    },
  ];

  async function patchStatus(nextStatus: string) {
    if (!org) return null;
    const res = await apiFetch(`/super/organizations/${org.id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: nextStatus }),
    });
    const json = (await res.json()) as { data: Organization };
    setOrg(json.data);
    setOrgStatus(json.data.status);
    return json.data;
  }

  async function patchKyc(nextKycStatus: string, note: string) {
    if (!org) return null;
    const res = await apiFetch(`/super/organizations/${org.id}/kyc`, {
      method: "PATCH",
      body: JSON.stringify({
        kycStatus: nextKycStatus,
        note: note || null,
      }),
    });
    const json = (await res.json()) as { data: Organization };
    setOrg(json.data);
    setKycStatus(json.data.kycStatus);
    setSavedKycNote(note);
    return json.data;
  }

  async function saveCompliance() {
    if (!org || !complianceDirty) return;
    setComplianceSaving(true);
    setError(null);
    try {
      const note = kycNote.trim();
      if (orgStatus !== org.status) {
        await patchStatus(orgStatus);
      }
      if (kycStatus !== org.kycStatus || note !== savedKycNote) {
        await patchKyc(kycStatus, note);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save compliance");
    } finally {
      setComplianceSaving(false);
    }
  }

  async function updateOwner() {
    if (!org || !ownerDirty) return;
    setOwnerUpdating(true);
    setError(null);
    try {
      const res = await apiFetch(`/super/organizations/${org.id}/owner`, {
        method: "PATCH",
        body: JSON.stringify({
          ownerUserId: ownerInput.trim() === "" ? null : ownerInput.trim(),
        }),
      });
      const json = (await res.json()) as { data: Organization };
      setOrg(json.data);
      setOwnerInput(json.data.ownerUserId ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update owner");
    } finally {
      setOwnerUpdating(false);
    }
  }

  async function saveBranding() {
    setBrandingSaving(true);
    setError(null);
    try {
      const res = await apiFetch(`/branding/${orgId}`, {
        method: "PATCH",
        body: JSON.stringify({
          primaryColor: primaryColor || undefined,
          widgetBackground: widgetBackground || undefined,
        }),
      });
      const json = (await res.json()) as { branding?: Branding; data?: Branding };
      const updated = json.branding ?? json.data ?? null;
      setBranding(updated);
      setPrimaryColor(updated?.primaryColor ?? "");
      setWidgetBackground(updated?.widgetBackground ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update branding");
    } finally {
      setBrandingSaving(false);
    }
  }

  function selectLicense(license: OrganizationLicense) {
    setSelectedLicenseId(license.id);
    setLicenseForm(toLicenseForm(license));
  }

  function startNewLicense() {
    setSelectedLicenseId("new");
    setLicenseForm(EMPTY_LICENSE_FORM);
  }

  async function saveLicense() {
    if (!org) return;
    if (!canSaveLicense) {
      setError("License key, observer limit, and expiry are required.");
      return;
    }

    const expiresAt = dateTimeLocalToIso(licenseForm.expiresAt);
    if (!expiresAt) {
      setError("Expiry must be a valid date and time.");
      return;
    }

    setLicenseSaving(true);
    setError(null);

    try {
      const payload = {
        licenseKey: licenseForm.licenseKey.trim(),
        type: licenseForm.type,
        status: licenseForm.status,
        maxObservers: Math.max(1, Number(licenseForm.maxObservers || "1")),
        expiresAt,
      };

      const res = await apiFetch(
        selectedLicense
          ? `/super/organizations/${org.id}/licenses/${selectedLicense.id}`
          : `/super/organizations/${org.id}/licenses`,
        {
          method: selectedLicense ? "PATCH" : "POST",
          body: JSON.stringify(payload),
        },
      );

      const json = (await res.json()) as { data: OrganizationLicense };
      const saved = json.data;

      setLicenses((current) => {
        const next = selectedLicense
          ? current.map((license) =>
              license.id === saved.id ? saved : license,
            )
          : [saved, ...current];
        return next.sort(sortLicenses);
      });
      setSelectedLicenseId(saved.id);
      setLicenseForm(toLicenseForm(saved));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save license");
    } finally {
      setLicenseSaving(false);
    }
  }

  async function saveWidgetApprovalConfig(enforced: boolean) {
    if (!org || widgetApprovalEnforced === enforced) return;
    setWidgetApprovalConfigSaving(true);
    setError(null);
    try {
      const res = await apiFetch(`/super/organizations/${org.id}/widget-approvals/config`, {
        method: "PATCH",
        body: JSON.stringify({ enforced }),
      });
      const json = (await res.json()) as {
        data?: { organizationId: string; enforced: boolean };
      };
      const nextEnforced = json.data?.enforced === true;
      setWidgetApprovalEnforced(nextEnforced);
      setOrg((current) =>
        current
          ? {
              ...current,
              widgetApprovalEnforced: nextEnforced,
            }
          : current,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update widget approval mode");
    } finally {
      setWidgetApprovalConfigSaving(false);
    }
  }

  async function saveWidgetApproval(widgetKey: string, isApproved: boolean) {
    if (!org) return;
    setWidgetApprovalSavingKey(widgetKey);
    setError(null);
    try {
      const res = await apiFetch(
        `/super/organizations/${org.id}/widget-approvals/${encodeURIComponent(widgetKey)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ isApproved }),
        },
      );
      const json = (await res.json()) as { data?: WidgetApprovalMutationResponse };
      const nextApproval = normalizeWidgetApprovalRecord(json.data?.approval);
      if (!nextApproval) {
        throw new Error("Failed to save widget approval.");
      }
      setWidgetApprovalEnforced(json.data?.enforced === true);

      setWidgetApprovals((current) => {
        const next = current.filter((approval) => approval.widgetKey !== widgetKey);
        next.push(nextApproval);
        next.sort(sortWidgetApprovals);
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update widget approval");
    } finally {
      setWidgetApprovalSavingKey(null);
    }
  }

  async function impersonateOrg() {
    if (!org) return;
    setImpersonating(true);
    setError(null);
    try {
      stashImpersonationTokens();
      const res = await apiFetch("/admin/impersonate-org", {
        method: "POST",
        body: JSON.stringify({ orgId: org.id }),
      });
      const payload = await res.json();
      storeAuthTokensFromResponse(payload);
      const session = await fetchSession();
      const actingOrg =
        (session?.user as { actingOrgId?: string | null } | null)?.actingOrgId ??
        null;
      if (actingOrg !== org.id) {
        throw new Error("Impersonation did not apply to session");
      }
      await refresh();
      router.replace("/organizer");
      router.refresh();
    } catch (err) {
      if (!restoreImpersonationTokens()) {
        clearImpersonationTokens();
      }
      setError(err instanceof Error ? err.message : "Failed to impersonate");
    } finally {
      setImpersonating(false);
    }
  }

  async function suspendOrganization() {
    if (!org || org.status === "SUSPENDED") return;
    setSuspending(true);
    setError(null);
    try {
      await patchStatus("SUSPENDED");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to suspend organization");
    } finally {
      setSuspending(false);
    }
  }

  async function deleteOrganization() {
    if (!org) return;
    setDeletingOrganization(true);
    setError(null);
    try {
      await apiFetch(`/super/organizers/${org.id}`, {
        method: "DELETE",
        body: JSON.stringify({
          reason: "Super admin deleted organization from Organization detail page",
        }),
      });
      setDeleteConfirmOpen(false);
      router.replace("/super-admin/organizations");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete organization");
    } finally {
      setDeletingOrganization(false);
    }
  }

  if (loading) {
    if (!orgId) return <AppError message="Organization id missing." />;
    return <AppSkeleton lines={10} />;
  }

  if (!orgId) {
    return <AppError message="Organization id missing." />;
  }

  if (!org) {
    return <AppError message={error ?? "Failed to load organization."} onRetry={load} />;
  }

  const ownerSummary = org.ownerEmail
    ? `${org.ownerName?.trim() || org.ownerEmail} (${org.ownerEmail})`
    : "Unassigned";

  const currentSectionMeta =
    DETAIL_SECTIONS.find((section) => section.key === activeSection) ??
    DETAIL_SECTIONS[0];

  const healthHighlights = [
    {
      label: "Owner",
      value: ownerSummary,
      helper: org.ownerUserId ? "Assigned operator account" : "Assignment required",
      tone: org.ownerUserId ? ("success" as const) : ("warning" as const),
    },
    {
      label: "Compliance",
      value: `${formatEnumLabel(org.status)} / ${
        org.kycStatus === "APPROVED" ? "Verified" : formatEnumLabel(org.kycStatus)
      }`,
      helper: `Last updated ${formatDate(org.updatedAt)}`,
      tone:
        org.status === "APPROVED" && org.kycStatus === "APPROVED"
          ? ("success" as const)
          : org.status === "SUSPENDED" || org.kycStatus === "REJECTED"
            ? ("warning" as const)
            : ("default" as const),
    },
    {
      label: "Launcher",
      value: currentValidLicense ? currentValidLicense.licenseKey : "No valid license",
      helper: currentValidLicense
        ? `${currentValidLicense.maxObservers} observer${
            currentValidLicense.maxObservers === 1 ? "" : "s"
          } until ${formatDate(currentValidLicense.expiresAt)}`
        : "Observer launcher access is currently blocked",
      tone: currentValidLicense ? ("success" as const) : ("warning" as const),
    },
    {
      label: "Widgets",
      value: widgetApprovalEnforced ? "Approval required" : "Open by default",
      helper: widgetApprovalEnforced
        ? "Every route needs explicit approval"
        : "New widgets stay available until blocked",
      tone: widgetApprovalEnforced ? ("default" as const) : ("success" as const),
    },
  ];

  const activeWarnings = [
    !org.ownerUserId ? "Owner is not assigned yet." : null,
    org.status !== "APPROVED" ? `Organization status is ${formatEnumLabel(org.status)}.` : null,
    org.kycStatus !== "APPROVED"
      ? `KYC is ${org.kycStatus === "PENDING" ? "Pending" : formatEnumLabel(org.kycStatus)}.`
      : null,
    !currentValidLicense ? "No active launcher license is available." : null,
  ].filter(Boolean) as string[];

  return (
    <div className="space-y-6">
      {error ? (
        <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      ) : null}

      <header className="space-y-6 rounded-2xl border border-white/10 bg-white/5 p-6">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/45">
                Organization Detail
              </span>
              <StatusBadge value={org.status} />
              <StatusBadge value={org.kycStatus} type="kyc" />
            </div>

            <div>
              <h1 className="text-3xl font-bold text-white">{org.name}</h1>
              <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-white/60">
                <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 font-medium text-white/75">
                  /{org.slug}
                </span>
                <span className="inline-flex items-center gap-2">
                  <CalendarDays className="h-4 w-4 text-cyan-300" />
                  Created {formatDate(org.createdAt)}
                </span>
              </div>
            </div>

            {actingOrgId === org.id ? (
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300">
                Currently impersonating this organization
              </div>
            ) : null}
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-cyan-950/40 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={impersonateOrg}
              disabled={impersonating}
            >
              <ArrowRightLeft className="h-4 w-4" />
              {impersonating ? "Impersonating..." : "Impersonate Organization"}
            </button>
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
          {healthHighlights.map((item) => (
            <SummaryTile
              key={item.label}
              label={item.label}
              value={item.value}
              helper={item.helper}
              tone={item.tone}
            />
          ))}
        </div>

        {activeWarnings.length ? (
          <div className="flex flex-wrap gap-2">
            {activeWarnings.map((warning) => (
              <span
                key={warning}
                className="rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-200"
              >
                {warning}
              </span>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
            No immediate admin blockers detected for this organization.
          </div>
        )}
      </header>

      <section className="rounded-2xl border border-white/10 bg-white/5 p-3 sm:p-4">
        <div className="flex flex-wrap gap-2">
          {DETAIL_SECTIONS.map((section) => {
            const Icon = section.icon;
            const isActive = activeSection === section.key;

            return (
              <button
                key={section.key}
                type="button"
                onClick={() => setActiveSection(section.key)}
                className={`inline-flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium transition ${
                  isActive
                    ? "border-cyan-400/30 bg-cyan-500/10 text-cyan-200"
                    : "border-white/10 bg-black/20 text-white/65 hover:border-white/20 hover:bg-white/10 hover:text-white"
                }`}
              >
                <Icon className="h-4 w-4" />
                {section.label}
              </button>
            );
          })}
        </div>
        <p className="mt-4 px-1 text-sm text-white/55">{currentSectionMeta.description}</p>
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <DetailCard
          title="Basic Info"
          description="Core organization identity and ownership details."
          icon={Building2}
          className={activeSection === "overview" ? "" : "hidden"}
        >
              <div className="grid gap-4 sm:grid-cols-2">
                <InfoField label="Name" value={org.name} />
                <InfoField label="Slug" value={org.slug} />
                <InfoField label="Owner" value={ownerSummary} />
                <InfoField label="Created" value={formatDateTime(org.createdAt)} />
              </div>
        </DetailCard>

        <DetailCard
          title="Compliance"
          description="Manage organization approval and verification from one place."
          icon={ShieldCheck}
          className={activeSection === "overview" ? "" : "hidden"}
        >
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-white/45">
                    Status
                  </label>
                  <SelectField
                    value={orgStatus}
                    onChange={setOrgStatus}
                    options={STATUS_OPTIONS}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-white/45">
                    KYC
                  </label>
                  <SelectField
                    value={kycStatus}
                    onChange={setKycStatus}
                    options={KYC_OPTIONS}
                  />
                </div>

                <div className="space-y-2 sm:col-span-2">
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-white/45">
                    Reviewer Note
                  </label>
                  <textarea
                    value={kycNote}
                    onChange={(e) => setKycNote(e.target.value)}
                    placeholder="Add review context for compliance decisions"
                    className="min-h-[128px] w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none transition placeholder:text-white/30 focus:border-cyan-400/40"
                  />
                </div>
              </div>

              <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-white/45">
                  Save status, verification, and reviewer note together.
                </p>
                <button
                  onClick={saveCompliance}
                  disabled={!complianceDirty || complianceSaving}
                  className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-cyan-950/40 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {complianceSaving ? "Saving..." : "Save Compliance"}
                </button>
              </div>
        </DetailCard>

        <DetailCard
          title="Organization Stats"
          description="A quick snapshot of participation and workspace usage."
          icon={Trophy}
          className={`xl:col-span-2 ${activeSection === "overview" ? "" : "hidden"}`}
        >
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {statItems.map((item) => (
                  <MetricTile
                    key={item.label}
                    label={item.label}
                    value={item.value}
                    description={item.description}
                    icon={item.icon}
                  />
                ))}
              </div>
        </DetailCard>

        <DetailCard
          title="Owner Assignment"
          description="Assign the account responsible for operating this organization."
          icon={UserRound}
          className={`xl:col-span-2 ${activeSection === "ownership" ? "" : "hidden"}`}
        >
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-white/45">
                  Owner
                </label>
                <SelectField
                  value={ownerInput}
                  onChange={setOwnerInput}
                  options={ownerOptions}
                  disabled={usersLoading || ownerUpdating}
                />
              </div>

              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-white/45">
                  {usersLoading
                    ? "Loading available platform users..."
                    : org.ownerEmail
                      ? `Current owner: ${org.ownerName?.trim() || org.ownerEmail}`
                      : "No owner is currently assigned."}
                </p>
                <button
                  onClick={updateOwner}
                  disabled={!ownerDirty || ownerUpdating || usersLoading}
                  className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-cyan-950/40 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {ownerUpdating ? "Saving..." : "Save Owner"}
                </button>
              </div>
            </div>
        </DetailCard>

        <DetailCard
          title="Launcher License"
          description="Create and manage the Arenzyra production licenses used by the observer launcher."
          icon={ShieldCheck}
          className={`xl:col-span-2 ${activeSection === "licenses" ? "" : "hidden"}`}
        >
            <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
              <div className="space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium text-white">Assigned licenses</p>
                    <p className="mt-1 text-sm text-white/45">
                      The launcher allows access only when a license is `ACTIVE` and not expired.
                    </p>
                  </div>
                  <button
                    onClick={startNewLicense}
                    className="inline-flex items-center justify-center rounded-xl border border-white/10 bg-black/20 px-4 py-2 text-sm font-semibold text-white transition hover:border-cyan-400/30 hover:bg-white/10"
                  >
                    New License
                  </button>
                </div>

                {currentValidLicense ? (
                  <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-200">
                    Launcher currently resolves to{" "}
                    <span className="font-semibold text-white">
                      {currentValidLicense.licenseKey}
                    </span>{" "}
                    with {currentValidLicense.maxObservers} observer
                    {currentValidLicense.maxObservers === 1 ? "" : "s"} until{" "}
                    {formatDateTime(currentValidLicense.expiresAt)}.
                  </div>
                ) : (
                  <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-200">
                    No valid launcher license is currently available for this organization.
                  </div>
                )}

                <div className="space-y-3">
                  {licenses.length ? (
                    licenses.map((license) => (
                      <button
                        key={license.id}
                        onClick={() => selectLicense(license)}
                        className={`w-full rounded-xl border p-4 text-left transition ${
                          selectedLicenseId === license.id
                            ? "border-cyan-400/40 bg-cyan-500/10"
                            : "border-white/10 bg-black/20 hover:border-white/20"
                        }`}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-white">
                            {license.licenseKey}
                          </span>
                          <StatusBadge value={license.status} />
                          {license.valid ? (
                            <span className="inline-flex rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-300">
                              Launcher Ready
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-3 grid gap-2 text-xs text-white/55 sm:grid-cols-3">
                          <span>Type: {formatEnumLabel(license.type)}</span>
                          <span>Observers: {license.maxObservers}</span>
                          <span>Expires: {formatDateTime(license.expiresAt)}</span>
                        </div>
                      </button>
                    ))
                  ) : (
                    <div className="rounded-xl border border-dashed border-white/10 bg-black/20 px-4 py-5 text-sm text-white/45">
                      No licenses have been created for this organization yet.
                    </div>
                  )}
                </div>
              </div>

            <div className="space-y-4 rounded-2xl border border-white/10 bg-black/20 p-5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-white">
                    {selectedLicense ? "Edit License" : "Create License"}
                  </h3>
                  <p className="mt-1 text-sm text-white/45">
                    Use a unique license key per organization and set the observer limit for launcher sessions.
                  </p>
                </div>
                {selectedLicense ? (
                  <StatusBadge value={selectedLicense.status} />
                ) : null}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-white/45">
                    License Key
                  </label>
                  <input
                    value={licenseForm.licenseKey}
                    onChange={(e) =>
                      setLicenseForm((current) => ({
                        ...current,
                        licenseKey: e.target.value,
                      }))
                    }
                    placeholder="GLOBAL-CONTROL-STANDARD-2026"
                    className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none transition placeholder:text-white/30 focus:border-cyan-400/40"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-white/45">
                    Type
                  </label>
                  <SelectField
                    value={licenseForm.type}
                    onChange={(value) =>
                      setLicenseForm((current) => ({ ...current, type: value }))
                    }
                    options={LICENSE_TYPE_OPTIONS}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-white/45">
                    Status
                  </label>
                  <SelectField
                    value={licenseForm.status}
                    onChange={(value) =>
                      setLicenseForm((current) => ({ ...current, status: value }))
                    }
                    options={LICENSE_STATUS_OPTIONS}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-white/45">
                    Max Observers
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={licenseForm.maxObservers}
                    onChange={(e) =>
                      setLicenseForm((current) => ({
                        ...current,
                        maxObservers: e.target.value,
                      }))
                    }
                    className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400/40"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-white/45">
                    Expires At
                  </label>
                  <input
                    type="datetime-local"
                    value={licenseForm.expiresAt}
                    onChange={(e) =>
                      setLicenseForm((current) => ({
                        ...current,
                        expiresAt: e.target.value,
                      }))
                    }
                    className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400/40"
                  />
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/55">
                Launcher access is granted only when the license status is{" "}
                <span className="font-semibold text-white">Active</span> and the expiry is in the future.
              </div>

              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-white/45">
                  {selectedLicense
                    ? `Editing license ${selectedLicense.licenseKey}.`
                    : "Create a new launcher license for this organization."}
                </p>
                <button
                  onClick={saveLicense}
                  disabled={licenseSaving || !canSaveLicense || !licenseDirty}
                  className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-cyan-950/40 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {licenseSaving
                    ? "Saving..."
                    : selectedLicense
                      ? "Save License"
                      : "Create License"}
                </button>
              </div>
            </div>
          </div>
        </DetailCard>

        <DetailCard
          title="Branding"
          description="Configure the colors used across overlays, widgets, and organization presentation."
          icon={Palette}
          className={`xl:col-span-2 ${activeSection === "branding" ? "" : "hidden"}`}
        >
          <div className="grid gap-4 lg:grid-cols-[1fr_1fr_1.2fr]">
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-[0.2em] text-white/45">
                Primary Color
              </label>
              <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3">
                <div className="flex items-center gap-3">
                  <span
                    className="h-5 w-5 rounded-full border border-white/15"
                    style={{ backgroundColor: primaryColor || "#0ea5e9" }}
                  />
                  <input
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    placeholder="#00bcd4"
                    className="w-full bg-transparent text-sm text-white outline-none placeholder:text-white/30"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-[0.2em] text-white/45">
                Widget Background
              </label>
              <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3">
                <div className="flex items-center gap-3">
                  <span
                    className="h-5 w-5 rounded-full border border-white/15"
                    style={{ backgroundColor: widgetBackground || "#0b0f14" }}
                  />
                  <input
                    value={widgetBackground}
                    onChange={(e) => setWidgetBackground(e.target.value)}
                    placeholder="#0b0f14"
                    className="w-full bg-transparent text-sm text-white outline-none placeholder:text-white/30"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-[0.2em] text-white/45">
                Organization Logo
              </label>
              <label className="flex min-h-[112px] cursor-pointer flex-col justify-between rounded-xl border border-dashed border-white/15 bg-black/20 p-4 transition hover:border-white/25">
                <div className="flex items-start gap-3">
                  <div className="rounded-xl border border-white/10 bg-white/5 p-2.5">
                    <ImagePlus className="h-5 w-5 text-cyan-300" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">
                      {logoFileName || "Upload optional logo"}
                    </p>
                    <p className="mt-1 text-xs text-white/45">
                      PNG or SVG. File selection is available now and upload can
                      be connected once organization media storage is enabled.
                    </p>
                  </div>
                </div>
                <span className="mt-4 text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">
                  Choose File
                </span>
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(e) => setLogoFileName(e.target.files?.[0]?.name ?? "")}
                />
              </label>
            </div>
          </div>

          {(branding?.primaryColor || branding?.widgetBackground) && (
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <ColorPreview
                label="Current Primary"
                value={branding?.primaryColor ?? "Not set"}
              />
              <ColorPreview
                label="Current Widget Background"
                value={branding?.widgetBackground ?? "Not set"}
              />
            </div>
          )}

          <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-white/45">
              Save color changes here. Logo selection is optional and does not
              alter the current branding payload yet.
            </p>
            <button
              onClick={saveBranding}
              disabled={!brandingDirty || brandingSaving}
              className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-cyan-950/40 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {brandingSaving ? "Saving..." : "Save Branding"}
            </button>
          </div>
        </DetailCard>

        <DetailCard
          title="Widget Access"
          description="Approve or block individual widgets for this organization. Enforcement controls whether widgets need explicit approval before organizers can use them."
          icon={LayoutTemplate}
          className={`xl:col-span-2 ${activeSection === "widgets" ? "" : "hidden"}`}
        >
          <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
            <div className="space-y-4 rounded-2xl border border-white/10 bg-black/20 p-5">
              <div>
                <p className="text-sm font-medium text-white">Approval mode</p>
                <p className="mt-1 text-sm text-white/45">
                  Switch between default-open widget access and strict explicit approval for every route.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  onClick={() => saveWidgetApprovalConfig(false)}
                  disabled={widgetApprovalConfigSaving}
                  className={`rounded-xl border px-4 py-4 text-left transition ${
                    !widgetApprovalEnforced
                      ? "border-cyan-400/40 bg-cyan-500/10"
                      : "border-white/10 bg-white/5 hover:border-white/20"
                  } disabled:cursor-not-allowed disabled:opacity-60`}
                >
                  <p className="text-sm font-semibold text-white">Open By Default</p>
                  <p className="mt-1 text-sm text-white/45">
                    Unconfigured widgets stay available unless explicitly blocked.
                  </p>
                </button>

                <button
                  onClick={() => saveWidgetApprovalConfig(true)}
                  disabled={widgetApprovalConfigSaving}
                  className={`rounded-xl border px-4 py-4 text-left transition ${
                    widgetApprovalEnforced
                      ? "border-amber-400/40 bg-amber-500/10"
                      : "border-white/10 bg-white/5 hover:border-white/20"
                  } disabled:cursor-not-allowed disabled:opacity-60`}
                >
                  <p className="text-sm font-semibold text-white">Require Approval</p>
                  <p className="mt-1 text-sm text-white/45">
                    Every widget must be explicitly approved before organizers and OBS routes can use it.
                  </p>
                </button>
              </div>

              <div
                className={`rounded-xl border p-4 text-sm ${
                  widgetApprovalEnforced
                    ? "border-amber-500/20 bg-amber-500/10 text-amber-200"
                    : "border-cyan-500/20 bg-cyan-500/10 text-cyan-100"
                }`}
              >
                {widgetApprovalEnforced
                  ? "Strict mode is active. Any widget without an approval row is denied."
                  : "Default-open mode is active. Explicit approvals and blocks still apply, but new widgets remain available until you lock them down."}
              </div>
            </div>

            <div className="space-y-5">
              {(["live", "legacy"] as const).map((family) => (
                <div
                  key={family}
                  className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-5"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-white">
                        {family === "live" ? "Live Widgets" : "Legacy Organizer Widgets"}
                      </p>
                      <p className="mt-1 text-sm text-white/45">
                        {family === "live"
                          ? "Public live overlay routes used in OBS and browser sources."
                          : "Organizer-side widget routes and legacy production screens."}
                      </p>
                    </div>
                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/55">
                      {widgetApprovalGroups[family].length} widgets
                    </span>
                  </div>

                  <div className="space-y-3">
                    {widgetApprovalGroups[family].map((item) => {
                      const approval = widgetApprovalMap.get(item.key) ?? null;
                      const state = getWidgetApprovalState(item.key);
                      const saving = widgetApprovalSavingKey === item.key;
                      const badgeClassName =
                        state.tone === "approved"
                          ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
                          : state.tone === "blocked"
                            ? "border-rose-500/20 bg-rose-500/10 text-rose-300"
                            : state.tone === "pending"
                              ? "border-amber-500/20 bg-amber-500/10 text-amber-300"
                              : "border-cyan-500/20 bg-cyan-500/10 text-cyan-100";

                      return (
                        <div
                          key={item.key}
                          className="rounded-xl border border-white/10 bg-white/5 p-4"
                        >
                          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                            <div className="space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-sm font-semibold text-white">{item.title}</p>
                                <span
                                  className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] ${badgeClassName}`}
                                >
                                  {state.label}
                                </span>
                              </div>
                              <p className="text-sm text-white/50">{item.description}</p>
                              <div className="text-xs uppercase tracking-[0.18em] text-white/35">
                                {item.key}
                              </div>
                              <div className="text-sm text-white/45">
                                {state.helper}
                                {approval?.approvedByName || approval?.approvedByEmail
                                  ? ` Approved by ${approval.approvedByName ?? approval.approvedByEmail}.`
                                  : ""}
                              </div>
                            </div>

                            <div className="flex flex-col gap-2 sm:flex-row">
                              <button
                                onClick={() => saveWidgetApproval(item.key, true)}
                                disabled={saving}
                                className="inline-flex items-center justify-center rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-2.5 text-sm font-semibold text-emerald-200 transition hover:border-emerald-500/30 hover:bg-emerald-500/15 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {saving && approval?.isApproved !== true ? "Saving..." : "Approve"}
                              </button>
                              <button
                                onClick={() => saveWidgetApproval(item.key, false)}
                                disabled={saving}
                                className="inline-flex items-center justify-center rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-2.5 text-sm font-semibold text-rose-200 transition hover:border-rose-500/30 hover:bg-rose-500/15 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {saving && approval?.isApproved === true ? "Saving..." : "Block"}
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </DetailCard>

        <DetailCard
          title="Danger Zone"
          description="Use high-impact actions carefully. These changes affect production access immediately."
          icon={Ban}
          className={`xl:col-span-2 ${activeSection === "danger" ? "" : "hidden"}`}
        >
            <div className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
              <div className="space-y-4 rounded-2xl border border-rose-500/20 bg-rose-500/10 p-5">
                <div>
                  <p className="text-lg font-semibold text-white">Suspend organization access</p>
                  <p className="mt-2 text-sm leading-6 text-rose-100/90">
                    Suspension prevents the organization from operating normally and should be
                    used only for compliance, abuse, or billing issues that require immediate
                    intervention.
                  </p>
                </div>

                <div className="space-y-3 text-sm text-rose-100/85">
                  <div className="rounded-xl border border-rose-500/20 bg-black/20 px-4 py-3">
                    Organizers will lose access to normal production workflows once the status is
                    suspended.
                  </div>
                  <div className="rounded-xl border border-rose-500/20 bg-black/20 px-4 py-3">
                    To restore access later, return to{" "}
                    <span className="font-semibold text-white">Overview</span> and set the
                    organization status back to Approved or Pending.
                  </div>
                </div>
              </div>

              <div className="flex flex-col justify-between gap-4 rounded-2xl border border-white/10 bg-black/20 p-5">
                <div className="space-y-3">
                  <p className="text-sm font-semibold uppercase tracking-[0.2em] text-white/45">
                    Current state
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge value={org.status} />
                    <StatusBadge value={org.kycStatus} type="kyc" />
                  </div>
                  <p className="text-sm text-white/55">
                    {org.status === "SUSPENDED"
                      ? "This organization is already suspended."
                      : "Suspension is not reversible from this panel. Recovery should happen through the normal compliance workflow."}
                  </p>
                </div>

                <button
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-rose-500/20 bg-rose-500/10 px-5 py-3 text-sm font-semibold text-rose-200 transition hover:border-rose-500/30 hover:bg-rose-500/15 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={suspendOrganization}
                  disabled={suspending || org.status === "SUSPENDED"}
                >
                  <Ban className="h-4 w-4" />
                  {org.status === "SUSPENDED"
                    ? "Organization Suspended"
                    : suspending
                      ? "Suspending..."
                      : "Suspend Organization"}
                </button>
              </div>
            </div>

            <div className="mt-5 grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
              <div className="space-y-4 rounded-2xl border border-rose-500/20 bg-rose-500/10 p-5">
                <div>
                  <p className="text-lg font-semibold text-white">Delete organization</p>
                  <p className="mt-2 text-sm leading-6 text-rose-100/90">
                    Deletion removes this organization from active admin listings, marks it as
                    deleted, and suspends access immediately.
                  </p>
                </div>

                <div className="space-y-3 text-sm text-rose-100/85">
                  <div className="rounded-xl border border-rose-500/20 bg-black/20 px-4 py-3">
                    This is a soft delete. The organization record remains for auditability.
                  </div>
                  <div className="rounded-xl border border-rose-500/20 bg-black/20 px-4 py-3">
                    Use this only when the organization should be removed from normal operations
                    and the active organizations workspace.
                  </div>
                </div>
              </div>

              <div className="flex flex-col justify-between gap-4 rounded-2xl border border-white/10 bg-black/20 p-5">
                <div className="space-y-3">
                  <p className="text-sm font-semibold uppercase tracking-[0.2em] text-white/45">
                    Delete outcome
                  </p>
                  <div className="space-y-2 text-sm text-white/55">
                    <p>The organization disappears from the active organizations list.</p>
                    <p>Access is suspended immediately as part of the delete flow.</p>
                  </div>
                </div>

                <button
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-rose-500/20 bg-rose-500/10 px-5 py-3 text-sm font-semibold text-rose-200 transition hover:border-rose-500/30 hover:bg-rose-500/15 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() => setDeleteConfirmOpen(true)}
                  disabled={deletingOrganization}
                >
                  <Trash2 className="h-4 w-4" />
                  {deletingOrganization ? "Deleting..." : "Delete Organization"}
                </button>
              </div>
            </div>
        </DetailCard>
      </div>

      <ConfirmDeleteModal
        open={deleteConfirmOpen}
        title="Delete organization?"
        description={`This will soft-delete ${org.name}, suspend its access, and remove it from the active organizations list.`}
        loading={deletingOrganization}
        onClose={() => {
          if (!deletingOrganization) {
            setDeleteConfirmOpen(false);
          }
        }}
        onConfirm={deleteOrganization}
        confirmLabel="Delete Organization"
        loadingLabel="Deleting..."
      />
    </div>
  );
}

function DetailCard({
  title,
  description,
  icon: Icon,
  children,
  className = "",
}: {
  title: string;
  description: string;
  icon: typeof Building2;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-white/10 bg-white/5 p-6 ${className}`}>
      <div className="mb-5 flex items-start gap-4">
        <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
          <Icon className="h-5 w-5 text-cyan-300" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <p className="mt-1 text-sm text-white/55">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function InfoField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/40">
        {label}
      </p>
      <div className="mt-3 text-sm font-medium text-white">{value}</div>
    </div>
  );
}

function SummaryTile({
  label,
  value,
  helper,
  tone = "default",
}: {
  label: string;
  value: string;
  helper: string;
  tone?: "default" | "warning" | "success";
}) {
  const toneClassName =
    tone === "success"
      ? "border-emerald-500/20 bg-emerald-500/10"
      : tone === "warning"
        ? "border-amber-500/20 bg-amber-500/10"
        : "border-white/10 bg-black/20";

  return (
    <div className={`rounded-xl border p-4 ${toneClassName}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/40">
        {label}
      </p>
      <p className="mt-3 text-sm font-semibold text-white">{value}</p>
      <p className="mt-2 text-sm text-white/55">{helper}</p>
    </div>
  );
}

function MetricTile({
  label,
  value,
  description,
  icon: Icon,
}: {
  label: string;
  value: number | null;
  description: string;
  icon: typeof Building2;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/40">
            {label}
          </p>
          <p className="mt-3 text-3xl font-bold text-white">
            {value === null ? "â€”" : value}
          </p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-2.5">
          <Icon className="h-4 w-4 text-cyan-300" />
        </div>
      </div>
      <p className="mt-3 text-sm text-white/50">{description}</p>
    </div>
  );
}

function SelectField({
  value,
  onChange,
  options,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string; disabled?: boolean }>;
  disabled?: boolean;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full appearance-none rounded-xl border border-white/10 bg-black/20 px-4 py-3 pr-10 text-sm text-white outline-none transition focus:border-cyan-400/40 disabled:opacity-60"
      >
        {options.map((option) => (
          <option
            key={`${option.value}-${option.label}`}
            value={option.value}
            disabled={option.disabled}
          >
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
    </div>
  );
}

function StatusBadge({
  value,
  type = "status",
}: {
  value: string;
  type?: "status" | "kyc";
}) {
  const normalized = value.toUpperCase();
  const className =
    normalized === "APPROVED" || normalized === "ACTIVE"
      ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
      : normalized === "PENDING"
        ? "border-amber-500/20 bg-amber-500/10 text-amber-300"
        : normalized === "REJECTED" ||
            normalized === "SUSPENDED" ||
            normalized === "EXPIRED"
          ? "border-rose-500/20 bg-rose-500/10 text-rose-300"
          : "border-white/10 bg-white/5 text-white/70";

  return (
    <span
      className={`inline-flex rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] ${className}`}
    >
      {type === "kyc" && normalized === "APPROVED"
        ? "Verified"
        : formatEnumLabel(normalized)}
    </span>
  );
}

function ColorPreview({ label, value }: { label: string; value: string }) {
  const swatch =
    value && value !== "Not set"
      ? value
      : "linear-gradient(135deg, rgba(255,255,255,0.12), rgba(255,255,255,0.04))";
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/40">
        {label}
      </p>
      <div className="mt-3 flex items-center gap-3">
        <span
          className="h-5 w-5 rounded-full border border-white/15"
          style={{
            background: swatch,
          }}
        />
        <span className="text-sm font-medium text-white">{value}</span>
      </div>
    </div>
  );
}

function extractArray<T>(json: unknown): T[] {
  if (Array.isArray(json)) return json as T[];
  if (!json || typeof json !== "object") return [];

  const record = json as Record<string, unknown>;
  for (const key of ["data", "users", "organizations", "items"]) {
    if (Array.isArray(record[key])) {
      return record[key] as T[];
    }
  }

  return [];
}

function getUserLabel(user: OrganizationUser) {
  const name = user.name?.trim();
  const email = user.email?.trim();
  if (name && email) return `${name} (${email})`;
  if (email) return email;
  if (name) return name;
  return user.id;
}

function formatDate(value?: string | null) {
  if (!value) return "N/A";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatDateTime(value?: string | null) {
  if (!value) return "N/A";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function isoToDateTimeLocal(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

function dateTimeLocalToIso(value: string) {
  if (!value.trim()) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

function toLicenseForm(license: OrganizationLicense): LicenseFormState {
  return {
    licenseKey: license.licenseKey,
    type: license.type,
    status: license.status,
    maxObservers: String(license.maxObservers),
    expiresAt: isoToDateTimeLocal(license.expiresAt),
  };
}

function sortLicenses(left: OrganizationLicense, right: OrganizationLicense) {
  return (
    new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
  );
}

function formatEnumLabel(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function normalizeDetailSection(value: string | null): DetailSection {
  return DETAIL_SECTIONS.some((section) => section.key === value)
    ? (value as DetailSection)
    : DEFAULT_DETAIL_SECTION;
}

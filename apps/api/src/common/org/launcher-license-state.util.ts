import { OrganizationSubscriptionStatus, type Prisma } from '@prisma/client';
import type { PrismaService } from '../../db/prisma.service';
import { normalizeOrganizationPlanId } from './organization-plan.util';

export const LAUNCHER_PLAN_ID = 'pubg-auto-launcher';

type LauncherLicensePrisma = Prisma.TransactionClient | PrismaService;

type LauncherOrganizationState = {
  planId?: string | null;
  subscriptionStatus?: OrganizationSubscriptionStatus | null;
  trialEndsAt?: Date | null;
  paidUntil?: Date | null;
};

export type LauncherLicenseSyncResult = {
  organizationFound: boolean;
  hasLauncherPlan: boolean;
  hasActiveSubscription: boolean;
  hasLauncherAccess: boolean;
};

export function organizationHasLauncherPlan(
  organization: Pick<LauncherOrganizationState, 'planId'>,
) {
  return normalizeOrganizationPlanId(organization.planId) === LAUNCHER_PLAN_ID;
}

export function organizationHasActiveSubscription(
  organization: Omit<LauncherOrganizationState, 'planId'>,
  now = new Date(),
) {
  const nowMs = now.getTime();
  const paidUntilMs = organization.paidUntil?.getTime() ?? 0;
  const trialEndsAtMs = organization.trialEndsAt?.getTime() ?? 0;

  if (
    organization.subscriptionStatus === OrganizationSubscriptionStatus.ACTIVE
  ) {
    return true;
  }

  return (
    organization.subscriptionStatus ===
      OrganizationSubscriptionStatus.TRIALING &&
    (trialEndsAtMs > nowMs || paidUntilMs > nowMs)
  );
}

export async function syncLauncherLicenseState(
  prisma: LauncherLicensePrisma,
  organizationId: string,
  now = new Date(),
): Promise<LauncherLicenseSyncResult> {
  const organization = await prisma.organization.findFirst({
    where: { id: organizationId, deletedAt: null },
    select: {
      id: true,
      planId: true,
      subscriptionStatus: true,
      trialEndsAt: true,
      paidUntil: true,
    },
  });

  if (!organization) {
    return {
      organizationFound: false,
      hasLauncherPlan: false,
      hasActiveSubscription: false,
      hasLauncherAccess: false,
    };
  }

  const hasLauncherPlan = organizationHasLauncherPlan(organization);
  const hasActiveSubscription = organizationHasActiveSubscription(
    organization,
    now,
  );
  const hasLauncherAccess = hasLauncherPlan && hasActiveSubscription;

  return {
    organizationFound: true,
    hasLauncherPlan,
    hasActiveSubscription,
    hasLauncherAccess,
  };
}

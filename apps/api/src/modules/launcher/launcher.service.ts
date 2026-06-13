import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { LicenseStatus, Prisma, Role, type License } from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth.types';
import { syncLauncherLicenseState } from '../../common/org/launcher-license-state.util';
import { effectiveOrganizationId } from '../../common/org/org.util';
import { PrismaService } from '../../db/prisma.service';

const STALE_SESSION_WINDOW_MS = 2 * 60 * 1000;
const MAX_SESSION_START_RETRIES = 4;
const DEFAULT_MAX_OBSERVERS = 1;

export type LauncherLicenseReason =
  | 'LICENSE_EXPIRED'
  | 'LICENSE_MISSING'
  | 'LICENSE_REVOKED'
  | 'LICENSE_SUSPENDED'
  | 'LAUNCHER_PLAN_REQUIRED'
  | 'SUBSCRIPTION_EXPIRED';

type LicenseView = {
  id: string;
  type: string;
  status: string;
  expiresAt: string;
  maxObservers: number;
};

type LicenseResolution = {
  valid: boolean;
  reason: LauncherLicenseReason | null;
  license: LicenseView | null;
  record: License | null;
  maxObservers: number;
};

@Injectable()
export class LauncherService {
  private readonly logger = new Logger(LauncherService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getLicense(actor: AuthUser) {
    const organizationId = this.requireOrganization(actor);
    const resolution = await this.resolveLicense(organizationId);

    if (resolution.valid) {
      return {
        valid: true,
        license: resolution.license,
        maxObservers: resolution.maxObservers,
      };
    }

    return {
      valid: false,
      reason: resolution.reason,
      license: resolution.license,
      maxObservers: resolution.maxObservers,
    };
  }

  async startSession(actor: AuthUser, machineId: string) {
    const organizationId = this.requireOrganization(actor);
    const resolution = await this.resolveLicense(organizationId);

    if (!resolution.valid) {
      throw new ForbiddenException({
        error: resolution.reason ?? 'LICENSE_MISSING',
        license: resolution.license,
        maxObservers: resolution.maxObservers,
      });
    }

    const licenseView = resolution.license;
    const maxObservers = resolution.maxObservers;
    const normalizedMachineId = machineId.trim();

    for (let attempt = 1; attempt <= MAX_SESSION_START_RETRIES; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const now = new Date();
            const staleBefore = new Date(
              now.getTime() - STALE_SESSION_WINDOW_MS,
            );

            await tx.observerLauncherSession.updateMany({
              where: {
                organizationId,
                endedAt: null,
                lastSeenAt: { lt: staleBefore },
              },
              data: {
                endedAt: now,
                lastSeenAt: now,
              },
            });

            await tx.observerLauncherSession.upsert({
              where: {
                organizationId_machineId: {
                  organizationId,
                  machineId: normalizedMachineId,
                },
              },
              update: {
                userId: actor.id,
                licenseId: resolution.record?.id ?? null,
                endedAt: null,
                lastSeenAt: now,
              },
              create: {
                organizationId,
                userId: actor.id,
                machineId: normalizedMachineId,
                licenseId: resolution.record?.id ?? null,
                startedAt: now,
                lastSeenAt: now,
              },
            });

            const activeSessions = await tx.observerLauncherSession.count({
              where: {
                organizationId,
                endedAt: null,
              },
            });

            if (activeSessions > maxObservers) {
              await tx.observerLauncherSession.update({
                where: {
                  organizationId_machineId: {
                    organizationId,
                    machineId: normalizedMachineId,
                  },
                },
                data: {
                  endedAt: now,
                  lastSeenAt: now,
                },
              });

              throw new ConflictException({
                error: 'OBSERVER_LIMIT_REACHED',
                activeSessions,
                maxObservers,
                machineId: normalizedMachineId,
                license: licenseView,
              });
            }

            return {
              ok: true,
              machineId: normalizedMachineId,
              activeSessions,
              maxObservers,
              license: licenseView,
            };
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          },
        );
      } catch (error) {
        if (
          !this.isRetryableWriteConflict(error) ||
          attempt === MAX_SESSION_START_RETRIES
        ) {
          if (this.isRetryableWriteConflict(error)) {
            this.logger.warn(
              `launcher session start failed after ${attempt} attempts for org=${organizationId} machine=${normalizedMachineId}`,
            );
            throw new ServiceUnavailableException(
              'Launcher session is busy. Please retry.',
            );
          }
          throw error;
        }

        this.logger.warn(
          `retrying launcher session start after write conflict attempt=${attempt} org=${organizationId} machine=${normalizedMachineId}`,
        );
        await this.delay(attempt * 75);
      }
    }

    throw new ServiceUnavailableException(
      'Launcher session is busy. Please retry.',
    );
  }

  async endSession(actor: AuthUser, machineId: string) {
    const organizationId = this.requireOrganization(actor);
    const now = new Date();

    await this.prisma.observerLauncherSession.updateMany({
      where: {
        organizationId,
        machineId: machineId.trim(),
        endedAt: null,
      },
      data: {
        endedAt: now,
        lastSeenAt: now,
      },
    });

    return {
      ok: true,
      machineId: machineId.trim(),
    };
  }

  private requireOrganization(actor: AuthUser) {
    const role = actor?.actorRole ?? actor?.role ?? null;
    if (
      role !== Role.SUPER_ADMIN &&
      role !== Role.ADMIN &&
      role !== Role.ORGANIZER
    ) {
      throw new ForbiddenException('Organizer access required');
    }

    const organizationId = effectiveOrganizationId(actor);
    if (!organizationId) {
      throw new ForbiddenException('Organization context missing');
    }

    return organizationId;
  }

  private async resolveLicense(
    organizationId: string,
  ): Promise<LicenseResolution> {
    const syncState = await syncLauncherLicenseState(
      this.prisma,
      organizationId,
    );
    const licenses = await this.prisma.license.findMany({
      where: { organizationId },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    });

    if (!syncState.organizationFound || !syncState.hasLauncherPlan) {
      return {
        valid: false,
        reason: 'LAUNCHER_PLAN_REQUIRED',
        license: this.toFallbackLicenseView(licenses),
        record: null,
        maxObservers: this.resolveMaxObservers(licenses),
      };
    }

    if (!syncState.hasActiveSubscription) {
      return {
        valid: false,
        reason: 'SUBSCRIPTION_EXPIRED',
        license: this.toFallbackLicenseView(licenses),
        record: null,
        maxObservers: this.resolveMaxObservers(licenses),
      };
    }

    const controlLicense = licenses[0] ?? null;
    if (controlLicense?.status === LicenseStatus.REVOKED) {
      return {
        valid: false,
        reason: 'LICENSE_REVOKED',
        license: this.toLicenseView(controlLicense),
        record: controlLicense,
        maxObservers: controlLicense.maxObservers,
      };
    }

    if (controlLicense?.status === LicenseStatus.SUSPENDED) {
      return {
        valid: false,
        reason: 'LICENSE_SUSPENDED',
        license: this.toLicenseView(controlLicense),
        record: controlLicense,
        maxObservers: controlLicense.maxObservers,
      };
    }

    const configLicense = this.resolveConfigLicense(licenses);
    if (configLicense) {
      return {
        valid: true,
        reason: null,
        license: this.toLicenseView(configLicense),
        record: configLicense,
        maxObservers: configLicense.maxObservers,
      };
    }

    return {
      valid: true,
      reason: null,
      license: null,
      record: null,
      maxObservers: DEFAULT_MAX_OBSERVERS,
    };
  }

  private toLicenseView(license: License): LicenseView {
    return {
      id: license.id,
      type: license.type,
      status: license.status,
      expiresAt: license.expiresAt.toISOString(),
      maxObservers: license.maxObservers,
    };
  }

  private toFallbackLicenseView(licenses: License[]) {
    const license =
      licenses.find((item) => item.status === LicenseStatus.EXPIRED) ??
      licenses.find((item) => item.status === LicenseStatus.REVOKED) ??
      licenses.find((item) => item.status === LicenseStatus.SUSPENDED) ??
      licenses[0] ??
      null;

    return license ? this.toLicenseView(license) : null;
  }

  private resolveConfigLicense(licenses: License[]) {
    return (
      licenses.find((item) => item.status === LicenseStatus.ACTIVE) ??
      licenses.find((item) => item.status === LicenseStatus.EXPIRED) ??
      null
    );
  }

  private resolveMaxObservers(licenses: License[]) {
    return (
      this.resolveConfigLicense(licenses)?.maxObservers ??
      licenses[0]?.maxObservers ??
      DEFAULT_MAX_OBSERVERS
    );
  }

  private isRetryableWriteConflict(error: unknown) {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2034'
    );
  }

  private delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

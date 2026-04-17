import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { LicenseStatus, Prisma, Role, type License } from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth.types';
import { effectiveOrganizationId } from '../../common/org/org.util';
import { PrismaService } from '../../db/prisma.service';

const STALE_SESSION_WINDOW_MS = 2 * 60 * 1000;
const MAX_SESSION_START_RETRIES = 4;

export type LauncherLicenseReason =
  | 'LICENSE_EXPIRED'
  | 'LICENSE_MISSING'
  | 'LICENSE_SUSPENDED';

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
      };
    }

    return {
      valid: false,
      reason: resolution.reason,
      license: resolution.license,
    };
  }

  async startSession(actor: AuthUser, machineId: string) {
    const organizationId = this.requireOrganization(actor);
    const resolution = await this.resolveLicense(organizationId);

    if (!resolution.valid || !resolution.record || !resolution.license) {
      throw new ForbiddenException({
        error: resolution.reason ?? 'LICENSE_MISSING',
        license: resolution.license,
      });
    }

    const activeLicense = resolution.record;
    const licenseView = resolution.license;
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
                licenseId: activeLicense.id,
                endedAt: null,
                lastSeenAt: now,
              },
              create: {
                organizationId,
                userId: actor.id,
                machineId: normalizedMachineId,
                licenseId: activeLicense.id,
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

            if (activeSessions > activeLicense.maxObservers) {
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
                maxObservers: activeLicense.maxObservers,
                machineId: normalizedMachineId,
                license: licenseView,
              });
            }

            return {
              ok: true,
              machineId: normalizedMachineId,
              activeSessions,
              maxObservers: activeLicense.maxObservers,
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
    const licenses = await this.prisma.license.findMany({
      where: { organizationId },
      orderBy: [{ expiresAt: 'desc' }, { createdAt: 'desc' }],
    });
    const now = new Date();

    const active = licenses.find(
      (license) =>
        license.status === LicenseStatus.ACTIVE &&
        license.expiresAt.getTime() > now.getTime(),
    );
    if (active) {
      return {
        valid: true,
        reason: null,
        license: this.toLicenseView(active),
        record: active,
      };
    }

    const suspended = licenses.find(
      (license) => license.status === LicenseStatus.SUSPENDED,
    );
    if (suspended) {
      return {
        valid: false,
        reason: 'LICENSE_SUSPENDED',
        license: this.toLicenseView(suspended),
        record: suspended,
      };
    }

    const expired = licenses.find(
      (license) =>
        license.status === LicenseStatus.EXPIRED ||
        (license.status === LicenseStatus.ACTIVE &&
          license.expiresAt.getTime() <= now.getTime()),
    );
    if (expired) {
      return {
        valid: false,
        reason: 'LICENSE_EXPIRED',
        license: this.toLicenseView(expired),
        record: expired,
      };
    }

    return {
      valid: false,
      reason: 'LICENSE_MISSING',
      license: null,
      record: null,
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

import { Injectable } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../../db/prisma.service';

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  async log(params: {
    organizationId: string | null;
    userId: string;
    action: AuditAction;
    entityType: string;
    entityId: string;
    before?: unknown;
    after?: unknown;
    source: 'MANUAL' | 'EXCEL' | 'SYSTEM';
    reason?: string | null;
  }): Promise<void> {
    try {
      if (!params.organizationId) return;
      await this.prisma.auditLog.create({
        data: {
          organizationId: params.organizationId,
          userId: params.userId,
          action: params.action,
          entityType: params.entityType,
          entityId: params.entityId,
          before: params.before as Prisma.InputJsonValue,
          after: params.after as Prisma.InputJsonValue,
          source: params.source,
          reason: params.reason ?? null,
        },
      });
    } catch (err: unknown) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2003'
      ) {
        // Missing user FK; skip audit entry rather than failing request
        return;
      }
      throw err;
    }
  }
}

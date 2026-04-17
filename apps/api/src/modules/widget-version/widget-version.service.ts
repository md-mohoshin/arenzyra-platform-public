import {
  Injectable,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma, WidgetVersionStatus } from '@prisma/client';
import { PrismaService } from '../../db/prisma.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';

@Injectable()
export class WidgetVersionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async list(orgId: string, widgetKey: string) {
    return this.prisma.widgetVersion.findMany({
      where: { organizationId: orgId, widgetKey },
      orderBy: [{ status: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async createDraft(params: {
    organizationId: string;
    widgetKey: string;
    version: string;
    configSchema?: Prisma.JsonValue | null;
  }) {
    const exists = await this.prisma.widgetVersion.findFirst({
      where: {
        organizationId: params.organizationId,
        widgetKey: params.widgetKey,
        version: params.version,
      },
    });
    if (exists) {
      throw new BadRequestException('Version already exists');
    }
    return this.prisma.widgetVersion.create({
      data: {
        organizationId: params.organizationId,
        widgetKey: params.widgetKey,
        version: params.version,
        status: WidgetVersionStatus.DRAFT,
        configSchema: params.configSchema ?? Prisma.JsonNull,
      },
    });
  }

  private async demoteStable(orgId: string, widgetKey: string) {
    await this.prisma.widgetVersion.updateMany({
      where: {
        organizationId: orgId,
        widgetKey,
        status: WidgetVersionStatus.STABLE,
      },
      data: { status: WidgetVersionStatus.DEPRECATED },
    });
  }

  async promote(versionId: string) {
    const version = await this.prisma.widgetVersion.findUnique({
      where: { id: versionId },
    });
    if (!version) throw new BadRequestException('Version not found');
    await this.demoteStable(version.organizationId, version.widgetKey);
    const updated = await this.prisma.widgetVersion.update({
      where: { id: version.id },
      data: {
        status: WidgetVersionStatus.STABLE,
        publishedAt: new Date(),
      },
    });
    this.realtime.emitWidgetVersion(version.organizationId, {
      widgetKey: version.widgetKey,
      version: updated.version,
      status: updated.status,
      action: 'promoted',
    });
    return updated;
  }

  async rollback(orgId: string, widgetKey: string) {
    const currentStable = await this.prisma.widgetVersion.findFirst({
      where: {
        organizationId: orgId,
        widgetKey,
        status: WidgetVersionStatus.STABLE,
      },
    });
    const previous = await this.prisma.widgetVersion.findFirst({
      where: {
        organizationId: orgId,
        widgetKey,
        status: WidgetVersionStatus.DEPRECATED,
      },
      orderBy: { publishedAt: 'desc' },
    });
    if (!previous)
      throw new BadRequestException('No previous version to rollback');
    if (currentStable) {
      await this.prisma.widgetVersion.update({
        where: { id: currentStable.id },
        data: { status: WidgetVersionStatus.DEPRECATED },
      });
    }
    const updated = await this.prisma.widgetVersion.update({
      where: { id: previous.id },
      data: { status: WidgetVersionStatus.STABLE },
    });
    this.realtime.emitWidgetVersion(orgId, {
      widgetKey,
      version: updated.version,
      status: updated.status,
      action: 'rolledback',
    });
    return updated;
  }

  async resolve(orgId: string, widgetKey: string, version?: string | null) {
    if (version) {
      const explicit = await this.prisma.widgetVersion.findFirst({
        where: { organizationId: orgId, widgetKey, version },
      });
      if (explicit) return explicit;
    }
    const stable = await this.prisma.widgetVersion.findFirst({
      where: {
        organizationId: orgId,
        widgetKey,
        status: WidgetVersionStatus.STABLE,
      },
      orderBy: { publishedAt: 'desc' },
    });
    return stable;
  }

  async updateConfigSchema(params: {
    id: string;
    organizationId?: string | null;
    configSchema?: Prisma.JsonValue | null;
  }) {
    const existing = await this.prisma.widgetVersion.findUnique({
      where: { id: params.id },
    });
    if (!existing) throw new BadRequestException('Version not found');
    if (
      params.organizationId &&
      existing.organizationId !== params.organizationId
    ) {
      throw new ForbiddenException('Cannot edit version for another org');
    }
    const updated = await this.prisma.widgetVersion.update({
      where: { id: params.id },
      data: { configSchema: params.configSchema ?? Prisma.JsonNull },
    });
    this.realtime.emitWidgetVersion(existing.organizationId, {
      widgetKey: existing.widgetKey,
      version: updated.version,
      status: updated.status,
      action: 'schema-updated',
    });
    return updated;
  }
}

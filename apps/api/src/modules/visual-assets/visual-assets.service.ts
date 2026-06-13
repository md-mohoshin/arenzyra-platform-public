import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ObsTemplateKind, Prisma, Role, WidgetKind } from '@prisma/client';
import { PrismaService } from '../../db/prisma.service';
import type { AuthUser } from '../../common/auth/auth.types';
import { effectiveOrganizationId } from '../../common/org/org.util';
import {
  DEFAULT_OBS_TEMPLATES,
  DEFAULT_WIDGETS,
} from './visual-assets.constants';

@Injectable()
export class VisualAssetsService {
  constructor(private readonly prisma: PrismaService) {}

  private isSuper(actor?: AuthUser | null) {
    return (
      actor?.role === Role.SUPER_ADMIN || actor?.actorRole === Role.SUPER_ADMIN
    );
  }

  private resolveOrg(
    actor: AuthUser | null,
    organizationId?: string | null,
    opts: { allowSuperWithoutOrg?: boolean } = {},
  ): string | null {
    const eff =
      organizationId ?? (actor ? effectiveOrganizationId(actor) : null);
    if (eff) return eff;
    if (this.isSuper(actor) && opts.allowSuperWithoutOrg) return null;
    throw new ForbiddenException('organizationId is required');
  }

  private requireOrg(
    actor: AuthUser | null,
    organizationId?: string | null,
  ): string {
    const eff = this.resolveOrg(actor, organizationId, {
      allowSuperWithoutOrg: false,
    });
    if (!eff) {
      throw new ForbiddenException('organizationId is required');
    }
    return eff;
  }

  private ensureOrg(
    recordOrgId: string,
    actor: AuthUser | null,
    orgId?: string | null,
  ) {
    if (!recordOrgId) {
      throw new ForbiddenException('Organization missing on asset');
    }
    if (this.isSuper(actor)) return recordOrgId;
    const eff = orgId ?? (actor ? effectiveOrganizationId(actor) : null);
    if (!eff) throw new ForbiddenException('organizationId is required');
    if (eff !== recordOrgId)
      throw new ForbiddenException('Cross-organization access forbidden');
    return recordOrgId;
  }

  // Keep only supported preset configuration fields; drop styling/branding.
  private sanitizePresetConfig(
    raw?: Prisma.JsonValue | null,
  ): Prisma.InputJsonValue {
    if (!raw || typeof raw !== 'object') return {} as Prisma.InputJsonValue;
    const allowed = new Set([
      'layout',
      'maxTeams',
      'showKills',
      'showAlive',
      'animate',
      'animationSpeed',
      'position',
      'size',
    ]);
    const source = raw as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source)) {
      if (allowed.has(key)) out[key] = source[key];
    }
    return out as Prisma.InputJsonValue;
  }

  async bootstrapDefaults(orgId: string) {
    for (const def of DEFAULT_WIDGETS) {
      await this.prisma.widget.upsert({
        where: { organizationId_key: { organizationId: orgId, key: def.key } },
        update: {
          name: def.name,
          description: def.description ?? null,
          kind: def.kind,
          config: (def.config ?? {}) as Prisma.InputJsonValue,
          deletedAt: null,
        },
        create: {
          organizationId: orgId,
          key: def.key,
          name: def.name,
          description: def.description ?? null,
          kind: def.kind,
          config: (def.config ?? {}) as Prisma.InputJsonValue,
        },
      });
    }

    for (const def of DEFAULT_OBS_TEMPLATES) {
      const template = await this.prisma.oBSTemplate.upsert({
        where: { organizationId_key: { organizationId: orgId, key: def.key } },
        update: {
          name: def.name,
          description: def.description ?? null,
          kind: def.kind,
          config: (def.config ?? {}) as Prisma.InputJsonValue,
          deletedAt: null,
        },
        create: {
          organizationId: orgId,
          key: def.key,
          name: def.name,
          description: def.description ?? null,
          kind: def.kind,
          config: (def.config ?? {}) as Prisma.InputJsonValue,
        },
      });

      if (def.scene) {
        const existingScene = await this.prisma.oBSScene.findFirst({
          where: { templateId: template.id, deletedAt: null },
          select: { id: true },
        });
        if (!existingScene) {
          await this.prisma.oBSScene.create({
            data: {
              templateId: template.id,
              organizationId: orgId,
              name: def.scene.name,
              layout: (def.scene.layout ?? {}) as Prisma.InputJsonValue,
            },
          });
        }
      }
    }
  }

  async listWidgets(actor: AuthUser | null, organizationId?: string | null) {
    const org = this.resolveOrg(actor, organizationId, {
      allowSuperWithoutOrg: true,
    });
    if (!org) return [];
    await this.bootstrapDefaults(org);
    return this.prisma.widget.findMany({
      where: { organizationId: org, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getWidget(
    id: string,
    actor: AuthUser | null,
    organizationId?: string | null,
  ) {
    const widget = await this.prisma.widget.findFirst({
      where: { id, deletedAt: null },
      include: { presets: { where: { deletedAt: null } } },
    });
    if (!widget) throw new NotFoundException('Widget not found');
    this.ensureOrg(widget.organizationId, actor, organizationId);
    return widget;
  }

  async createWidget(params: {
    actor: AuthUser | null;
    organizationId?: string | null;
    data: {
      key: string;
      name: string;
      description?: string | null;
      category?: string | null;
      kind?: WidgetKind;
      config?: Prisma.JsonValue;
    };
  }) {
    const org = this.requireOrg(params.actor, params.organizationId);
    const created = await this.prisma.widget.create({
      data: {
        organizationId: org,
        key: params.data.key,
        name: params.data.name,
        description: params.data.description ?? null,
        category: params.data.category ?? 'utility',
        kind: params.data.kind ?? WidgetKind.CUSTOM,
        config: params.data.config ?? {},
      },
    });
    // Bootstrap default preset for the widget
    await this.prisma.widgetPreset.create({
      data: {
        organizationId: org,
        widgetId: created.id,
        widgetKey: created.key,
        name: 'Default',
        isDefault: true,
        config: this.sanitizePresetConfig({
          layout: 'full',
          animate: true,
          showKills: true,
        }),
      },
    });
    return created;
  }

  async updateWidget(params: {
    id: string;
    actor: AuthUser | null;
    organizationId?: string | null;
    data: Partial<{
      name: string;
      description: string | null;
      category: string | null;
      config: Prisma.JsonValue;
      kind: WidgetKind;
    }>;
  }) {
    const widget = await this.getWidget(
      params.id,
      params.actor,
      params.organizationId,
    );
    return this.prisma.widget.update({
      where: { id: widget.id },
      data: {
        name: params.data.name ?? widget.name,
        description: params.data.description ?? widget.description,
        category: params.data.category ?? widget.category ?? 'utility',
        config: params.data.config ?? widget.config ?? Prisma.JsonNull,
        kind: params.data.kind ?? widget.kind,
      },
    });
  }

  async deleteWidget(
    id: string,
    actor: AuthUser | null,
    organizationId?: string | null,
  ) {
    const widget = await this.getWidget(id, actor, organizationId);
    return this.prisma.widget.update({
      where: { id: widget.id },
      data: { deletedAt: new Date() },
    });
  }

  private async nextWidgetKey(orgId: string, baseKey: string) {
    let candidate = baseKey;
    let counter = 1;

    while (true) {
      const exists = await this.prisma.widget.findFirst({
        where: { organizationId: orgId, key: candidate, deletedAt: null },
        select: { id: true },
      });
      if (!exists) return candidate;
      candidate = `${baseKey}-${counter}`;
      counter += 1;
    }
  }

  async copyWidget(id: string, targetOrgId: string, actor: AuthUser | null) {
    if (!this.isSuper(actor)) {
      throw new ForbiddenException('Only SUPER_ADMIN can copy widgets');
    }
    const targetOrg = await this.prisma.organization.findFirst({
      where: { id: targetOrgId, deletedAt: null },
      select: { id: true },
    });
    if (!targetOrg)
      throw new NotFoundException('Target organization not found');

    const widget = await this.prisma.widget.findFirst({
      where: { id, deletedAt: null },
      include: { presets: { where: { deletedAt: null } } },
    });
    if (!widget) throw new NotFoundException('Widget not found');

    const newKey = await this.nextWidgetKey(targetOrgId, widget.key);

    const created = await this.prisma.widget.create({
      data: {
        organizationId: targetOrgId,
        key: newKey,
        name: `${widget.name} (Copy)`,
        description: widget.description,
        category: widget.category ?? 'utility',
        kind: widget.kind,
        config: widget.config ?? Prisma.JsonNull,
      },
    });

    if (widget.presets?.length) {
      const copyData = widget.presets.map((p) => ({
        organizationId: targetOrgId,
        widgetId: created.id,
        widgetKey: created.key,
        name: p.name,
        description: p.description,
        isDefault: p.isDefault ?? false,
        config: p.config ?? Prisma.JsonNull,
      }));
      await this.prisma.widgetPreset.createMany({ data: copyData });
    }

    return created;
  }

  private async enforceSingleDefault(
    orgId: string,
    widgetKey: string,
    keepPresetId: string,
  ) {
    // First clear defaults for the widget in the org (test expects a minimal where clause).
    await this.prisma.widgetPreset.updateMany({
      where: {
        organizationId: orgId,
        widgetKey,
      },
      data: { isDefault: false },
    });

    // Re-assert the intended default (avoids wiping the newly set default).
    await this.prisma.widgetPreset.updateMany({
      where: { id: keepPresetId },
      data: { isDefault: true },
    });
  }

  async listWidgetPresets(
    widgetKey: string,
    actor: AuthUser | null,
    organizationId?: string | null,
  ) {
    const org = this.requireOrg(actor, organizationId);
    return this.prisma.widgetPreset.findMany({
      where: { organizationId: org, widgetKey, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createWidgetPreset(params: {
    widgetKey: string;
    actor: AuthUser | null;
    organizationId?: string | null;
    data: { name: string; config?: Prisma.JsonValue; isDefault?: boolean };
  }) {
    const org = this.requireOrg(params.actor, params.organizationId);
    const widgetExists = await this.prisma.widget.findFirst({
      where: {
        organizationId: org,
        key: params.widgetKey,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!widgetExists) {
      throw new NotFoundException('Widget not found for organization');
    }
    const preset = await this.prisma.widgetPreset.create({
      data: {
        organizationId: org,
        widgetId: widgetExists.id,
        widgetKey: params.widgetKey,
        name: params.data.name,
        isDefault: params.data.isDefault ?? false,
        config: this.sanitizePresetConfig(params.data.config ?? {}),
      },
    });
    if (preset.isDefault) {
      await this.enforceSingleDefault(org, params.widgetKey, preset.id);
    }
    return preset;
  }

  async updateWidgetPreset(params: {
    id: string;
    actor: AuthUser | null;
    organizationId?: string | null;
    data: Partial<{
      name: string;
      config: Prisma.JsonValue;
      isDefault: boolean;
    }>;
  }) {
    const preset = await this.prisma.widgetPreset.findFirst({
      where: { id: params.id, deletedAt: null },
    });
    if (!preset) throw new NotFoundException('Preset not found');
    const org = this.ensureOrg(
      preset.organizationId,
      params.actor,
      params.organizationId,
    );
    const updated = await this.prisma.widgetPreset.update({
      where: { id: preset.id },
      data: {
        name: params.data.name ?? preset.name,
        isDefault: params.data.isDefault ?? preset.isDefault,
        config: this.sanitizePresetConfig(
          (params.data.config ??
            preset.config ??
            Prisma.JsonNull) as Prisma.JsonValue,
        ),
      },
    });
    if (updated.isDefault) {
      await this.enforceSingleDefault(org, updated.widgetKey, updated.id);
    }
    return updated;
  }

  async deleteWidgetPreset(
    id: string,
    actor: AuthUser | null,
    organizationId?: string | null,
  ) {
    const preset = await this.prisma.widgetPreset.findFirst({
      where: { id, deletedAt: null },
    });
    if (!preset) throw new NotFoundException('Preset not found');
    const org = this.ensureOrg(preset.organizationId, actor, organizationId);
    await this.prisma.widgetPreset.update({
      where: { id: preset.id },
      data: { deletedAt: new Date(), isDefault: false },
    });
    if (preset.isDefault) {
      const fallback = await this.prisma.widgetPreset.findFirst({
        where: {
          organizationId: org,
          widgetKey: preset.widgetKey,
          deletedAt: null,
        },
        orderBy: { createdAt: 'asc' },
      });
      if (fallback) {
        await this.prisma.widgetPreset.update({
          where: { id: fallback.id },
          data: { isDefault: true },
        });
        await this.enforceSingleDefault(org, preset.widgetKey, fallback.id);
      }
    }
    return { success: true };
  }

  async listTemplates(actor: AuthUser | null, organizationId?: string | null) {
    const org = this.resolveOrg(actor, organizationId, {
      allowSuperWithoutOrg: true,
    });
    if (!org) return [];
    return this.prisma.oBSTemplate.findMany({
      where: { organizationId: org, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      include: { scenes: { where: { deletedAt: null } } },
    });
  }

  async getTemplate(
    id: string,
    actor: AuthUser | null,
    organizationId?: string | null,
  ) {
    const tpl = await this.prisma.oBSTemplate.findFirst({
      where: { id, deletedAt: null },
      include: { scenes: { where: { deletedAt: null } } },
    });
    if (!tpl) throw new NotFoundException('OBS template not found');
    this.ensureOrg(tpl.organizationId, actor, organizationId);
    return tpl;
  }

  async createTemplate(params: {
    actor: AuthUser | null;
    organizationId?: string | null;
    data: {
      key: string;
      name: string;
      description?: string | null;
      kind?: ObsTemplateKind;
      config?: Prisma.JsonValue;
      scenes?: Array<{ name: string; layout?: Prisma.JsonValue }>;
    };
  }) {
    const org = this.requireOrg(params.actor, params.organizationId);
    const created = await this.prisma.oBSTemplate.create({
      data: {
        organizationId: org,
        key: params.data.key,
        name: params.data.name,
        description: params.data.description ?? null,
        kind: params.data.kind ?? ObsTemplateKind.CUSTOM,
        config: params.data.config ?? {},
      },
    });

    if (params.data.scenes?.length) {
      await this.prisma.oBSScene.createMany({
        data: params.data.scenes.map((s) => ({
          templateId: created.id,
          organizationId: org,
          name: s.name,
          layout: s.layout ?? {},
        })),
      });
    }

    return this.getTemplate(created.id, params.actor, org);
  }

  async updateTemplate(params: {
    id: string;
    actor: AuthUser | null;
    organizationId?: string | null;
    data: Partial<{
      name: string;
      description: string | null;
      config: Prisma.JsonValue;
      kind: ObsTemplateKind;
    }>;
  }) {
    const tpl = await this.getTemplate(
      params.id,
      params.actor,
      params.organizationId,
    );
    await this.prisma.oBSTemplate.update({
      where: { id: tpl.id },
      data: {
        name: params.data.name ?? tpl.name,
        description: params.data.description ?? tpl.description,
        config: params.data.config ?? tpl.config ?? Prisma.JsonNull,
        kind: params.data.kind ?? tpl.kind,
      },
    });
    return this.getTemplate(tpl.id, params.actor, tpl.organizationId);
  }

  async deleteTemplate(
    id: string,
    actor: AuthUser | null,
    organizationId?: string | null,
  ) {
    const tpl = await this.getTemplate(id, actor, organizationId);
    return this.prisma.oBSTemplate.update({
      where: { id: tpl.id },
      data: { deletedAt: new Date() },
    });
  }

  private async nextTemplateKey(orgId: string, baseKey: string) {
    let candidate = baseKey;
    let counter = 1;

    while (true) {
      const exists = await this.prisma.oBSTemplate.findFirst({
        where: { organizationId: orgId, key: candidate, deletedAt: null },
        select: { id: true },
      });
      if (!exists) return candidate;
      candidate = `${baseKey}-${counter}`;
      counter += 1;
    }
  }

  async copyTemplate(id: string, targetOrgId: string, actor: AuthUser | null) {
    if (!this.isSuper(actor)) {
      throw new ForbiddenException('Only SUPER_ADMIN can copy templates');
    }
    const targetOrg = await this.prisma.organization.findFirst({
      where: { id: targetOrgId, deletedAt: null },
      select: { id: true },
    });
    if (!targetOrg)
      throw new NotFoundException('Target organization not found');

    const tpl = await this.prisma.oBSTemplate.findFirst({
      where: { id, deletedAt: null },
      include: { scenes: { where: { deletedAt: null } } },
    });
    if (!tpl) throw new NotFoundException('OBS template not found');

    const newKey = await this.nextTemplateKey(targetOrgId, tpl.key);

    const created = await this.prisma.oBSTemplate.create({
      data: {
        organizationId: targetOrgId,
        key: newKey,
        name: `${tpl.name} (Copy)`,
        description: tpl.description,
        kind: tpl.kind,
        config: tpl.config ?? Prisma.JsonNull,
      },
    });

    if (tpl.scenes?.length) {
      await this.prisma.oBSScene.createMany({
        data: tpl.scenes.map((s) => ({
          templateId: created.id,
          organizationId: targetOrgId,
          name: s.name,
          layout: (s.layout ?? {}) as
            | Prisma.InputJsonValue
            | Prisma.NullableJsonNullValueInput,
        })),
      });
    }

    return this.getTemplate(created.id, actor, targetOrgId);
  }
}

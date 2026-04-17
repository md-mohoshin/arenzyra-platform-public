import { Role } from '@prisma/client';
import { OrganizationBrandingService } from './organization-branding.service';
import { DEFAULT_ORGANIZATION_BRANDING } from './organization-branding.constants';
import type { PrismaService } from '../../db/prisma.service';
import type { Actor } from '../../common/auth/jwt.strategy';
import { RealtimeGateway } from '../../realtime/realtime.gateway';

type BrandingRecord = Record<string, unknown> & {
  organizationId: string;
  mode: string;
};

class MockBrandingDelegate {
  private store = new Map<string, BrandingRecord>();

  findUnique(params: { where: { organizationId: string } }) {
    return Promise.resolve(this.store.get(params.where.organizationId) ?? null);
  }

  create(params: { data: BrandingRecord }) {
    const orgId = params.data.organizationId;
    if (!orgId) throw new Error('organizationId required');
    this.store.set(orgId, params.data);
    return Promise.resolve(params.data);
  }

  update(params: {
    where: { organizationId: string };
    data: Partial<BrandingRecord>;
  }) {
    const existing = this.store.get(params.where.organizationId);
    if (!existing) throw new Error('not found');
    const next = { ...existing, ...params.data };
    this.store.set(params.where.organizationId, next);
    return Promise.resolve(next);
  }

  upsert(params: {
    where: { organizationId: string };
    create: BrandingRecord;
    update: Partial<BrandingRecord>;
  }) {
    if (this.store.has(params.where.organizationId)) {
      return this.update({ where: params.where, data: params.update });
    }
    return this.create({ data: params.create });
  }

  get snapshot() {
    return this.store;
  }
}

class MockOrganizationDelegate {
  findUnique(params: { where: { id: string } }) {
    const id = params.where.id;
    return Promise.resolve(id ? { id } : null);
  }
}

const makeService = (override?: Partial<PrismaService>) => {
  const delegate = new MockBrandingDelegate();
  const organization = new MockOrganizationDelegate();
  const prisma = {
    organizationBranding: delegate,
    organization,
    ...(override ?? {}),
  } as unknown as PrismaService;
  const realtime = {
    emitBrandingUpdated: jest.fn(),
    emitThemeUpdated: jest.fn(),
  } as unknown as RealtimeGateway;
  const svc = new OrganizationBrandingService(prisma, realtime);
  return { svc, delegate };
};

const adminActor = (orgId: string): Actor =>
  ({
    organizationId: orgId,
    actingOrgId: null,
    actorRole: Role.ADMIN,
    role: Role.ADMIN,
  }) as unknown as Actor;

describe('OrganizationBrandingService', () => {
  it('creates default branding for new org on first read', async () => {
    const { svc, delegate } = makeService();
    const branding = await svc.getForOrganization('orgA');
    expect(branding).toMatchObject({
      organizationId: 'orgA',
      primaryColor: DEFAULT_ORGANIZATION_BRANDING.primaryColor,
      widgetBackground: DEFAULT_ORGANIZATION_BRANDING.widgetBackground,
      textPrimary: DEFAULT_ORGANIZATION_BRANDING.textPrimary,
    });
    expect(delegate.snapshot.get('orgA')).toBeDefined();
  });

  it('updates branding for org A without altering org B', async () => {
    const { svc, delegate } = makeService();
    await svc.ensureDefaultForOrg('orgA');
    await svc.ensureDefaultForOrg('orgB');

    const result = await svc.updateForActor(adminActor('orgA'), 'orgA', {
      accent: '#123456',
    });

    expect(delegate.snapshot.get('orgA')?.accent).toBe('#123456');
    expect(result.accent).toBe('#123456');
    expect(delegate.snapshot.get('orgB')?.accent).toBe(
      DEFAULT_ORGANIZATION_BRANDING.accent,
    );
  });

  it('allows SUPER_ADMIN to update any org directly', async () => {
    const { svc, delegate } = makeService();
    await svc.ensureDefaultForOrg('orgC');
    const superActor = {
      organizationId: null,
      actingOrgId: 'orgC',
      actorRole: Role.SUPER_ADMIN,
      role: Role.SUPER_ADMIN,
    } as unknown as Actor;

    const updated = await svc.updateForActor(superActor, 'orgC', {
      mode: 'gradient',
      gradientDirection: 'horizontal',
    });

    expect(delegate.snapshot.get('orgC')?.mode).toBe('gradient');
    expect(updated.gradientDirection).toBe('horizontal');
    expect(updated.backgroundCss).toContain('linear-gradient');
  });

  it('accepts reverse-diagonal gradients and generated overrides', async () => {
    const { svc } = makeService();

    const branding = await svc.updateForActor(adminActor('orgRev'), 'orgRev', {
      mode: 'gradient',
      primaryColor: '#33ccff',
      gradientDirection: 'reverse-diagonal',
    });

    expect(branding.gradientDirection).toBe('reverse-diagonal');
    expect(branding.backgroundCss).toContain('45deg');
    expect(branding.secondaryColor).toBeDefined();
    expect(branding.panel).toBeDefined();
  });

  it('derives and persists tokens when widget background changes', async () => {
    const { svc, delegate } = makeService();

    const branding = await svc.updateForActor(adminActor('orgD'), 'orgD', {
      widgetBackground: '#123456',
      gradientStart: '#654321',
    });

    const stored = delegate.snapshot.get('orgD');
    expect(stored?.widgetBackground).toBe('#123456');
    expect(stored?.backgroundStart).toBe('#123456');
    expect(branding.textPrimary).toBeDefined();
    expect(branding.badgeBg).toBeDefined();
  });

  it('persists advanced overrides without dropping generated fields', async () => {
    const { svc, delegate } = makeService();

    const branding = await svc.updateForActor(adminActor('orgE'), 'orgE', {
      backgroundSolid: '#112233',
      secondaryColor: '#445566',
      textPrimary: '#f7f7f7',
      textMuted: '#d0d0d0',
      panel: '#1f2937',
      border: 'rgba(255,255,255,0.18)',
      glowAccent: 'rgba(68,85,102,0.44)',
      badgeBg: '#223344',
      badgeText: '#ffffff',
    });

    expect(branding.backgroundSolid).toBe('#112233');
    expect(branding.widgetBackground).toBe('#112233');
    expect(branding.secondaryColor).toBe('#445566');
    expect(branding.panel).toBe('#1f2937');
    expect(branding.border).toBe('rgba(255,255,255,0.18)');
    expect(delegate.snapshot.get('orgE')).toMatchObject({
      backgroundSolid: '#112233',
      widgetBackground: '#112233',
      secondaryColor: '#445566',
      panel: '#1f2937',
      border: 'rgba(255,255,255,0.18)',
      glowAccent: 'rgba(68,85,102,0.44)',
      badgeBg: '#223344',
    });
  });

  it('blocks super admin without acting org when targeting different org', async () => {
    const { svc } = makeService();
    await svc.ensureDefaultForOrg('orgX');
    const superActor = {
      organizationId: null,
      actingOrgId: null,
      actorRole: Role.SUPER_ADMIN,
      role: Role.SUPER_ADMIN,
    } as unknown as Actor;

    await expect(
      svc.updateForActor(superActor, 'orgX', { accent: '#ff00ff' }),
    ).rejects.toThrow();
  });

  it('allows impersonated admin to update acting org only and blocks others', async () => {
    const { svc, delegate } = makeService();
    await svc.ensureDefaultForOrg('orgImp');
    const actor = {
      organizationId: 'orgHome',
      actingOrgId: 'orgImp',
      actorRole: Role.ADMIN,
      role: Role.ADMIN,
    } as unknown as Actor;

    const updated = await svc.updateForActor(actor, 'orgImp', {
      accent: '#abcdef',
    });
    expect(updated.accent).toBe('#abcdef');
    await expect(
      svc.updateForActor(actor, 'orgOther', { accent: '#123456' }),
    ).rejects.toThrow();
    expect(delegate.snapshot.get('orgImp')?.accent).toBe('#abcdef');
    expect(delegate.snapshot.get('orgOther')).toBeUndefined();
  });

  it('resolves branding for match via tournament organization', async () => {
    const delegate = new MockBrandingDelegate();
    await delegate.create({
      data: {
        organizationId: 'orgMatch',
        mode: 'solid',
        widgetBackground: '#111111',
      },
    });
    const prisma = {
      organizationBranding: delegate,
      organization: new MockOrganizationDelegate(),
      match: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'm-1',
          tournament: { organizationId: 'orgMatch' },
        }),
      },
      tournament: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;

    const realtime = {
      emitBrandingUpdated: jest.fn(),
      emitThemeUpdated: jest.fn(),
    } as unknown as RealtimeGateway;
    const svc = new OrganizationBrandingService(prisma, realtime);

    const branding = await svc.getEffectiveBranding({ matchId: 'm-1' });
    expect(branding.organizationId).toBe('orgMatch');
    expect(branding.widgetBackground).toBe('#111111');
  });

  it('resolves branding for match via direct match organization when no tournament is attached', async () => {
    const delegate = new MockBrandingDelegate();
    await delegate.create({
      data: {
        organizationId: 'orgSession',
        mode: 'solid',
        widgetBackground: '#222222',
      },
    });
    const prisma = {
      organizationBranding: delegate,
      organization: new MockOrganizationDelegate(),
      match: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'm-session',
          organizationId: 'orgSession',
          tournament: null,
        }),
      },
      tournament: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;

    const realtime = {
      emitBrandingUpdated: jest.fn(),
      emitThemeUpdated: jest.fn(),
    } as unknown as RealtimeGateway;
    const svc = new OrganizationBrandingService(prisma, realtime);

    const branding = await svc.getEffectiveBranding({ matchId: 'm-session' });
    expect(branding.organizationId).toBe('orgSession');
    expect(branding.widgetBackground).toBe('#222222');
  });
});

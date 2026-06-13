import { Role, SessionType, SponsorTier } from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth.types';
import type { PrismaService } from '../../db/prisma.service';
import type { BroadcastService } from '../broadcast/broadcast.service';
import { SessionSponsorsService } from './session-sponsors.service';

type SponsorRecord = {
  id: string;
  sessionId: string;
  organizationId: string;
  name: string;
  logoUrl: string;
  tier: SponsorTier;
  displayOrder: number;
  isActive: boolean;
  rotationIntervalSeconds: number | null;
  websiteUrl: string | null;
  deletedAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
};

class MockSessionSponsorDelegate {
  private store: SponsorRecord[] = [];

  findMany(params: {
    where: { sessionId?: string; deletedAt?: Date | null };
    orderBy?: Array<Record<string, 'asc' | 'desc'>>;
  }) {
    const { where, orderBy = [] } = params;
    const tierOrder: Record<SponsorTier, number> = {
      [SponsorTier.TITLE]: 0,
      [SponsorTier.GOLD]: 1,
      [SponsorTier.SILVER]: 2,
      [SponsorTier.BRONZE]: 3,
      [SponsorTier.MEDIA]: 4,
    };
    return [...this.store]
      .filter((row) => {
        if (where.sessionId && row.sessionId !== where.sessionId) return false;
        if (where.deletedAt === null && row.deletedAt) return false;
        return true;
      })
      .sort((a, b) => {
        for (const rule of orderBy) {
          const [key, dir] = Object.entries(rule)[0];
          const aVal =
            key === 'tier'
              ? tierOrder[a.tier]
              : ((a as Record<string, unknown>)[key] ?? 0);
          const bVal =
            key === 'tier'
              ? tierOrder[b.tier]
              : ((b as Record<string, unknown>)[key] ?? 0);
          if (aVal === bVal) continue;
          return dir === 'asc' ? (aVal < bVal ? -1 : 1) : aVal > bVal ? -1 : 1;
        }
        return 0;
      });
  }

  findFirst(params: { where: { id?: string; sessionId?: string } }) {
    const { id, sessionId } = params.where;
    return Promise.resolve(
      this.store.find(
        (row) =>
          (id ? row.id === id : true) &&
          (sessionId ? row.sessionId === sessionId : true),
      ) ?? null,
    );
  }

  create(params: { data: Omit<SponsorRecord, 'id'> }) {
    const record: SponsorRecord = {
      id: `s-${this.store.length + 1}`,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...params.data,
      deletedAt: null,
    };
    this.store.push(record);
    return Promise.resolve(record);
  }

  update(params: { where: { id: string }; data: Partial<SponsorRecord> }) {
    const idx = this.store.findIndex((s) => s.id === params.where.id);
    if (idx === -1) throw new Error('not found');
    const next = { ...this.store[idx], ...params.data };
    this.store[idx] = next;
    return Promise.resolve(next);
  }
}

const organizer = {
  organizationId: 'org-1',
  actingOrgId: null,
  actorRole: Role.ORGANIZER,
  role: Role.ORGANIZER,
} as unknown as AuthUser;

const makeService = () => {
  const sessionSponsor = new MockSessionSponsorDelegate();
  const prisma = {
    sessionSponsor,
    session: {
      findFirst: jest
        .fn()
        .mockImplementation((params: { where: { id: string } }) => {
          if (params.where.id === 'missing') return null;
          return {
            id: params.where.id,
            organizationId: 'org-1',
            type:
              params.where.id === 'scrim'
                ? SessionType.SCRIM
                : SessionType.EVENT,
          };
        }),
    },
  } as unknown as PrismaService;

  const broadcast: jest.Mocked<Pick<BroadcastService, 'emitForOrganization'>> =
    {
      emitForOrganization: jest.fn(),
    };

  const svc = new SessionSponsorsService(
    prisma,
    broadcast as unknown as BroadcastService,
  );
  return { svc, broadcast };
};

describe('SessionSponsorsService', () => {
  it('creates an event sponsor with defaults and emits broadcast', async () => {
    const { svc, broadcast } = makeService();

    const created = await svc.createSponsor(
      'event-1',
      {
        name: 'Event Partner',
        logoUrl: '/logo.webp',
        tier: SponsorTier.GOLD,
      },
      organizer,
    );

    expect(created.sessionId).toBe('event-1');
    expect(created.organizationId).toBe('org-1');
    expect(created.isActive).toBe(true);
    expect(broadcast.emitForOrganization).toHaveBeenCalledWith(
      'org-1',
      'sponsors',
      { sessionId: 'event-1' },
    );
  });

  it('orders event sponsors by tier then displayOrder', async () => {
    const { svc } = makeService();

    await svc.createSponsor(
      'event-1',
      {
        name: 'Gold 2',
        logoUrl: '/g2',
        tier: SponsorTier.GOLD,
        displayOrder: 2,
      },
      organizer,
    );
    await svc.createSponsor(
      'event-1',
      {
        name: 'Title',
        logoUrl: '/t',
        tier: SponsorTier.TITLE,
        displayOrder: 9,
      },
      organizer,
    );
    await svc.createSponsor(
      'event-1',
      {
        name: 'Gold 1',
        logoUrl: '/g1',
        tier: SponsorTier.GOLD,
        displayOrder: 1,
      },
      organizer,
    );

    const ordered = await svc.listSponsors('event-1', organizer);
    expect(ordered.map((s) => s.name)).toEqual(['Title', 'Gold 1', 'Gold 2']);
  });
});

import { Role, SponsorTier } from '@prisma/client';
import type { PrismaService } from '../../db/prisma.service';
import { TournamentSponsorsService } from './tournament-sponsors.service';
import type { BroadcastService } from '../broadcast/broadcast.service';
import type { AuthUser } from '../../common/auth/auth.types';

type SponsorRecord = {
  id: string;
  tournamentId: string;
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

class MockTournamentSponsorDelegate {
  private store: SponsorRecord[] = [];

  findMany(params: {
    where: {
      tournamentId?: string;
      isActive?: boolean;
      deletedAt?: Date | null;
    };
    orderBy?: Array<Record<string, 'asc' | 'desc'>>;
  }) {
    const { where, orderBy = [] } = params;
    const filtered = this.store.filter((row) => {
      if (where.tournamentId && row.tournamentId !== where.tournamentId)
        return false;
      if (where.isActive !== undefined && row.isActive !== where.isActive)
        return false;
      if (where.deletedAt === null && row.deletedAt) return false;
      return true;
    });
    const tierOrder: Record<SponsorTier, number> = {
      [SponsorTier.TITLE]: 0,
      [SponsorTier.GOLD]: 1,
      [SponsorTier.SILVER]: 2,
      [SponsorTier.BRONZE]: 3,
      [SponsorTier.MEDIA]: 4,
    };
    return [...filtered].sort((a, b) => {
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

  findFirst(params: { where: { id?: string; tournamentId?: string } }) {
    const { id, tournamentId } = params.where;
    return Promise.resolve(
      this.store.find(
        (row) =>
          (id ? row.id === id : true) &&
          (tournamentId ? row.tournamentId === tournamentId : true),
      ) ?? null,
    );
  }

  create(params: {
    data: Omit<SponsorRecord, 'id'> & Partial<Pick<SponsorRecord, 'id'>>;
  }) {
    const id = params.data.id ?? `s-${this.store.length + 1}`;
    const record: SponsorRecord = {
      id,
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

  delete(params: { where: { id: string } }) {
    this.store = this.store.filter((s) => s.id !== params.where.id);
    return Promise.resolve();
  }
}

const makeService = () => {
  const tournamentSponsor = new MockTournamentSponsorDelegate();
  const prisma = {
    tournamentSponsor,
    tournament: {
      findFirst: jest
        .fn()
        .mockImplementation((params: { where: { id: string } }) => {
          if (params.where.id === 'missing') return null;
          return {
            id: params.where.id,
            organizationId: 'org-1',
            deletedAt: null,
          };
        }),
    },
  } as unknown as PrismaService;

  const broadcast: jest.Mocked<Pick<BroadcastService, 'emitForOrganization'>> =
    {
      emitForOrganization: jest.fn(),
    };

  const svc = new TournamentSponsorsService(
    prisma,
    broadcast as unknown as BroadcastService,
  );
  return { svc, tournamentSponsor, broadcast };
};

const organizer = {
  organizationId: 'org-1',
  actingOrgId: null,
  actorRole: Role.ORGANIZER,
  role: Role.ORGANIZER,
} as unknown as AuthUser;

describe('TournamentSponsorsService', () => {
  it('creates a sponsor with defaults and emits broadcast', async () => {
    const { svc, broadcast } = makeService();

    const created = await svc.createSponsor(
      't-1',
      {
        name: 'Title Sponsor',
        logoUrl: '/logo.webp',
        tier: SponsorTier.TITLE,
      },
      organizer,
    );

    expect(created.tournamentId).toBe('t-1');
    expect(created.isActive).toBe(true);
    expect(broadcast.emitForOrganization).toHaveBeenCalledWith(
      'org-1',
      'sponsors',
      {
        tournamentId: 't-1',
      },
    );
  });

  it('orders sponsors by tier then displayOrder', async () => {
    const { svc } = makeService();

    await svc.createSponsor(
      't-1',
      {
        name: 'Gold 2',
        logoUrl: '/g2',
        tier: SponsorTier.GOLD,
        displayOrder: 2,
      },
      organizer,
    );
    await svc.createSponsor(
      't-1',
      {
        name: 'Title',
        logoUrl: '/t',
        tier: SponsorTier.TITLE,
        displayOrder: 99,
      },
      organizer,
    );
    await svc.createSponsor(
      't-1',
      {
        name: 'Gold 1',
        logoUrl: '/g1',
        tier: SponsorTier.GOLD,
        displayOrder: 1,
      },
      organizer,
    );

    const ordered = await svc.listSponsors('t-1', organizer);
    expect(ordered.map((s) => s.name)).toEqual(['Title', 'Gold 1', 'Gold 2']);
  });
});

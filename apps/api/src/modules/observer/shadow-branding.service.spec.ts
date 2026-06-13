import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { NotFoundException } from '@nestjs/common';
import sharp from 'sharp';
import { PrismaService } from '../../db/prisma.service';
import { ShadowBrandingService } from './shadow-branding.service';

describe('ShadowBrandingService', () => {
  jest.setTimeout(60_000);

  const originalLocalAppData = process.env.LOCALAPPDATA;
  const originalAssetsDir = process.env.ARENZYRA_OBSERVER_TEAM_ASSETS_DIR;
  const parseHex = (value: string) => ({
    r: Number.parseInt(value.slice(1, 3), 16),
    g: Number.parseInt(value.slice(3, 5), 16),
    b: Number.parseInt(value.slice(5, 7), 16),
  });

  let tmpDir: string;
  let localAppData: string;
  let teamAssetsDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shadow-branding-'));
    localAppData = path.join(tmpDir, 'LocalAppData');
    teamAssetsDir = path.join(tmpDir, 'team-assets');
    process.env.LOCALAPPDATA = localAppData;
    process.env.ARENZYRA_OBSERVER_TEAM_ASSETS_DIR = teamAssetsDir;
  });

  afterEach(async () => {
    if (originalLocalAppData === undefined) {
      delete process.env.LOCALAPPDATA;
    } else {
      process.env.LOCALAPPDATA = originalLocalAppData;
    }

    if (originalAssetsDir === undefined) {
      delete process.env.ARENZYRA_OBSERVER_TEAM_ASSETS_DIR;
    } else {
      process.env.ARENZYRA_OBSERVER_TEAM_ASSETS_DIR = originalAssetsDir;
    }

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('writes all 25 branding entries and fills unused slots with Arenzyra defaults', async () => {
    const sourceLogoPath = path.join(tmpDir, 'alpha7.png');
    await sharp({
      create: {
        width: 16,
        height: 16,
        channels: 4,
        background: { r: 255, g: 0, b: 0, alpha: 1 },
      },
    })
      .png()
      .toFile(sourceLogoPath);

    const prisma = {
      match: {
        findFirst: jest.fn().mockResolvedValue({ id: 'match-1' }),
      },
      matchSlot: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'slot-1',
            matchId: 'match-1',
            slotNumber: 1,
            teamId: 'team-1',
            lobbyStatus: 'READY',
            playersInLobby: 4,
            team: {
              id: 'team-1',
              name: 'Alpha7',
              tag: 'A7',
              logoUrl: sourceLogoPath,
              accentLight: '#FF0000',
              accentDark: null,
            },
          },
          {
            id: 'slot-5',
            matchId: 'match-1',
            slotNumber: 5,
            teamId: 'team-5',
            lobbyStatus: 'READY',
            playersInLobby: 4,
            team: {
              id: 'team-5',
              name: 'Beta Squad',
              tag: 'BS',
              logoUrl: null,
              accentLight: null,
              accentDark: null,
            },
          },
        ]),
      },
    } as unknown as PrismaService;

    const service = new ShadowBrandingService(prisma);
    const result = await service.generateShadowBranding('match-1');

    expect(result.teamCount).toBe(25);
    expect(result.teamAssetsDir).toBe(teamAssetsDir);
    expect(result.slots).toHaveLength(25);
    expect(result.slots[0]).toMatchObject({
      slotNumber: 1,
      teamId: 'team-1',
      resolvedColor: '#FF0000',
      playerColor: '#C20000',
      isDefaultBranding: false,
    });
    expect(result.slots[1]).toMatchObject({
      slotNumber: 2,
      teamId: null,
      isDefaultBranding: true,
    });
    expect(result.slots[4]).toMatchObject({
      slotNumber: 5,
      teamId: 'team-5',
      isDefaultBranding: false,
    });

    const brandingFile = await fs.readFile(result.brandingConfigPath, 'utf8');
    expect((brandingFile.match(/^TeamLogoAndColor=/gm) ?? []).length).toBe(25);
    expect(brandingFile).toContain(
      `TeamLogoAndColor=(TeamNo=1,TeamName=Alpha7,TeamLogoPath=${path.join(teamAssetsDir, '001.png')},KillInfoPath=${path.join(teamAssetsDir, '001.png')},TeamColorR=255,TeamColorG=0,TeamColorB=0,TeamColorA=255,PlayerColorR=194,PlayerColorG=0,PlayerColorB=0,PlayerColorA=255,CornerMarkPath=,fin)`,
    );
    expect(brandingFile).toContain('TeamNo=2,TeamName=Arenzyra');
    expect(brandingFile).toContain('TeamNo=5,TeamName=BetaSquad');
    expect(brandingFile).toContain('CornerMarkPath=,fin)');

    const stagedLogo = path.join(teamAssetsDir, '001.png');
    const stagedLogo64 = path.join(teamAssetsDir, '001_64.png');
    const stagedLogo128 = path.join(teamAssetsDir, '001_128.png');
    const stagedLogo256 = path.join(teamAssetsDir, '001_256.png');
    const defaultLogo = path.join(teamAssetsDir, 'arenzyra-default.png');
    const slotFiveDefaultLogo = path.join(teamAssetsDir, '005.png');
    const slotTwoDefaultLogo = path.join(teamAssetsDir, '002.png');
    expect(result.slots[0]?.localLogoPath).toBe(stagedLogo);
    expect(result.slots[0]?.logoPaths).toEqual({
      base: stagedLogo,
      size64: stagedLogo64,
      size128: stagedLogo128,
      size256: stagedLogo256,
    });
    expect(result.slots[1]?.localLogoPath).toBe(slotTwoDefaultLogo);
    expect(result.slots[4]?.localLogoPath).toBe(slotFiveDefaultLogo);
    expect(result.brandingConfigPath).toBe(
      path.join(
        localAppData,
        'ShadowTrackerExtra',
        'Saved',
        'TeamLogoAndColor.ini',
      ),
    );
    await expect(fs.stat(stagedLogo)).resolves.toBeDefined();
    await expect(fs.stat(stagedLogo64)).resolves.toBeDefined();
    await expect(fs.stat(stagedLogo128)).resolves.toBeDefined();
    await expect(fs.stat(stagedLogo256)).resolves.toBeDefined();
    await expect(fs.stat(slotTwoDefaultLogo)).resolves.toBeDefined();
    await expect(fs.stat(slotFiveDefaultLogo)).resolves.toBeDefined();
    await expect(fs.stat(defaultLogo)).resolves.toBeDefined();

    await expect(sharp(stagedLogo).metadata()).resolves.toMatchObject({
      width: 256,
      height: 256,
      format: 'png',
    });
    await expect(sharp(stagedLogo64).metadata()).resolves.toMatchObject({
      width: 64,
      height: 64,
      format: 'png',
    });
    await expect(sharp(stagedLogo128).metadata()).resolves.toMatchObject({
      width: 128,
      height: 128,
      format: 'png',
    });
    await expect(sharp(stagedLogo256).metadata()).resolves.toMatchObject({
      width: 256,
      height: 256,
      format: 'png',
    });
  });

  it('prefers a saturated logo accent when no team color is configured', async () => {
    const sourceLogoPath = path.join(tmpDir, 'accent-heavy.png');
    const blackBase = await sharp({
      create: {
        width: 72,
        height: 72,
        channels: 4,
        background: { r: 8, g: 8, b: 8, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    const blueStripe = await sharp({
      create: {
        width: 20,
        height: 72,
        channels: 4,
        background: { r: 40, g: 167, b: 255, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    await sharp({
      create: {
        width: 96,
        height: 96,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([
        { input: blackBase, left: 12, top: 12 },
        { input: blueStripe, left: 38, top: 12 },
      ])
      .png()
      .toFile(sourceLogoPath);

    const prisma = {
      match: {
        findFirst: jest.fn().mockResolvedValue({ id: 'match-2' }),
      },
      matchSlot: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'slot-1',
            matchId: 'match-2',
            slotNumber: 1,
            teamId: 'team-accent',
            lobbyStatus: 'READY',
            playersInLobby: 4,
            team: {
              id: 'team-accent',
              name: 'Accent Squad',
              tag: 'AS',
              logoUrl: sourceLogoPath,
              accentLight: null,
              accentDark: null,
            },
          },
        ]),
      },
    } as unknown as PrismaService;

    const service = new ShadowBrandingService(prisma);
    const result = await service.generateShadowBranding('match-2');

    expect(result.slots[0]).toMatchObject({
      slotNumber: 1,
      teamId: 'team-accent',
      isDefaultBranding: false,
    });
    expect(result.slots[0]?.resolvedColor).not.toBe('#5E5E5E');
    expect(result.slots[0]?.playerColor).not.toBe('#474747');

    const teamColor = parseHex(result.slots[0].resolvedColor);
    const playerColor = parseHex(result.slots[0].playerColor);
    expect(teamColor.b).toBeGreaterThan(teamColor.g);
    expect(teamColor.g).toBeGreaterThan(teamColor.r);
    expect(teamColor.b - teamColor.r).toBeGreaterThan(120);
    expect(playerColor.b).toBeGreaterThan(playerColor.r);
  });

  it('throws when the match does not exist', async () => {
    const prisma = {
      match: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      matchSlot: {
        findMany: jest.fn(),
      },
    } as unknown as PrismaService;

    const service = new ShadowBrandingService(prisma);

    await expect(
      service.generateShadowBranding('missing-match'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

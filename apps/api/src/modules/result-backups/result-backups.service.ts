import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth.types';
import { effectiveOrganizationId } from '../../common/org/org.util';
import { isPresentInMatch } from '../../common/results-presence.util';
import { PrismaService } from '../../db/prisma.service';
import { RenderService } from '../render/render.service';

const RESULT_BACKUP_RETENTION_DAYS = 30;
const DISCORD_API_BASE_URL = 'https://discord.com/api/v10';

const resultBackupListSelect = {
  id: true,
  organizationId: true,
  sessionId: true,
  sourceMatchId: true,
  kind: true,
  source: true,
  matchNumber: true,
  matchName: true,
  sessionName: true,
  title: true,
  postedChannelId: true,
  postedMessageId: true,
  repostedAt: true,
  expiresAt: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { rows: true } },
} satisfies Prisma.ResultBackupSelect;

const resultBackupDetailSelect = {
  id: true,
  organizationId: true,
  sessionId: true,
  sourceMatchId: true,
  kind: true,
  source: true,
  matchNumber: true,
  matchName: true,
  sessionName: true,
  title: true,
  postedChannelId: true,
  postedMessageId: true,
  repostedAt: true,
  expiresAt: true,
  createdAt: true,
  updatedAt: true,
  session: {
    select: {
      id: true,
      name: true,
      discordConfig: {
        select: {
          resultsChannelId: true,
          emojis: true,
        },
      },
    },
  },
  rows: {
    orderBy: [{ rank: 'asc' }],
    select: {
      id: true,
      rank: true,
      teamId: true,
      teamName: true,
      teamTag: true,
      logoUrl: true,
      slotNumber: true,
      placement: true,
      wwcd: true,
      placementPoints: true,
      kills: true,
      totalPoints: true,
      playersJson: true,
      createdAt: true,
      updatedAt: true,
    },
  },
} satisfies Prisma.ResultBackupSelect;

type ResultBackupDetail = Prisma.ResultBackupGetPayload<{
  select: typeof resultBackupDetailSelect;
}>;

type EditableBackupRowInput = {
  id?: string | null;
  rank?: number | string | null;
  teamId?: string | null;
  teamName?: string | null;
  teamTag?: string | null;
  logoUrl?: string | null;
  slotNumber?: number | string | null;
  placement?: number | string | null;
  wwcd?: number | string | null;
  placementPoints?: number | string | null;
  kills?: number | string | null;
  totalPoints?: number | string | null;
  players?: unknown;
  playersJson?: unknown;
};

type EditableBackupPlayer = {
  id: string;
  playerId: string | null;
  externalPlayerId: string | null;
  name: string;
  kills: number;
  knocks: number | null;
  assists: number | null;
  alive: boolean | null;
  isAlive: boolean | null;
  isKnocked: boolean | null;
  avatar: string | null;
};

type EditableBackupRow = {
  rank: number;
  teamId: string | null;
  teamName: string;
  teamTag: string | null;
  logoUrl: string | null;
  slotNumber: number | null;
  placement: number | null;
  wwcd: number;
  placementPoints: number;
  kills: number;
  totalPoints: number;
  playersJson: EditableBackupPlayer[];
};

@Injectable()
export class ResultBackupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly render: RenderService,
  ) {}

  private requireOrganization(actor: AuthUser): string {
    const organizationId = effectiveOrganizationId(actor);
    if (!organizationId) {
      throw new ForbiddenException('Organization context missing');
    }
    return organizationId;
  }

  private canReadOrganization(actor: AuthUser, organizationId: string) {
    const actorOrg = effectiveOrganizationId(actor);
    if (actorOrg === organizationId) {
      return true;
    }
    return (
      (actor.role === Role.SUPER_ADMIN ||
        actor.actorRole === Role.SUPER_ADMIN) &&
      !actor.actingOrgId
    );
  }

  private assertBackupAccess(
    actor: AuthUser,
    backup: { organizationId: string },
  ) {
    if (!this.canReadOrganization(actor, backup.organizationId)) {
      throw new ForbiddenException('Not allowed to access this result backup');
    }
  }

  private addRetentionWindow(date = new Date()) {
    return new Date(
      date.getTime() + RESULT_BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );
  }

  async pruneExpired(organizationId: string) {
    await this.prisma.resultBackup.deleteMany({
      where: {
        organizationId,
        expiresAt: { lt: new Date() },
      },
    });
  }

  async list(actor: AuthUser, query: { sessionId?: string; kind?: string }) {
    const organizationId = this.requireOrganization(actor);
    await this.pruneExpired(organizationId);

    const backups = await this.prisma.resultBackup.findMany({
      where: {
        organizationId,
        sessionId: query.sessionId?.trim() || undefined,
        kind: query.kind?.trim().toUpperCase() || undefined,
        expiresAt: { gt: new Date() },
      },
      select: resultBackupListSelect,
      orderBy: [{ createdAt: 'desc' }],
      take: 120,
    });

    return backups.map((backup) => ({
      ...backup,
      rowCount: backup._count.rows,
      _count: undefined,
    }));
  }

  async get(id: string, actor: AuthUser) {
    const backup = await this.prisma.resultBackup.findUnique({
      where: { id },
      select: resultBackupDetailSelect,
    });
    if (!backup || backup.expiresAt <= new Date()) {
      throw new NotFoundException('Result backup not found');
    }
    this.assertBackupAccess(actor, backup);
    return this.serializeBackup(backup);
  }

  async updateRows(id: string, body: { rows?: unknown[] }, actor: AuthUser) {
    const backup = await this.prisma.resultBackup.findUnique({
      where: { id },
      select: { id: true, organizationId: true, expiresAt: true },
    });
    if (!backup || backup.expiresAt <= new Date()) {
      throw new NotFoundException('Result backup not found');
    }
    this.assertBackupAccess(actor, backup);

    const rows = this.normalizeEditableRows(body.rows);

    await this.prisma.$transaction(async (tx) => {
      await tx.resultBackupRow.deleteMany({ where: { backupId: id } });
      if (rows.length > 0) {
        await tx.resultBackupRow.createMany({
          data: rows.map((row) => ({
            backupId: id,
            ...row,
          })),
        });
      }
      await tx.resultBackup.update({
        where: { id },
        data: { expiresAt: this.addRetentionWindow() },
      });
    });

    return this.get(id, actor);
  }

  async captureMatchBackupFromMatchId(
    matchId: string,
    source = 'screenshot-apply',
  ) {
    const match = await this.prisma.match.findFirst({
      where: {
        id: matchId,
        deletedAt: null,
        sessionId: { not: null },
      },
      select: {
        id: true,
        name: true,
        matchNumber: true,
        organizationId: true,
        sessionId: true,
        session: { select: { id: true, name: true } },
        slotResults: {
          where: { teamId: { not: null } },
          select: {
            slotNumber: true,
            teamId: true,
            wasPresentInMatch: true,
            placement: true,
            placementPoints: true,
            totalKills: true,
            totalPoints: true,
            points: true,
            team: {
              select: {
                id: true,
                name: true,
                tag: true,
                logoUrl: true,
              },
            },
            players: {
              orderBy: { playerName: 'asc' },
              select: {
                id: true,
                playerId: true,
                externalPlayerId: true,
                playerName: true,
                kills: true,
                knocks: true,
                assists: true,
                isAlive: true,
                alive: true,
                isKnocked: true,
                player: {
                  select: {
                    ign: true,
                    realName: true,
                    photoUrl: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!match?.sessionId) {
      return null;
    }

    const rows = this.buildMatchRows(match.slotResults);
    if (!rows.length) {
      return null;
    }

    return this.replaceBackupRows({
      organizationId: match.organizationId,
      sessionId: match.sessionId,
      sourceMatchId: match.id,
      kind: 'MATCH',
      source,
      matchNumber: match.matchNumber,
      matchName: match.name,
      sessionName: match.session?.name ?? null,
      title: match.name?.trim() || `Match ${match.matchNumber ?? ''}`.trim(),
      rows,
    });
  }

  async repost(id: string, body: { channelId?: string }, actor: AuthUser) {
    const backup = await this.prisma.resultBackup.findUnique({
      where: { id },
      select: resultBackupDetailSelect,
    });
    if (!backup || backup.expiresAt <= new Date()) {
      throw new NotFoundException('Result backup not found');
    }
    this.assertBackupAccess(actor, backup);

    const channelId =
      this.cleanSnowflake(body.channelId) ??
      this.defaultResultChannelId(backup);
    if (!channelId) {
      throw new BadRequestException(
        'No result channel is configured for this backup.',
      );
    }

    const token = this.discordToken();
    const renderKind =
      backup.kind.toUpperCase() === 'OVERALL'
        ? 'overall-ranking'
        : 'match-result';
    const image = await this.render.renderResultBackupImage(
      actor,
      backup.id,
      renderKind,
    );
    const filename =
      renderKind === 'overall-ranking'
        ? `result-backup-${backup.id}-overall.png`
        : `result-backup-${backup.id}-match.png`;
    const content =
      backup.kind.toUpperCase() === 'OVERALL'
        ? `Reposted corrected overall result: ${backup.title ?? backup.sessionName ?? backup.session.name}`
        : `Reposted corrected match result: ${backup.title ?? backup.matchName ?? 'Match result'}`;

    const form = new FormData();
    const imageBody = image.buffer.slice(
      image.byteOffset,
      image.byteOffset + image.byteLength,
    ) as ArrayBuffer;
    form.append(
      'payload_json',
      JSON.stringify({
        content,
        allowed_mentions: { parse: [] },
      }),
    );
    form.append(
      'files[0]',
      new Blob([imageBody], { type: 'image/png' }),
      filename,
    );

    const response = await fetch(
      `${DISCORD_API_BASE_URL}/channels/${channelId}/messages`,
      {
        method: 'POST',
        headers: { Authorization: `Bot ${token}` },
        body: form,
      },
    );

    const responseBody = await response.text();
    if (!response.ok) {
      throw new BadRequestException(
        `Discord repost failed (${response.status}): ${responseBody || response.statusText}`,
      );
    }

    let messageId: string | null = null;
    try {
      const payload = JSON.parse(responseBody) as { id?: unknown };
      messageId = typeof payload.id === 'string' ? payload.id : null;
    } catch {
      messageId = null;
    }

    await this.prisma.resultBackup.update({
      where: { id: backup.id },
      data: {
        postedChannelId: channelId,
        postedMessageId: messageId,
        repostedAt: new Date(),
        expiresAt: this.addRetentionWindow(),
      },
    });

    return {
      ok: true,
      backupId: backup.id,
      channelId,
      messageId,
    };
  }

  private normalizeEditableRows(rows: unknown[] | undefined) {
    if (!Array.isArray(rows)) {
      throw new BadRequestException('rows must be an array');
    }
    const normalized = rows.map((row, index) =>
      this.normalizeEditableRow(
        row && typeof row === 'object' ? (row as EditableBackupRowInput) : {},
        index,
      ),
    );
    const ranks = new Set<number>();
    for (const row of normalized) {
      if (ranks.has(row.rank)) {
        throw new BadRequestException(`Duplicate rank ${row.rank}`);
      }
      ranks.add(row.rank);
    }
    return normalized.sort((left, right) => left.rank - right.rank);
  }

  private normalizeEditableRow(
    row: EditableBackupRowInput,
    index: number,
  ): EditableBackupRow {
    const teamName = this.cleanString(row.teamName);
    if (!teamName) {
      throw new BadRequestException(`Row ${index + 1} needs a team name`);
    }
    return {
      rank: this.readInt(row.rank, index + 1, { min: 1, max: 200 }),
      teamId: this.cleanString(row.teamId),
      teamName,
      teamTag: this.cleanString(row.teamTag),
      logoUrl: this.cleanString(row.logoUrl),
      slotNumber: this.readOptionalInt(row.slotNumber, { min: 1, max: 500 }),
      placement: this.readOptionalInt(row.placement, { min: 1, max: 500 }),
      wwcd: this.readInt(row.wwcd, 0, { min: 0, max: 500 }),
      placementPoints: this.readInt(row.placementPoints, 0, {
        min: -10000,
        max: 100000,
      }),
      kills: this.readInt(row.kills, 0, { min: 0, max: 100000 }),
      totalPoints: this.readInt(row.totalPoints, 0, {
        min: -10000,
        max: 100000,
      }),
      playersJson: this.normalizeBackupPlayersInput(
        row.players ?? row.playersJson,
      ),
    };
  }

  private buildMatchRows(
    rows: Array<{
      slotNumber: number;
      teamId: string | null;
      wasPresentInMatch: boolean | null;
      placement: number | null;
      placementPoints: number;
      totalKills: number;
      totalPoints: number;
      points: number;
      team: {
        id: string;
        name: string;
        tag: string | null;
        logoUrl: string | null;
      } | null;
      players?: Array<{
        id: string;
        playerId: string | null;
        externalPlayerId?: string | null;
        playerName: string;
        kills: number;
        knocks?: number | null;
        assists?: number | null;
        isAlive?: boolean | null;
        alive?: boolean | null;
        isKnocked?: boolean | null;
        player?: {
          ign?: string | null;
          realName?: string | null;
          photoUrl?: string | null;
        } | null;
      }>;
    }>,
  ): EditableBackupRow[] {
    return rows
      .filter((row) => {
        if (
          !row.teamId ||
          !row.team ||
          !isPresentInMatch(row.wasPresentInMatch)
        ) {
          return false;
        }
        return (
          row.placement !== null ||
          Math.max(0, row.totalKills ?? 0) > 0 ||
          Math.max(0, row.totalPoints ?? row.points ?? 0) > 0 ||
          Math.max(0, row.placementPoints ?? 0) > 0
        );
      })
      .map((row) => ({
        rank: row.placement ?? row.slotNumber,
        teamId: row.teamId,
        teamName:
          row.team?.name?.trim() || row.team?.tag?.trim() || row.teamId!,
        teamTag: row.team?.tag ?? null,
        logoUrl: row.team?.logoUrl ?? null,
        slotNumber: row.slotNumber,
        placement: row.placement,
        wwcd: row.placement === 1 ? 1 : 0,
        placementPoints: row.placementPoints ?? 0,
        kills: row.totalKills ?? 0,
        totalPoints: row.totalPoints ?? row.points ?? 0,
        playersJson: this.backupPlayersFromMatchPlayers(row.players ?? []),
      }))
      .sort((left, right) => {
        const leftPlacement = left.placement ?? left.rank;
        const rightPlacement = right.placement ?? right.rank;
        if (leftPlacement !== rightPlacement) {
          return leftPlacement - rightPlacement;
        }
        if (right.totalPoints !== left.totalPoints) {
          return right.totalPoints - left.totalPoints;
        }
        return right.kills - left.kills;
      })
      .map((row, index) => ({ ...row, rank: index + 1 }));
  }

  private async replaceBackupRows(params: {
    organizationId: string;
    sessionId: string;
    sourceMatchId: string | null;
    kind: 'MATCH' | 'OVERALL';
    source: string | null;
    matchNumber: number | null;
    matchName: string | null;
    sessionName: string | null;
    title: string | null;
    rows: EditableBackupRow[];
  }) {
    const dedupeKey = this.dedupeKey(params);
    await this.pruneExpired(params.organizationId);
    return this.prisma.$transaction(async (tx) => {
      const backup = await tx.resultBackup.upsert({
        where: { dedupeKey },
        create: {
          organizationId: params.organizationId,
          sessionId: params.sessionId,
          sourceMatchId: params.sourceMatchId,
          kind: params.kind,
          source: params.source,
          dedupeKey,
          matchNumber: params.matchNumber,
          matchName: params.matchName,
          sessionName: params.sessionName,
          title: params.title,
          expiresAt: this.addRetentionWindow(),
        },
        update: {
          sourceMatchId: params.sourceMatchId,
          kind: params.kind,
          source: params.source,
          matchNumber: params.matchNumber,
          matchName: params.matchName,
          sessionName: params.sessionName,
          title: params.title,
          expiresAt: this.addRetentionWindow(),
        },
        select: { id: true },
      });
      await tx.resultBackupRow.deleteMany({
        where: { backupId: backup.id },
      });
      if (params.rows.length > 0) {
        await tx.resultBackupRow.createMany({
          data: params.rows.map((row) => ({
            backupId: backup.id,
            ...row,
          })),
        });
      }
      return tx.resultBackup.findUnique({
        where: { id: backup.id },
        select: resultBackupListSelect,
      });
    });
  }

  private dedupeKey(params: {
    organizationId: string;
    sessionId: string;
    sourceMatchId: string | null;
    kind: string;
    source: string | null;
  }) {
    return [
      params.organizationId,
      params.sessionId,
      params.kind.toUpperCase(),
      params.sourceMatchId || 'session',
      params.source || 'manual',
    ].join(':');
  }

  private serializeBackup(backup: ResultBackupDetail) {
    return {
      ...backup,
      rows: backup.rows.map((row) => this.serializeBackupRow(row)),
    };
  }

  private serializeBackupRow(row: ResultBackupDetail['rows'][number]) {
    const { playersJson, ...rest } = row;
    return {
      ...rest,
      players: this.normalizeBackupPlayersInput(playersJson),
    };
  }

  private backupPlayersFromMatchPlayers(
    players: Array<{
      id: string;
      playerId: string | null;
      externalPlayerId?: string | null;
      playerName: string;
      kills: number;
      knocks?: number | null;
      assists?: number | null;
      isAlive?: boolean | null;
      alive?: boolean | null;
      isKnocked?: boolean | null;
      player?: {
        ign?: string | null;
        realName?: string | null;
        photoUrl?: string | null;
      } | null;
    }>,
  ) {
    return players
      .map((player, index) => {
        const name =
          this.cleanString(player.player?.ign) ??
          this.cleanString(player.player?.realName) ??
          this.cleanString(player.playerName);
        if (!name) return null;
        const id =
          this.cleanString(player.id) ??
          this.backupPlayerFallbackId(name, index);
        return {
          id,
          playerId: this.cleanString(player.playerId),
          externalPlayerId: this.cleanString(player.externalPlayerId),
          name,
          kills: this.readInt(player.kills, 0, { min: 0, max: 100000 }),
          knocks: this.readOptionalInt(player.knocks, { min: 0, max: 100000 }),
          assists: this.readOptionalInt(player.assists, {
            min: 0,
            max: 100000,
          }),
          alive: this.readNullableBoolean(player.alive),
          isAlive: this.readNullableBoolean(player.isAlive ?? player.alive),
          isKnocked: this.readNullableBoolean(player.isKnocked),
          avatar: this.cleanString(player.player?.photoUrl),
        };
      })
      .filter((player): player is EditableBackupPlayer => Boolean(player));
  }

  private normalizeBackupPlayersInput(value: unknown): EditableBackupPlayer[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map((entry, index) => {
        const player =
          entry && typeof entry === 'object'
            ? (entry as Record<string, unknown>)
            : {};
        const name =
          this.cleanString(player.name) ?? this.cleanString(player.playerName);
        if (!name) {
          return null;
        }
        const id =
          this.cleanString(player.id) ??
          this.cleanString(player.playerResultId) ??
          this.backupPlayerFallbackId(name, index);
        return {
          id,
          playerId: this.cleanString(player.playerId),
          externalPlayerId: this.cleanString(player.externalPlayerId),
          name,
          kills: this.readInt(player.kills, 0, { min: 0, max: 100000 }),
          knocks: this.readOptionalInt(player.knocks, {
            min: 0,
            max: 100000,
          }),
          assists: this.readOptionalInt(player.assists, {
            min: 0,
            max: 100000,
          }),
          alive: this.readNullableBoolean(player.alive),
          isAlive: this.readNullableBoolean(player.isAlive ?? player.alive),
          isKnocked: this.readNullableBoolean(
            player.isKnocked ?? player.knocked,
          ),
          avatar: this.cleanString(player.avatar ?? player.photoUrl),
        };
      })
      .filter((player): player is EditableBackupPlayer => Boolean(player))
      .slice(0, 16)
      .map((player, index) => ({
        ...player,
        id: player.id || this.backupPlayerFallbackId(player.name, index),
      }));
  }

  private backupPlayerFallbackId(name: string, index: number) {
    const normalized = name
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
    return `backup-player-${index + 1}${normalized ? `-${normalized}` : ''}`;
  }

  private defaultResultChannelId(backup: ResultBackupDetail) {
    const emojis =
      backup.session.discordConfig?.emojis &&
      typeof backup.session.discordConfig.emojis === 'object' &&
      !Array.isArray(backup.session.discordConfig.emojis)
        ? (backup.session.discordConfig.emojis as Record<string, unknown>)
        : {};
    const specificKey =
      backup.kind.toUpperCase() === 'OVERALL'
        ? 'overallResultPostChannelId'
        : 'matchResultPostChannelId';
    return (
      this.cleanSnowflake(emojis[specificKey]) ??
      this.cleanSnowflake(backup.session.discordConfig?.resultsChannelId)
    );
  }

  private discordToken() {
    const token =
      process.env.DISCORD_BOT_TOKEN?.trim() ||
      process.env.DISCORD_TOKEN?.trim() ||
      process.env.BOT_TOKEN?.trim();
    if (!token) {
      throw new InternalServerErrorException(
        'Discord bot token is not configured',
      );
    }
    return token;
  }

  private cleanSnowflake(value: unknown) {
    const text = this.cleanString(value);
    return text && /^\d{15,25}$/.test(text) ? text : null;
  }

  private cleanString(value: unknown) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  private readOptionalInt(value: unknown, opts: { min: number; max: number }) {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    return this.readInt(value, 0, opts);
  }

  private readInt(
    value: unknown,
    fallback: number,
    opts: { min: number; max: number },
  ) {
    const parsed =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Number.parseInt(value, 10)
          : Number.NaN;
    const result = Number.isFinite(parsed) ? parsed : fallback;
    return Math.max(opts.min, Math.min(opts.max, result));
  }

  private readNullableBoolean(value: unknown) {
    return typeof value === 'boolean' ? value : null;
  }
}

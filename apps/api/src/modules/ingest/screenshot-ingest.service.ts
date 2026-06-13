import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../../common/auth/auth.types';
import { isSessionMatch } from '../../common/match-context.util';
import { organizationAllowsAiScreenshotParsing } from '../../common/org/organization-plan.util';
import { PrismaService } from '../../db/prisma.service';
import { ResultsService } from '../results/results.service';
import { ResultBackupsService } from '../result-backups/result-backups.service';
import type {
  ApplyScreenshotResultEntryDto,
  ApplyScreenshotResultsDto,
} from './dto/apply-screenshot-results.dto';
import { ScreenshotPreviewStatusDto } from './dto/apply-screenshot-results.dto';
import type { IngestScreenshotDto } from './dto/ingest-screenshot.dto';
import type { IngestSlotMapScreenshotDto } from './dto/ingest-slot-map-screenshot.dto';
import {
  ScreenshotParserService,
  type ParsedSlotMapRow,
  type ParsedScreenshotPlayer,
  type ParsedScreenshotRow,
} from './screenshot-parser.service';
import { syncMatchSlotsWithSessionRegistrations } from '../sessions/session-match-slot-sync';

type PreviewStatus = 'OK' | 'UNRESOLVED' | 'AMBIGUOUS';

type PreviewItem = {
  position: number;
  tag: string;
  kills: number;
  players?: ParsedScreenshotPlayer[];
  teamName?: string | null;
  teamId: string | null;
  slotId: string | null;
  slotNumber: number | null;
  status: PreviewStatus;
  reason?: string;
  candidateTeamIds?: string[];
  playerNames?: string[];
  confidence?: number | null;
  matchEvidence?: string;
  ocrTag?: string;
};

type ScreenshotOcrMode = 'AI' | 'BASIC' | 'MANUAL';

type AppliedScreenshotResultSummary = {
  position: number;
  teamName: string | null;
  tag: string;
  kills: number;
  placementPoints: number;
  totalPoints: number;
  slotNumber: number;
  teamId: string | null;
};

type SlotMapPreviewItem = {
  slotNumber: number;
  tag: string | null;
  playerNames: string[];
  teamId: string | null;
  slotId: string | null;
  status: PreviewStatus;
  reason?: string;
  confidence?: number | null;
};

type MatchSlotLookup = {
  id: string;
  teamId: string | null;
  slotNumber: number;
  team?: {
    id: string;
    name?: string | null;
    tag: string | null;
  } | null;
};

type OcrSlotMappingEntry = {
  slotNumber: number;
  teamId: string;
  teamTag: string | null;
  teamAliases?: string[];
  playerNames: string[];
  sourceImageUrl: string;
  confidence: number | null;
  updatedAt: string;
};

type OcrMeta = {
  slotMappings?: OcrSlotMappingEntry[];
  sourceImages?: string[];
  updatedAt?: string;
};

type ResolutionCandidate = {
  teamId: string;
  slotId: string;
  slotNumber: number;
  tag: string | null;
  teamName: string | null;
  score: number;
  evidence: string;
};

type OfficialTagOwners = Map<string, Set<string>>;

@Injectable()
export class ScreenshotIngestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly parser: ScreenshotParserService,
    private readonly results: ResultsService,
    @Optional() private readonly resultBackups?: ResultBackupsService,
  ) {}

  private requireMatchOrganizationId(match: {
    organizationId?: string | null;
    tournament?: { organizationId?: string | null } | null;
  }): string {
    const organizationId =
      match.organizationId ?? match.tournament?.organizationId ?? null;
    if (!organizationId) {
      throw new BadRequestException(
        'organizationId is required for screenshot ingest',
      );
    }
    return organizationId;
  }

  private assertSupportedMatch(match: {
    sessionId?: string | null;
    dataSource?: string | null;
    dataMode?: string | null;
  }) {
    if (isSessionMatch(match) || this.results.isManualSource(match)) {
      return;
    }
    throw new BadRequestException(
      'Screenshot ingest supports session matches or MANUAL matches only',
    );
  }

  private async refreshSessionMatchSlots(match: {
    id: string;
    sessionId?: string | null;
    organizationId?: string | null;
    tournament?: { organizationId?: string | null } | null;
    dataSource?: string | null;
    dataMode?: string | null;
  }) {
    if (!match.sessionId) {
      return null;
    }
    const organizationId = this.requireMatchOrganizationId(match);
    return syncMatchSlotsWithSessionRegistrations(this.prisma, {
      sessionId: match.sessionId,
      organizationId,
      matchId: match.id,
      dataMode: match.dataMode,
      dataSource: match.dataSource,
    });
  }

  private async screenshotOcrModeForOrganization(
    organizationId: string,
  ): Promise<'AI' | 'BASIC'> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        planId: true,
        enabledAddOns: true,
      },
    });
    if (!organization || organizationAllowsAiScreenshotParsing(organization)) {
      return 'AI';
    }
    return 'BASIC';
  }

  private splitPreview(preview: PreviewItem[]) {
    return {
      resolved: preview.filter((item) => item.status === 'OK'),
      unresolved: preview.filter((item) => item.status === 'UNRESOLVED'),
      ambiguous: preview.filter((item) => item.status === 'AMBIGUOUS'),
    };
  }

  private screenshotImageUrls(dto: {
    imageUrl?: string | null;
    imageUrls?: string[] | null;
  }) {
    const urls = [
      dto.imageUrl,
      ...(Array.isArray(dto.imageUrls) ? dto.imageUrls : []),
    ]
      .map((url) => (typeof url === 'string' ? url.trim() : ''))
      .filter(Boolean);
    const uniqueUrls = [...new Set(urls)];
    if (!uniqueUrls.length) {
      throw new BadRequestException(
        'At least one screenshot image is required',
      );
    }
    if (uniqueUrls.length > 10) {
      throw new BadRequestException('At most 10 screenshot images are allowed');
    }
    return uniqueUrls;
  }

  private assertUniqueApplyEntries(results: ApplyScreenshotResultEntryDto[]) {
    const teamIds = new Set<string>();
    const slotIds = new Set<string>();
    const positions = new Set<number>();

    for (const entry of results) {
      if (!entry.teamId) {
        throw new BadRequestException(
          `teamId is required for tag ${entry.tag}`,
        );
      }
      if (!entry.slotId) {
        throw new BadRequestException(
          `slotId is required for tag ${entry.tag}`,
        );
      }
      if (teamIds.has(entry.teamId)) {
        throw new BadRequestException(
          `Duplicate teamId in apply payload: ${entry.teamId}`,
        );
      }
      if (slotIds.has(entry.slotId)) {
        throw new BadRequestException(
          `Duplicate slotId in apply payload: ${entry.slotId}`,
        );
      }
      if (positions.has(entry.position)) {
        throw new BadRequestException(
          `Duplicate placement in apply payload: ${entry.position}`,
        );
      }
      teamIds.add(entry.teamId);
      slotIds.add(entry.slotId);
      positions.add(entry.position);
    }
  }

  private assertNoMissingApplyPlacements(
    results: ApplyScreenshotResultEntryDto[],
  ) {
    const positions = results
      .map((entry) => entry.position)
      .filter((position) => Number.isInteger(position) && position > 0);
    if (!positions.length) {
      return;
    }

    const seen = new Set(positions);
    const maxPosition = Math.max(...positions);
    const missing: number[] = [];
    for (let position = 1; position <= maxPosition; position += 1) {
      if (!seen.has(position)) {
        missing.push(position);
      }
    }

    if (!missing.length) {
      return;
    }

    const visible = missing.slice(0, 12).join(', ');
    const remaining = missing.length - 12;
    throw new BadRequestException(
      `Cannot apply screenshot results with missing placement rows: ${
        remaining > 0 ? `${visible}, +${remaining} more` : visible
      }`,
    );
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private normalizeKey(value: string | null | undefined): string {
    return (value ?? '').trim().toLowerCase();
  }

  private normalizeName(value: string | null | undefined): string {
    return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  private normalizeOcrTagKey(value: string | null | undefined): string {
    return (value ?? '')
      .normalize('NFKD')
      .replace(/[\u00d8\u00f8]/g, 'o')
      .replace(/[\u0110\u0111\u00d0\u00f0]/g, 'd')
      .replace(/[\u0141\u0142\u019a\u023d\u026b\u026c\u026d\u2c62]/g, 'l')
      .replace(/[\u00de\u00fe]/g, 'th')
      .replace(/[\u00c6\u00e6]/g, 'ae')
      .replace(/[Øø]/g, 'o')
      .replace(/[ĐđÐð]/g, 'd')
      .replace(/[Łł]/g, 'l')
      .replace(/[Þþ]/g, 'th')
      .replace(/[Ææ]/g, 'ae')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  }

  private teamTagRoots(value: string | null | undefined): string[] {
    const tag = this.normalizeOcrTagKey(value);
    if (!tag) {
      return [];
    }
    const roots = [tag];
    const withoutTrailingDigits = tag.replace(/\d+$/g, '');
    if (
      withoutTrailingDigits &&
      withoutTrailingDigits !== tag &&
      withoutTrailingDigits.length >= 2
    ) {
      roots.push(withoutTrailingDigits);
    }
    return [...new Set(roots)].sort(
      (left, right) => right.length - left.length,
    );
  }

  private tokenizeOcrText(value: string | null | undefined): string[] {
    return (value ?? '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .split(/[^a-z0-9]+/g)
      .filter(Boolean);
  }

  private normalizePlayerIdentityKey(value: string | null | undefined): string {
    return this.normalizeOcrTagKey(value);
  }

  private normalizeScreenshotPlayers(
    players:
      | ApplyScreenshotResultEntryDto['players']
      | ParsedScreenshotPlayer[]
      | undefined,
  ): ParsedScreenshotPlayer[] {
    const normalized: ParsedScreenshotPlayer[] = [];
    for (const player of players ?? []) {
      const name = typeof player.name === 'string' ? player.name.trim() : '';
      const kills = Number(player.kills);
      if (!name || name.length > 80 || !Number.isInteger(kills) || kills < 0) {
        continue;
      }
      const existing = normalized.find(
        (entry) => this.normalizeName(entry.name) === this.normalizeName(name),
      );
      if (existing) {
        existing.kills = Math.max(existing.kills, kills);
        continue;
      }
      normalized.push({ name, kills });
    }
    return normalized.slice(0, 8);
  }

  private async clearConflictingScreenshotPlacements(
    tx: Prisma.TransactionClient,
    matchId: string,
    appliedSlotNumbers: number[],
    appliedPositions: number[],
  ) {
    const positions = Array.from(
      new Set(appliedPositions.filter((position) => position > 0)),
    );
    if (!positions.length) {
      return;
    }

    const staleRows = await tx.matchSlotResult.findMany({
      where: {
        matchId,
        teamId: { not: null },
        slotNumber: { notIn: appliedSlotNumbers },
        placement: { in: positions },
      },
      select: {
        id: true,
      },
    });
    const staleIds = staleRows.map((row) => row.id);
    if (!staleIds.length) {
      return;
    }

    await tx.matchSlotPlayerResult.updateMany({
      where: {
        slotResultId: { in: staleIds },
      },
      data: {
        kills: 0,
        knocks: 0,
        assists: 0,
      },
    });
    await tx.matchSlotResult.updateMany({
      where: {
        id: { in: staleIds },
      },
      data: {
        placement: null,
        finalPlacement: null,
        eliminatedOrder: null,
        eliminatedAt: null,
        isLocked: false,
        totalKills: 0,
        finalKills: 0,
        manualTotalKills: false,
        placementPoints: 0,
        points: 0,
        totalPoints: 0,
      },
    });
  }

  private async markMappedSlotsPresent(
    matchId: string,
    mapped: Array<{ slotNumber: number; teamId: string | null }>,
  ) {
    const mappedSlots = mapped.filter(
      (entry): entry is { slotNumber: number; teamId: string } =>
        Number.isInteger(entry.slotNumber) && Boolean(entry.teamId),
    );
    if (!mappedSlots.length) {
      return;
    }

    await this.results.ensureResultsFromSlots(matchId);
    for (const entry of mappedSlots) {
      await this.prisma.matchSlotResult.updateMany({
        where: {
          matchId,
          slotNumber: entry.slotNumber,
          teamId: entry.teamId,
        },
        data: {
          wasPresentInMatch: true,
        },
      });
    }
  }

  private buildAppliedOcrMapping(
    entry: ApplyScreenshotResultEntryDto,
    slot: {
      slotNumber: number;
      teamId: string | null;
      team?: { tag?: string | null } | null;
    },
    officialTagOwners: OfficialTagOwners = new Map(),
  ): OcrSlotMappingEntry | null {
    if (!slot.teamId || slot.teamId !== entry.teamId) {
      return null;
    }

    const officialTag = slot.team?.tag ?? null;
    const officialTagKey = this.normalizeOcrTagKey(officialTag);
    const aliases = this.safeOcrAliasesForTeam(
      this.normalizeAliasList(entry.ocrTag).filter(
        (alias) => this.normalizeOcrTagKey(alias) !== officialTagKey,
      ),
      slot.teamId,
      officialTagOwners,
    );
    const playerNames = this.uniquePlayerNames(
      entry.ocrPlayerNames,
      entry.playerNames,
      entry.players?.map((player) => player.name),
    );

    if (!aliases.length && !playerNames.length) {
      return null;
    }

    return {
      slotNumber: slot.slotNumber,
      teamId: slot.teamId,
      teamTag: officialTag,
      ...(aliases.length ? { teamAliases: aliases } : {}),
      playerNames,
      sourceImageUrl: 'result-review',
      confidence: null,
      updatedAt: new Date().toISOString(),
    };
  }

  private async markMissingSlotsNoShow(
    tx: Prisma.TransactionClient,
    matchId: string,
    appliedSlotNumbers: number[],
  ): Promise<Set<string>> {
    const appliedSlots = new Set(appliedSlotNumbers);
    const assignedSlots = await tx.matchSlot.findMany({
      where: { matchId, deletedAt: null, teamId: { not: null } },
      select: { slotNumber: true, teamId: true },
    });
    const missingAssignedSlots = assignedSlots.filter(
      (slot) => slot.teamId && !appliedSlots.has(slot.slotNumber),
    );

    if (!missingAssignedSlots.length) {
      return new Set();
    }

    const noShowSlotNumbers = missingAssignedSlots.map(
      (slot) => slot.slotNumber,
    );

    if (!noShowSlotNumbers.length) {
      return new Set();
    }

    const noShowRows = await tx.matchSlotResult.findMany({
      where: { matchId, slotNumber: { in: noShowSlotNumbers } },
      select: { id: true, teamId: true },
    });
    const rowIds = noShowRows.map((row) => row.id);
    if (!rowIds.length) {
      return new Set();
    }

    await tx.matchSlotPlayerResult.updateMany({
      where: { slotResultId: { in: rowIds } },
      data: {
        kills: 0,
        knocks: 0,
        assists: 0,
        isKnocked: false,
        isAlive: false,
        alive: false,
      },
    });
    await tx.matchSlotResult.updateMany({
      where: { id: { in: rowIds } },
      data: {
        wasPresentInMatch: false,
        placement: null,
        finalPlacement: null,
        eliminatedOrder: null,
        eliminatedAt: null,
        isLocked: true,
        totalKills: 0,
        finalKills: 0,
        manualTotalKills: false,
        placementPoints: 0,
        points: 0,
        totalPoints: 0,
      },
    });

    return new Set(
      noShowRows
        .map((row) => row.teamId)
        .filter((teamId): teamId is string => Boolean(teamId)),
    );
  }

  private async loadAppliedResultSummary(
    matchId: string,
    slotNumbers: number[],
  ): Promise<AppliedScreenshotResultSummary[]> {
    if (!slotNumbers.length) {
      return [];
    }

    const rows = await this.prisma.matchSlotResult.findMany({
      where: {
        matchId,
        slotNumber: { in: slotNumbers },
        teamId: { not: null },
      },
      select: {
        slotNumber: true,
        teamId: true,
        placement: true,
        totalKills: true,
        placementPoints: true,
        totalPoints: true,
        points: true,
        team: {
          select: {
            name: true,
            tag: true,
          },
        },
      },
    });

    return rows
      .map(
        (row): AppliedScreenshotResultSummary => ({
          position: row.placement ?? row.slotNumber,
          teamName: row.team?.name ?? null,
          tag: row.team?.tag ?? row.team?.name ?? `SLOT ${row.slotNumber}`,
          kills: Math.max(0, row.totalKills ?? 0),
          placementPoints: Math.max(0, row.placementPoints ?? 0),
          totalPoints: Math.max(0, row.totalPoints ?? row.points ?? 0),
          slotNumber: row.slotNumber,
          teamId: row.teamId ?? null,
        }),
      )
      .sort((left, right) => {
        if (left.position !== right.position) {
          return left.position - right.position;
        }
        if (right.totalPoints !== left.totalPoints) {
          return right.totalPoints - left.totalPoints;
        }
        return right.kills - left.kills;
      });
  }

  private async reconcileScreenshotPlayerKills(
    tx: Prisma.TransactionClient,
    slotResult: {
      id: string;
      organizationId: string;
    },
    players: ParsedScreenshotPlayer[],
  ) {
    if (!players.length) {
      return;
    }

    const existingPlayers = await tx.matchSlotPlayerResult.findMany({
      where: { slotResultId: slotResult.id },
      select: {
        id: true,
        playerName: true,
        playerId: true,
        pubgAccountId: true,
        externalPlayerId: true,
      },
    });
    const existingByName = new Map(
      existingPlayers.map((player) => [
        this.normalizeName(player.playerName),
        player,
      ]),
    );
    const keepIds: string[] = [];

    for (const player of players) {
      const existing = existingByName.get(this.normalizeName(player.name));
      if (existing) {
        await tx.matchSlotPlayerResult.update({
          where: { id: existing.id },
          data: {
            kills: player.kills,
          },
        });
        keepIds.push(existing.id);
        continue;
      }

      const created = await tx.matchSlotPlayerResult.create({
        data: {
          slotResultId: slotResult.id,
          organizationId: slotResult.organizationId,
          playerName: player.name,
          kills: player.kills,
          knocks: 0,
          assists: 0,
          isKnocked: false,
          isAlive: false,
          alive: false,
          isAutoFilled: true,
        },
        select: { id: true },
      });
      keepIds.push(created.id);
    }

    await tx.matchSlotPlayerResult.updateMany({
      where: {
        slotResultId: slotResult.id,
        id: { notIn: keepIds },
      },
      data: { kills: 0 },
    });
  }

  private fuzzyTagScore(
    detectedTag: string | null | undefined,
    officialTag: string | null | undefined,
  ): number | null {
    const detected = this.normalizeOcrTagKey(detectedTag);
    const official = this.normalizeOcrTagKey(officialTag);
    if (
      !detected ||
      !official ||
      detected === official ||
      official.length < 2
    ) {
      return null;
    }
    if (!detected.startsWith(official)) {
      if (
        detected.length >= 3 &&
        official.startsWith(detected) &&
        /^\d+$/.test(official.slice(detected.length))
      ) {
        return 93;
      }
      return null;
    }

    const suffix = detected.slice(official.length);
    if (!suffix || suffix.length > 2) {
      return null;
    }
    if (suffix === 'x') {
      return 90;
    }
    if (/^\d+$/.test(suffix) && /^[a-z]+$/.test(official)) {
      return 90;
    }
    return null;
  }

  private rootTagScore(
    detectedTag: string | null | undefined,
    officialTag: string | null | undefined,
  ): number | null {
    const detected = this.normalizeOcrTagKey(detectedTag);
    if (!detected) {
      return null;
    }
    for (const root of this.teamTagRoots(officialTag)) {
      if (root.length < 3) {
        continue;
      }
      if (detected === root) {
        return 94;
      }
      if (detected.length >= 3 && root.startsWith(detected)) {
        return 92;
      }
      if (detected.startsWith(root)) {
        return 90;
      }
    }
    return null;
  }

  private oneCharacterTagTypoScore(
    detectedTag: string | null | undefined,
    officialTag: string | null | undefined,
  ): number | null {
    const detected = this.normalizeOcrTagKey(detectedTag);
    const official = this.normalizeOcrTagKey(officialTag);
    if (
      detected.length < 4 ||
      official.length < 4 ||
      detected.length !== official.length ||
      detected === official
    ) {
      return null;
    }

    let differences = 0;
    for (let index = 0; index < detected.length; index += 1) {
      if (detected[index] !== official[index]) {
        differences += 1;
        if (differences > 1) {
          return null;
        }
      }
    }
    return differences === 1 ? 90 : null;
  }

  private isCommonOcrTagConfusion(
    detectedCharacter: string,
    officialCharacter: string,
  ) {
    if (detectedCharacter === officialCharacter) {
      return true;
    }
    const groups = [
      new Set(['0', 'o', 'q']),
      new Set(['0', 'o', 'p']),
      new Set(['1', 'i', 'l', 'x']),
      new Set(['2', 'z']),
      new Set(['3', 'e']),
      new Set(['4', 'a']),
      new Set(['5', 's']),
      new Set(['6', 'g']),
      new Set(['7', 't']),
      new Set(['8', 'b']),
      new Set(['9', 'g', 'q']),
    ];
    return groups.some(
      (group) => group.has(detectedCharacter) && group.has(officialCharacter),
    );
  }

  private commonOcrConfusionScore(
    detectedTag: string | null | undefined,
    officialTag: string | null | undefined,
  ): number | null {
    const detected = this.normalizeOcrTagKey(detectedTag);
    const official = this.normalizeOcrTagKey(officialTag);
    if (
      detected.length < 2 ||
      official.length < 2 ||
      detected.length !== official.length ||
      detected === official
    ) {
      return null;
    }

    let confusedCharacters = 0;
    for (let index = 0; index < detected.length; index += 1) {
      if (detected[index] === official[index]) {
        continue;
      }
      if (!this.isCommonOcrTagConfusion(detected[index], official[index])) {
        return null;
      }
      confusedCharacters += 1;
      if (confusedCharacters > 1) {
        return null;
      }
    }

    if (confusedCharacters !== 1) {
      return null;
    }
    return official.length <= 2 ? 88 : 89;
  }

  private commonOcrConfusedMergedPrefixScore(
    detectedTag: string | null | undefined,
    officialTag: string | null | undefined,
  ): number | null {
    const detected = this.normalizeOcrTagKey(detectedTag);
    const official = this.normalizeOcrTagKey(officialTag);
    if (
      detected.length <= official.length ||
      official.length < 2 ||
      detected.startsWith(official)
    ) {
      return null;
    }
    const prefix = detected.slice(0, official.length);
    const suffix = detected.slice(official.length);
    if (suffix.length < 2 || !/[a-z]/.test(suffix)) {
      return null;
    }
    const score = this.commonOcrConfusionScore(prefix, official);
    return score === null ? null : 86;
  }

  private leadingDecoratedTagScore(
    detectedTag: string | null | undefined,
    officialTag: string | null | undefined,
  ): number | null {
    const detected = this.normalizeOcrTagKey(detectedTag);
    const official = this.normalizeOcrTagKey(officialTag);
    if (
      official.length < 3 ||
      detected.length <= official.length ||
      detected.startsWith(official)
    ) {
      return null;
    }

    for (const prefixLength of [1, 2]) {
      const withoutPrefix = detected.slice(prefixLength);
      if (withoutPrefix === official) {
        return 88;
      }
    }
    return null;
  }

  private leadingDecoratedMergedPrefixScore(
    detectedTag: string | null | undefined,
    officialTag: string | null | undefined,
  ): number | null {
    const detected = this.normalizeOcrTagKey(detectedTag);
    const official = this.normalizeOcrTagKey(officialTag);
    if (
      official.length < 3 ||
      detected.length <= official.length ||
      detected.startsWith(official)
    ) {
      return null;
    }

    for (const prefixLength of [1, 2]) {
      const withoutPrefix = detected.slice(prefixLength);
      if (!withoutPrefix.startsWith(official)) {
        continue;
      }
      const suffix = withoutPrefix.slice(official.length);
      if (suffix.length >= 2 && /[a-z]/.test(suffix)) {
        return 85;
      }
    }
    return null;
  }

  private mergedTagPrefixScore(
    detectedTag: string | null | undefined,
    officialTag: string | null | undefined,
  ): number | null {
    const detected = this.normalizeOcrTagKey(detectedTag);
    const official = this.normalizeOcrTagKey(officialTag);
    if (
      !detected ||
      !official ||
      detected === official ||
      official.length < 2 ||
      (official.length >= 3 && !/^[a-z]+$/.test(official)) ||
      !detected.startsWith(official)
    ) {
      return null;
    }

    const suffix = detected.slice(official.length);
    if (suffix.length < 3 || !/[a-z]/.test(suffix)) {
      return null;
    }
    return official.length <= 2 ? 86 : 87;
  }

  private delimitedTagSuffixScore(
    detectedTag: string | null | undefined,
    officialTag: string | null | undefined,
  ): number | null {
    const detected = this.normalizeOcrTagKey(detectedTag);
    const official = this.normalizeOcrTagKey(officialTag);
    if (
      !detected ||
      !official ||
      detected === official ||
      official.length < 2
    ) {
      return null;
    }

    const tokens = this.tokenizeOcrText(detectedTag);
    return tokens.length > 1 && tokens[tokens.length - 1] === official
      ? 88
      : null;
  }

  private tagMatchScore(
    detectedTag: string | null | undefined,
    officialTag: string | null | undefined,
  ): number | null {
    return (
      this.fuzzyTagScore(detectedTag, officialTag) ??
      this.rootTagScore(detectedTag, officialTag) ??
      this.commonOcrConfusionScore(detectedTag, officialTag) ??
      this.oneCharacterTagTypoScore(detectedTag, officialTag) ??
      this.mergedTagPrefixScore(detectedTag, officialTag) ??
      this.commonOcrConfusedMergedPrefixScore(detectedTag, officialTag) ??
      this.leadingDecoratedTagScore(detectedTag, officialTag) ??
      this.leadingDecoratedMergedPrefixScore(detectedTag, officialTag) ??
      this.delimitedTagSuffixScore(detectedTag, officialTag)
    );
  }

  private playerTagEvidenceCount(
    playerNames: string[],
    teamTag: string | null | undefined,
  ) {
    return playerNames.filter(
      (name) =>
        this.playerLooksLikeTeamTag(name, teamTag ?? null) ||
        this.playerNameStartsWithOcrTagPrefix(name, teamTag ?? null),
    ).length;
  }

  private contextualTagMatchScore(
    row: ParsedScreenshotRow,
    officialTag: string | null | undefined,
  ): number | null {
    const score = this.tagMatchScore(row.tag, officialTag);
    if (score === null) {
      return null;
    }

    const official = this.normalizeOcrTagKey(officialTag);
    if (official.length > 0 && official.length <= 2) {
      const supportingPlayers = this.playerTagEvidenceCount(
        row.playerNames,
        officialTag,
      );
      if (row.playerNames.length > 0 && supportingPlayers === 0) {
        return Math.min(score, 82);
      }
      if (supportingPlayers > 0) {
        return Math.max(score, 88 + Math.min(supportingPlayers, 3) * 4);
      }
    }

    return score;
  }

  private readOcrMeta(metaJson: unknown): OcrMeta {
    const meta = this.asRecord(metaJson);
    const ocr = this.asRecord(meta.ocr);
    const slotMappings = Array.isArray(ocr.slotMappings)
      ? ocr.slotMappings
          .map((entry) => this.normalizeStoredMapping(entry))
          .filter((entry): entry is OcrSlotMappingEntry => Boolean(entry))
      : [];
    const sourceImages = Array.isArray(ocr.sourceImages)
      ? ocr.sourceImages.filter(
          (entry): entry is string =>
            typeof entry === 'string' && entry.length > 0,
        )
      : [];
    return {
      slotMappings,
      sourceImages,
      updatedAt: typeof ocr.updatedAt === 'string' ? ocr.updatedAt : undefined,
    };
  }

  private normalizeStoredMapping(value: unknown): OcrSlotMappingEntry | null {
    const entry = this.asRecord(value);
    const slotNumber = Number(entry.slotNumber);
    const teamId = typeof entry.teamId === 'string' ? entry.teamId : '';
    if (!Number.isInteger(slotNumber) || slotNumber < 1 || !teamId) {
      return null;
    }
    const playerNames = Array.isArray(entry.playerNames)
      ? entry.playerNames
          .filter((name): name is string => typeof name === 'string')
          .map((name) => name.trim())
          .filter(Boolean)
      : [];
    const storedTeamAliases: readonly unknown[] = Array.isArray(
      entry.teamAliases,
    )
      ? (entry.teamAliases as readonly unknown[])
      : [];
    const storedAliases: readonly unknown[] = Array.isArray(entry.aliases)
      ? (entry.aliases as readonly unknown[])
      : [];
    const teamAliases = this.normalizeAliasList(
      ...storedTeamAliases,
      ...storedAliases,
    );
    return {
      slotNumber,
      teamId,
      teamTag: typeof entry.teamTag === 'string' ? entry.teamTag : null,
      ...(teamAliases.length ? { teamAliases } : {}),
      playerNames,
      sourceImageUrl:
        typeof entry.sourceImageUrl === 'string' ? entry.sourceImageUrl : '',
      confidence:
        typeof entry.confidence === 'number' &&
        Number.isFinite(entry.confidence)
          ? Math.max(0, Math.min(1, entry.confidence))
          : null,
      updatedAt:
        typeof entry.updatedAt === 'string'
          ? entry.updatedAt
          : new Date().toISOString(),
    };
  }

  private uniquePlayerNames(...groups: Array<readonly string[] | undefined>) {
    const result: string[] = [];
    for (const group of groups) {
      for (const value of group ?? []) {
        const name = typeof value === 'string' ? value.trim() : '';
        if (!name || name.length > 80) {
          continue;
        }
        if (
          !result.some(
            (entry) => this.normalizeName(entry) === this.normalizeName(name),
          )
        ) {
          result.push(name);
        }
      }
    }
    return result.slice(0, 24);
  }

  private normalizeAliasList(...values: unknown[]) {
    const result: string[] = [];
    const seen = new Set<string>();
    for (const value of values) {
      const alias = typeof value === 'string' ? value.trim() : '';
      const key = this.normalizeOcrTagKey(alias);
      if (!alias || key.length < 2 || seen.has(key)) {
        continue;
      }
      seen.add(key);
      result.push(alias.slice(0, 80));
    }
    return result.slice(0, 24);
  }

  private officialTagOwners(
    slots: Array<{
      teamId: string | null;
      team?: { tag?: string | null } | null;
    }>,
  ): OfficialTagOwners {
    const owners: OfficialTagOwners = new Map();
    for (const slot of slots) {
      if (!slot.teamId) {
        continue;
      }
      const key = this.normalizeOcrTagKey(slot.team?.tag ?? null);
      if (!key) {
        continue;
      }
      const teamIds = owners.get(key) ?? new Set<string>();
      teamIds.add(slot.teamId);
      owners.set(key, teamIds);
    }
    return owners;
  }

  private tagKeyBelongsToAnotherTeam(
    tagKey: string | null | undefined,
    teamId: string | null | undefined,
    owners: OfficialTagOwners,
  ) {
    if (!tagKey || !teamId) {
      return false;
    }
    const ownerTeamIds = owners.get(tagKey);
    if (!ownerTeamIds?.size) {
      return false;
    }
    for (const ownerTeamId of ownerTeamIds) {
      if (ownerTeamId !== teamId) {
        return true;
      }
    }
    return false;
  }

  private safeOcrAliasesForTeam(
    aliases: string[],
    teamId: string,
    officialTagOwners: OfficialTagOwners,
  ) {
    return aliases.filter((alias) => {
      const key = this.normalizeOcrTagKey(alias);
      return !this.tagKeyBelongsToAnotherTeam(key, teamId, officialTagOwners);
    });
  }

  private mergeOcrSlotMapping(
    existing: OcrSlotMappingEntry | null | undefined,
    incoming: OcrSlotMappingEntry,
  ): OcrSlotMappingEntry {
    if (!existing || existing.teamId !== incoming.teamId) {
      const teamAliases = this.normalizeAliasList(
        ...(incoming.teamAliases ?? []),
      );
      return {
        ...incoming,
        ...(teamAliases.length ? { teamAliases } : {}),
        playerNames: this.uniquePlayerNames(incoming.playerNames),
      };
    }

    const teamAliases = this.normalizeAliasList(
      ...(existing.teamAliases ?? []),
      ...(incoming.teamAliases ?? []),
    );
    return {
      slotNumber: incoming.slotNumber,
      teamId: incoming.teamId,
      teamTag: incoming.teamTag ?? existing.teamTag,
      ...(teamAliases.length ? { teamAliases } : {}),
      playerNames: this.uniquePlayerNames(
        existing.playerNames,
        incoming.playerNames,
      ),
      sourceImageUrl: incoming.sourceImageUrl || existing.sourceImageUrl,
      confidence: Math.max(existing.confidence ?? 0, incoming.confidence ?? 0),
      updatedAt: incoming.updatedAt,
    };
  }

  private mergeOcrSlotMappings(mappings: OcrSlotMappingEntry[]) {
    const merged = new Map<string, OcrSlotMappingEntry>();
    for (const entry of mappings) {
      const key = `${entry.slotNumber}:${entry.teamId}`;
      merged.set(key, this.mergeOcrSlotMapping(merged.get(key), entry));
    }
    return Array.from(merged.values()).sort((left, right) => {
      if (left.slotNumber !== right.slotNumber) {
        return left.slotNumber - right.slotNumber;
      }
      return left.teamId.localeCompare(right.teamId);
    });
  }

  private async getOcrSlotMappings(matchId: string, sessionId?: string | null) {
    const state = await this.prisma.matchControlState.findUnique({
      where: { matchId },
      select: { metaJson: true },
    });
    const mappings = [
      ...(this.readOcrMeta(state?.metaJson ?? null).slotMappings ?? []),
    ];

    if (sessionId) {
      const sessionMatches = await this.prisma.match.findMany({
        where: { sessionId, deletedAt: null },
        select: {
          id: true,
          controlState: {
            select: { metaJson: true },
          },
        },
      });
      for (const match of sessionMatches) {
        if (match.id === matchId) {
          continue;
        }
        mappings.push(
          ...(this.readOcrMeta(match.controlState?.metaJson ?? null)
            .slotMappings ?? []),
        );
      }
    }

    return this.mergeOcrSlotMappings(mappings);
  }

  private async saveOcrSlotMappings(
    matchId: string,
    organizationId: string,
    imageUrl: string,
    mappings: OcrSlotMappingEntry[],
  ) {
    const current = await this.prisma.matchControlState.findUnique({
      where: { matchId },
      select: { metaJson: true },
    });
    const currentMeta = this.asRecord(current?.metaJson ?? null);
    const currentOcr = this.readOcrMeta(current?.metaJson ?? null);
    const bySlot = new Map<number, OcrSlotMappingEntry>();
    for (const entry of currentOcr.slotMappings ?? []) {
      bySlot.set(entry.slotNumber, entry);
    }
    for (const entry of mappings) {
      bySlot.set(
        entry.slotNumber,
        this.mergeOcrSlotMapping(bySlot.get(entry.slotNumber), entry),
      );
    }

    const sourceImages = [...(currentOcr.sourceImages ?? []), imageUrl].filter(
      (value, index, values) =>
        Boolean(value) && values.indexOf(value) === index,
    );
    const nextMeta = {
      ...currentMeta,
      ocr: {
        ...this.asRecord(currentMeta.ocr),
        slotMappings: this.mergeOcrSlotMappings(Array.from(bySlot.values())),
        sourceImages: sourceImages.slice(-20),
        updatedAt: new Date().toISOString(),
      },
    } as Prisma.InputJsonObject;

    await this.prisma.matchControlState.upsert({
      where: { matchId },
      update: { metaJson: nextMeta },
      create: {
        matchId,
        organizationId,
        metaJson: nextMeta,
      },
    });
  }

  private async getMatchSlots(matchId: string): Promise<MatchSlotLookup[]> {
    return this.prisma.matchSlot.findMany({
      where: { matchId, deletedAt: null },
      select: {
        id: true,
        teamId: true,
        slotNumber: true,
        team: {
          select: {
            id: true,
            name: true,
            tag: true,
          },
        },
      },
      orderBy: { slotNumber: 'asc' },
    });
  }

  private teamTag(slot: MatchSlotLookup | null | undefined) {
    return slot?.team?.tag ?? null;
  }

  private candidateFromSlot(
    slot: MatchSlotLookup,
    score: number,
    evidence: string,
  ): ResolutionCandidate | null {
    if (!slot.teamId) {
      return null;
    }
    return {
      teamId: slot.teamId,
      slotId: slot.id,
      slotNumber: slot.slotNumber,
      tag: this.teamTag(slot),
      teamName: slot.team?.name ?? null,
      score,
      evidence,
    };
  }

  private playerLooksLikeTeamTag(playerName: string, teamTag: string | null) {
    const roots = this.teamTagRoots(teamTag);
    if (!roots.length) {
      return false;
    }
    const name = this.normalizeName(playerName);
    const nameKey = this.normalizeOcrTagKey(playerName);
    for (const root of roots) {
      if (
        nameKey === root ||
        nameKey.startsWith(root) ||
        name === root ||
        name.startsWith(`${root} `) ||
        name.startsWith(`${root}.`) ||
        name.startsWith(`${root}_`) ||
        name.startsWith(`${root}-`) ||
        name.startsWith(`${root}|`)
      ) {
        return true;
      }
    }
    return (
      this.playerNameEndsWithDelimitedTag(playerName, teamTag) ||
      this.playerNameStartsWithFuzzyTag(playerName, teamTag)
    );
  }

  private playerNameEndsWithDelimitedTag(
    playerName: string,
    teamTag: string | null,
  ) {
    return this.delimitedTagSuffixScore(playerName, teamTag) !== null;
  }

  private playerNameStartsWithFuzzyTag(
    playerName: string,
    teamTag: string | null,
  ) {
    const firstToken = this.normalizeName(playerName).split(/[\s._\-|]+/)[0];
    return (
      this.fuzzyTagScore(firstToken, teamTag) !== null ||
      this.rootTagScore(firstToken, teamTag) !== null ||
      this.commonOcrConfusionScore(firstToken, teamTag) !== null ||
      this.commonOcrConfusedMergedPrefixScore(firstToken, teamTag) !== null ||
      this.leadingDecoratedTagScore(firstToken, teamTag) !== null ||
      this.leadingDecoratedMergedPrefixScore(firstToken, teamTag) !== null
    );
  }

  private playerNameStartsWithOcrTagPrefix(
    playerName: string,
    teamTag: string | null,
  ) {
    const name = this.normalizeOcrTagKey(playerName);
    const roots = this.teamTagRoots(teamTag);
    if (!name || !roots.length) {
      return false;
    }
    return roots.some((tag) => {
      if (tag.length < 2) {
        return false;
      }
      const hasExactPrefix = name.startsWith(tag);
      const hasConfusedPrefix =
        tag.length >= 2 &&
        this.commonOcrConfusionScore(name.slice(0, tag.length), tag) !== null;
      const hasLeadingDecoratedPrefix =
        tag.length >= 3 &&
        this.leadingDecoratedMergedPrefixScore(name, tag) !== null;
      if (!hasExactPrefix && !hasConfusedPrefix && !hasLeadingDecoratedPrefix) {
        return false;
      }
      if (hasLeadingDecoratedPrefix) {
        return true;
      }
      if (name.length === tag.length) {
        return true;
      }
      const suffix = name.slice(tag.length);
      return suffix.length >= 2 && /[a-z]/.test(suffix);
    });
  }

  private storedPlayerNameMatches(left: string, right: string) {
    const leftName = this.normalizeName(left);
    const rightName = this.normalizeName(right);
    if (leftName && leftName === rightName) {
      return true;
    }

    const leftKey = this.normalizePlayerIdentityKey(left);
    const rightKey = this.normalizePlayerIdentityKey(right);
    if (!leftKey || !rightKey) {
      return false;
    }
    if (leftKey === rightKey) {
      return true;
    }

    const shorter = leftKey.length < rightKey.length ? leftKey : rightKey;
    const longer = leftKey.length < rightKey.length ? rightKey : leftKey;
    return shorter.length >= 5 && longer.includes(shorter);
  }

  private chooseCandidate(candidates: ResolutionCandidate[]) {
    if (!candidates.length) {
      return { status: 'UNRESOLVED' as const, candidate: null, ids: [] };
    }
    const byTeam = new Map<string, ResolutionCandidate>();
    for (const candidate of candidates) {
      const current = byTeam.get(candidate.teamId);
      if (!current || candidate.score > current.score) {
        byTeam.set(candidate.teamId, candidate);
      }
    }
    const ordered = Array.from(byTeam.values()).sort(
      (left, right) => right.score - left.score,
    );
    const best = ordered[0];
    if (best.score < 85) {
      return {
        status: 'UNRESOLVED' as const,
        candidate: null,
        ids: ordered.map((entry) => entry.teamId),
      };
    }
    const tied = ordered.filter((entry) => entry.score === best.score);
    if (tied.length > 1) {
      return {
        status: 'AMBIGUOUS' as const,
        candidate: null,
        ids: tied.map((entry) => entry.teamId),
      };
    }
    const second = ordered[1] ?? null;
    if (second && best.score - second.score < 6) {
      return {
        status: 'AMBIGUOUS' as const,
        candidate: null,
        ids: ordered.map((entry) => entry.teamId),
      };
    }
    return { status: 'OK' as const, candidate: best, ids: [] };
  }

  private rowNeedsManualReview(row: ParsedScreenshotRow) {
    return (row.ocrIssues?.length ?? 0) > 0;
  }

  private ocrIssueReason(row: ParsedScreenshotRow) {
    if (row.ocrIssues?.includes('POSITION_UNREADABLE')) {
      return 'OCR_POSITION_UNREADABLE';
    }
    if (row.ocrIssues?.includes('KILLS_UNREADABLE')) {
      return 'OCR_KILLS_UNREADABLE';
    }
    return 'OCR_ROW_NEEDS_REVIEW';
  }

  private displayTag(
    row: ParsedScreenshotRow,
    candidate?: ResolutionCandidate | null,
  ) {
    return (
      candidate?.tag ??
      row.tag ??
      (row.slotNumber ? `Slot ${row.slotNumber}` : null) ??
      row.playerNames[0] ??
      `Row ${row.position}`
    );
  }

  private rawOcrTagForResponse(
    row: ParsedScreenshotRow,
    candidate?: ResolutionCandidate | null,
  ) {
    const rawTag = row.tag?.trim();
    if (!rawTag || !candidate?.tag) {
      return null;
    }
    if (
      this.normalizeOcrTagKey(rawTag) === this.normalizeOcrTagKey(candidate.tag)
    ) {
      return null;
    }

    const supportingScore = this.tagMatchScore(rawTag, candidate.tag);

    return supportingScore === null ? null : rawTag;
  }

  private resolveResultRow(
    row: ParsedScreenshotRow,
    slots: MatchSlotLookup[],
    storedMappings: OcrSlotMappingEntry[],
  ) {
    const candidates: ResolutionCandidate[] = [];
    const slotsByNumber = new Map(slots.map((slot) => [slot.slotNumber, slot]));
    const officialTagOwners = this.officialTagOwners(slots);

    if (row.slotNumber) {
      const slot = slotsByNumber.get(row.slotNumber);
      const candidate = slot
        ? row.slotNumber === row.position
          ? null
          : this.candidateFromSlot(slot, 82, 'slot-number')
        : null;
      if (candidate) {
        candidates.push(candidate);
      }
    }

    const rowTagKey = this.normalizeOcrTagKey(row.tag);
    if (rowTagKey) {
      let exactTagMatch = false;
      const exactTagCandidates: ResolutionCandidate[] = [];
      for (const slot of slots) {
        if (
          slot.teamId &&
          this.normalizeOcrTagKey(this.teamTag(slot)) === rowTagKey
        ) {
          const supportingPlayers = row.playerNames.filter((name) =>
            this.playerLooksLikeTeamTag(name, this.teamTag(slot)),
          ).length;
          const score =
            row.playerNames.length > 0 && supportingPlayers === 0
              ? 82
              : 95 + Math.min(supportingPlayers, 3);
          const candidate = this.candidateFromSlot(slot, score, 'team-tag');
          if (candidate) {
            exactTagMatch = true;
            candidates.push(candidate);
            exactTagCandidates.push(candidate);
          }
        }
      }
      if (
        exactTagCandidates.length === 1 &&
        exactTagCandidates[0].score >= 95
      ) {
        return {
          status: 'OK' as const,
          candidate: exactTagCandidates[0],
          ids: [],
        };
      }
      if (!exactTagMatch) {
        for (const slot of slots) {
          const score = this.contextualTagMatchScore(row, this.teamTag(slot));
          if (!slot.teamId || score === null) {
            continue;
          }
          const candidate = this.candidateFromSlot(
            slot,
            score,
            'team-tag-fuzzy',
          );
          if (candidate) {
            candidates.push(candidate);
          }
        }
      }
    }

    for (const mapping of storedMappings) {
      const slot = slotsByNumber.get(mapping.slotNumber);
      if (!slot?.teamId || slot.teamId !== mapping.teamId) {
        continue;
      }
      if (
        rowTagKey &&
        (mapping.teamAliases ?? []).some(
          (alias) => this.normalizeOcrTagKey(alias) === rowTagKey,
        ) &&
        !this.tagKeyBelongsToAnotherTeam(
          rowTagKey,
          mapping.teamId,
          officialTagOwners,
        )
      ) {
        const candidate = this.candidateFromSlot(slot, 94, 'saved-team-alias');
        if (candidate) {
          candidates.push(candidate);
        }
      }

      const hits = row.playerNames.filter((rowName) =>
        mapping.playerNames.some((mappingName) =>
          this.storedPlayerNameMatches(rowName, mappingName),
        ),
      );
      if (hits.length > 0) {
        const candidate = this.candidateFromSlot(
          slot,
          82 + hits.length * 4,
          'saved-player-map',
        );
        if (candidate) {
          candidates.push(candidate);
        }
      }
    }

    for (const slot of slots) {
      if (!slot.teamId) {
        continue;
      }
      const exactishHits = row.playerNames.filter((name) =>
        this.playerLooksLikeTeamTag(name, this.teamTag(slot)),
      );
      if (exactishHits.length > 0) {
        const candidate = this.candidateFromSlot(
          slot,
          82 + Math.min(exactishHits.length, 4) * 5,
          'player-name-tag',
        );
        if (candidate) {
          candidates.push(candidate);
        }
      }

      const prefixHits = row.playerNames.filter((name) =>
        this.playerNameStartsWithOcrTagPrefix(name, this.teamTag(slot)),
      );
      if (prefixHits.length > 0) {
        const candidate = this.candidateFromSlot(
          slot,
          84 + Math.min(prefixHits.length, 4) * 6,
          'player-name-tag-prefix',
        );
        if (candidate) {
          candidates.push(candidate);
        }
      }
    }

    return this.chooseCandidate(candidates);
  }

  private async buildPreview(
    matchId: string,
    organizationId: string,
    rows: ParsedScreenshotRow[],
    sessionId?: string | null,
    ocrMode: ScreenshotOcrMode = 'AI',
  ) {
    void organizationId;
    const [slots, storedMappings] = await Promise.all([
      this.getMatchSlots(matchId),
      this.getOcrSlotMappings(matchId, sessionId),
    ]);

    const preview = rows.map<PreviewItem>((row) => {
      const resolution = this.resolveResultRow(row, slots, storedMappings);
      if (this.rowNeedsManualReview(row)) {
        const candidate = resolution.candidate;
        const ocrTag = this.rawOcrTagForResponse(row, candidate);
        return {
          position: row.position,
          tag: this.displayTag(row, candidate),
          kills: row.kills,
          ...(candidate?.teamName ? { teamName: candidate.teamName } : {}),
          teamId: candidate?.teamId ?? null,
          slotId: candidate?.slotId ?? null,
          slotNumber: candidate?.slotNumber ?? null,
          status: 'UNRESOLVED',
          reason: this.ocrIssueReason(row),
          playerNames: row.playerNames,
          ...(row.players?.length ? { players: row.players } : {}),
          confidence: row.confidence,
          ...(candidate ? { matchEvidence: candidate.evidence } : {}),
          ...(ocrTag ? { ocrTag } : {}),
        };
      }
      if (resolution.status === 'AMBIGUOUS') {
        return {
          position: row.position,
          tag: this.displayTag(row),
          kills: row.kills,
          teamId: null,
          slotId: null,
          slotNumber: null,
          status: 'AMBIGUOUS',
          reason: 'MULTIPLE_TEAMS_FOR_SCREENSHOT_ROW',
          candidateTeamIds: resolution.ids,
          playerNames: row.playerNames,
          ...(row.players?.length ? { players: row.players } : {}),
          confidence: row.confidence,
        };
      }
      if (!resolution.candidate) {
        return {
          position: row.position,
          tag: this.displayTag(row),
          kills: row.kills,
          teamId: null,
          slotId: null,
          slotNumber: null,
          status: 'UNRESOLVED',
          reason: row.tag ? 'TEAM_TAG_NOT_FOUND' : 'TEAM_EVIDENCE_NOT_MATCHED',
          playerNames: row.playerNames,
          ...(row.players?.length ? { players: row.players } : {}),
          confidence: row.confidence,
        };
      }

      const ocrTag = this.rawOcrTagForResponse(row, resolution.candidate);
      return {
        position: row.position,
        tag: this.displayTag(row, resolution.candidate),
        kills: row.kills,
        ...(resolution.candidate.teamName
          ? { teamName: resolution.candidate.teamName }
          : {}),
        teamId: resolution.candidate.teamId,
        slotId: resolution.candidate.slotId,
        slotNumber: resolution.candidate.slotNumber,
        status: 'OK',
        playerNames: row.playerNames,
        ...(row.players?.length ? { players: row.players } : {}),
        confidence: row.confidence,
        matchEvidence: resolution.candidate.evidence,
        ...(ocrTag ? { ocrTag } : {}),
      };
    });

    const ordered = preview.sort((left, right) => {
      if (left.position !== right.position) {
        return left.position - right.position;
      }
      return left.tag.localeCompare(right.tag);
    });

    return {
      matchId,
      sessionId: sessionId ?? null,
      ocrMode,
      preview: ordered,
      ...this.splitPreview(ordered),
      slots: slots.map((slot) => ({
        id: slot.id,
        matchId,
        slotNumber: slot.slotNumber,
        teamId: slot.teamId,
        team: slot.team
          ? {
              id: slot.team.id,
              name: slot.team.name ?? null,
              tag: slot.team.tag,
            }
          : null,
      })),
    };
  }

  private async buildManualResultPreview(
    matchId: string,
    sessionId?: string | null,
  ) {
    const slots = await this.getMatchSlots(matchId);
    const preview = slots
      .filter((slot) => slot.teamId)
      .slice(0, 25)
      .map<PreviewItem>((slot, index) => ({
        position: index + 1,
        tag: this.teamTag(slot) ?? `Slot ${slot.slotNumber}`,
        kills: 0,
        teamName: slot.team?.name ?? null,
        teamId: null,
        slotId: null,
        slotNumber: slot.slotNumber,
        status: 'UNRESOLVED',
        reason: 'BASIC_OCR_MANUAL_REVIEW',
        playerNames: [],
        confidence: 0,
      }));

    return {
      matchId,
      sessionId: sessionId ?? null,
      ocrMode: 'MANUAL' as const,
      preview,
      ...this.splitPreview(preview),
      slots: slots.map((slot) => ({
        id: slot.id,
        matchId,
        slotNumber: slot.slotNumber,
        teamId: slot.teamId,
        team: slot.team
          ? {
              id: slot.team.id,
              name: slot.team.name ?? null,
              tag: slot.team.tag,
            }
          : null,
      })),
    };
  }

  private buildSlotMapPreview(
    rows: ParsedSlotMapRow[],
    slots: MatchSlotLookup[],
  ) {
    const slotsByNumber = new Map(slots.map((slot) => [slot.slotNumber, slot]));
    const preview = rows.map<SlotMapPreviewItem>((row) => {
      const slot = slotsByNumber.get(row.slotNumber);
      if (!slot) {
        return {
          slotNumber: row.slotNumber,
          tag: row.tag,
          playerNames: row.playerNames,
          teamId: null,
          slotId: null,
          status: 'UNRESOLVED',
          reason: 'MATCH_SLOT_NOT_FOUND',
          confidence: row.confidence,
        };
      }
      if (!slot.teamId) {
        return {
          slotNumber: row.slotNumber,
          tag: row.tag ?? this.teamTag(slot),
          playerNames: row.playerNames,
          teamId: null,
          slotId: slot.id,
          status: 'UNRESOLVED',
          reason: 'MATCH_SLOT_HAS_NO_TEAM',
          confidence: row.confidence,
        };
      }
      return {
        slotNumber: row.slotNumber,
        tag: row.tag ?? this.teamTag(slot),
        playerNames: row.playerNames,
        teamId: slot.teamId,
        slotId: slot.id,
        status: 'OK',
        confidence: row.confidence,
      };
    });

    return preview.sort((left, right) => left.slotNumber - right.slotNumber);
  }

  async mapSlotScreenshot(actor: AuthUser, dto: IngestSlotMapScreenshotDto) {
    const match = await this.results.ensureMatch(actor, dto.matchId);
    this.assertSupportedMatch(match);
    const organizationId = this.requireMatchOrganizationId(match);
    await this.refreshSessionMatchSlots(match);
    const imageUrls = this.screenshotImageUrls(dto);
    const ocrMode = await this.screenshotOcrModeForOrganization(organizationId);
    const parsedRows =
      ocrMode === 'AI'
        ? await this.parser.parseSlotMapScreenshots(imageUrls)
        : await this.parser.parseSlotMapScreenshotsBasic(imageUrls);
    const slots = await this.getMatchSlots(match.id);
    const preview = this.buildSlotMapPreview(parsedRows, slots);
    const mapped = preview.filter((item) => item.status === 'OK');
    const now = new Date().toISOString();

    await this.saveOcrSlotMappings(
      match.id,
      organizationId,
      imageUrls[0],
      mapped
        .filter(
          (
            item,
          ): item is SlotMapPreviewItem & {
            teamId: string;
          } => Boolean(item.teamId),
        )
        .map((item) => ({
          slotNumber: item.slotNumber,
          teamId: item.teamId,
          teamTag: item.tag,
          playerNames: item.playerNames,
          sourceImageUrl: imageUrls[0],
          confidence: item.confidence ?? null,
          updatedAt: now,
        })),
    );
    await this.markMappedSlotsPresent(match.id, mapped);

    return {
      matchId: match.id,
      ocrMode,
      preview,
      mapped,
      unresolved: preview.filter((item) => item.status === 'UNRESOLVED'),
      ambiguous: preview.filter((item) => item.status === 'AMBIGUOUS'),
    };
  }

  async previewScreenshot(actor: AuthUser, dto: IngestScreenshotDto) {
    const match = await this.results.ensureMatch(actor, dto.matchId);
    this.assertSupportedMatch(match);
    const organizationId = this.requireMatchOrganizationId(match);
    await this.refreshSessionMatchSlots(match);
    const imageUrls = this.screenshotImageUrls(dto);
    const ocrMode = await this.screenshotOcrModeForOrganization(organizationId);
    const parsedRows =
      ocrMode === 'AI'
        ? await this.parser.parseScreenshots(imageUrls)
        : await this.parser.parseScreenshotsBasic(imageUrls);

    if (ocrMode !== 'AI' && parsedRows.length === 0) {
      return this.buildManualResultPreview(match.id, match.sessionId ?? null);
    }

    return this.buildPreview(
      match.id,
      organizationId,
      parsedRows,
      match.sessionId ?? null,
      ocrMode,
    );
  }

  async applyScreenshotResults(
    actor: AuthUser,
    dto: ApplyScreenshotResultsDto,
  ) {
    const match = await this.results.ensureMatch(actor, dto.matchId);
    this.assertSupportedMatch(match);
    const organizationId = this.requireMatchOrganizationId(match);
    await this.refreshSessionMatchSlots(match);

    if (!dto.results.length) {
      throw new BadRequestException('results array is required');
    }
    if (
      dto.results.some(
        (entry) => entry.status !== ScreenshotPreviewStatusDto.OK,
      )
    ) {
      throw new BadRequestException(
        'Cannot apply screenshot results with unresolved or ambiguous entries',
      );
    }

    this.assertUniqueApplyEntries(dto.results);
    this.assertNoMissingApplyPlacements(dto.results);

    let appliedSlotNumbers: number[] = [];
    const learnedMappings: OcrSlotMappingEntry[] = [];
    let noShowTeamIds = new Set<string>();
    await this.prisma.$transaction(async (tx) => {
      await this.results.ensureResultsEditableByMatchId(match.id, actor, tx);
      await this.results.ensureResultsFromSlots(match.id, { tx });

      const slots = await tx.matchSlot.findMany({
        where: {
          matchId: match.id,
          deletedAt: null,
          id: { in: dto.results.map((entry) => entry.slotId as string) },
        },
        select: {
          id: true,
          teamId: true,
          slotNumber: true,
          team: {
            select: {
              tag: true,
            },
          },
        },
      });
      const allAssignedSlots = await tx.matchSlot.findMany({
        where: {
          matchId: match.id,
          deletedAt: null,
          teamId: { not: null },
        },
        select: {
          teamId: true,
          team: {
            select: {
              tag: true,
            },
          },
        },
      });
      const officialTagOwners = this.officialTagOwners(allAssignedSlots);
      const slotById = new Map(slots.map((slot) => [slot.id, slot] as const));
      appliedSlotNumbers = slots.map((slot) => slot.slotNumber);

      await this.clearConflictingScreenshotPlacements(
        tx,
        match.id,
        slots.map((slot) => slot.slotNumber),
        dto.results.map((entry) => entry.position),
      );

      for (const entry of dto.results) {
        const slot = slotById.get(entry.slotId as string);
        if (!slot) {
          throw new BadRequestException(
            `Match slot not found: ${entry.slotId}`,
          );
        }
        if (!slot.teamId || slot.teamId !== entry.teamId) {
          throw new BadRequestException(
            `Slot ${entry.slotId} does not belong to team ${entry.teamId}`,
          );
        }

        const learnedMapping = this.buildAppliedOcrMapping(
          entry,
          slot,
          officialTagOwners,
        );
        if (learnedMapping) {
          learnedMappings.push(learnedMapping);
        }

        const slotResult = await tx.matchSlotResult.findUnique({
          where: {
            matchId_slotNumber: {
              matchId: match.id,
              slotNumber: slot.slotNumber,
            },
          },
          select: {
            id: true,
            matchId: true,
            organizationId: true,
            slotNumber: true,
            teamId: true,
            wasPresentInMatch: true,
          },
        });
        if (!slotResult) {
          throw new BadRequestException(
            `Slot result not found for slot ${slot.slotNumber}`,
          );
        }
        await this.results.assertSlotPresentForMutation(
          {
            id: slotResult.id,
            matchId: slotResult.matchId,
            slotNumber: slotResult.slotNumber,
            teamId: slotResult.teamId ?? null,
            wasPresentInMatch: slotResult.wasPresentInMatch ?? null,
          },
          {
            allowManualPromote: true,
          },
        );

        const players = this.normalizeScreenshotPlayers(entry.players);
        const playerKillSum = players.reduce(
          (sum, player) => sum + player.kills,
          0,
        );
        const hasCompletePlayerKills =
          players.length > 0 && playerKillSum === entry.kills;

        await tx.matchSlotResult.update({
          where: {
            matchId_slotNumber: {
              matchId: match.id,
              slotNumber: slot.slotNumber,
            },
          },
          data: {
            placement: entry.position,
            totalKills: entry.kills,
            manualTotalKills: !hasCompletePlayerKills,
            wasPresentInMatch: true,
            isLocked: false,
          },
        });

        if (hasCompletePlayerKills) {
          await this.reconcileScreenshotPlayerKills(tx, slotResult, players);
        }
      }

      if (dto.markMissingSlotsNoShow) {
        noShowTeamIds = await this.markMissingSlotsNoShow(
          tx,
          match.id,
          appliedSlotNumbers,
        );
      }
    });

    if (learnedMappings.length) {
      await this.saveOcrSlotMappings(
        match.id,
        organizationId,
        'result-review',
        learnedMappings,
      );
    }

    await this.results.recalculateMatchResults(match.id);
    if (dto.markMissingSlotsNoShow && noShowTeamIds.size > 0) {
      await this.results.storeNoShowBanSnapshotForMatch(
        match.id,
        'screenshot-apply',
      );
    }
    await this.resultBackups?.captureMatchBackupFromMatchId(
      match.id,
      'screenshot-apply',
    );
    const summary = await this.loadAppliedResultSummary(
      match.id,
      appliedSlotNumbers,
    );

    return {
      ok: true,
      matchId: match.id,
      updatedCount: dto.results.length,
      noShowCount: noShowTeamIds.size,
      summary,
    };
  }
}

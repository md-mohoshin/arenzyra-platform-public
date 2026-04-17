import { BadRequestException, Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth.types';
import { isSessionMatch } from '../../common/match-context.util';
import { PrismaService } from '../../db/prisma.service';
import { ResultsService } from '../results/results.service';
import type {
  ApplyScreenshotResultEntryDto,
  ApplyScreenshotResultsDto,
} from './dto/apply-screenshot-results.dto';
import { ScreenshotPreviewStatusDto } from './dto/apply-screenshot-results.dto';
import type { IngestScreenshotDto } from './dto/ingest-screenshot.dto';
import {
  ScreenshotParserService,
  type ParsedScreenshotRow,
} from './screenshot-parser.service';

type PreviewStatus = 'OK' | 'UNRESOLVED' | 'AMBIGUOUS';

type PreviewItem = {
  position: number;
  tag: string;
  kills: number;
  teamId: string | null;
  slotId: string | null;
  slotNumber: number | null;
  status: PreviewStatus;
  reason?: string;
  candidateTeamIds?: string[];
};

@Injectable()
export class ScreenshotIngestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly parser: ScreenshotParserService,
    private readonly results: ResultsService,
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

  private splitPreview(preview: PreviewItem[]) {
    return {
      resolved: preview.filter((item) => item.status === 'OK'),
      unresolved: preview.filter((item) => item.status === 'UNRESOLVED'),
      ambiguous: preview.filter((item) => item.status === 'AMBIGUOUS'),
    };
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

  private async buildPreview(
    matchId: string,
    organizationId: string,
    rows: ParsedScreenshotRow[],
  ) {
    const tags = Array.from(new Set(rows.map((row) => row.tag)));
    const teams = tags.length
      ? await this.prisma.team.findMany({
          where: {
            organizationId,
            deletedAt: null,
            tag: { in: tags },
          },
          select: {
            id: true,
            tag: true,
          },
        })
      : [];

    const teamsByTag = new Map<
      string,
      Array<{ id: string; tag: string | null }>
    >();
    for (const team of teams) {
      const tag = team.tag ?? null;
      if (!tag) {
        continue;
      }
      const current = teamsByTag.get(tag) ?? [];
      current.push(team);
      teamsByTag.set(tag, current);
    }

    const uniquelyResolvedTeamIds = teams
      .filter((team) => (teamsByTag.get(team.tag ?? '') ?? []).length === 1)
      .map((team) => team.id);

    const slots = uniquelyResolvedTeamIds.length
      ? await this.prisma.matchSlot.findMany({
          where: {
            matchId,
            deletedAt: null,
            teamId: { in: uniquelyResolvedTeamIds },
          },
          select: {
            id: true,
            teamId: true,
            slotNumber: true,
          },
        })
      : [];

    const slotByTeamId = new Map(
      slots
        .filter(
          (
            slot,
          ): slot is {
            id: string;
            teamId: string;
            slotNumber: number;
          } => Boolean(slot.teamId),
        )
        .map((slot) => [slot.teamId, slot] as const),
    );

    const preview = rows.map<PreviewItem>((row) => {
      const candidates = teamsByTag.get(row.tag) ?? [];
      if (candidates.length === 0) {
        return {
          position: row.position,
          tag: row.tag,
          kills: row.kills,
          teamId: null,
          slotId: null,
          slotNumber: null,
          status: 'UNRESOLVED',
          reason: 'TEAM_TAG_NOT_FOUND',
        };
      }
      if (candidates.length > 1) {
        return {
          position: row.position,
          tag: row.tag,
          kills: row.kills,
          teamId: null,
          slotId: null,
          slotNumber: null,
          status: 'AMBIGUOUS',
          reason: 'MULTIPLE_TEAMS_FOR_TAG',
          candidateTeamIds: candidates.map((team) => team.id),
        };
      }

      const team = candidates[0];
      const slot = slotByTeamId.get(team.id);
      if (!slot) {
        return {
          position: row.position,
          tag: row.tag,
          kills: row.kills,
          teamId: team.id,
          slotId: null,
          slotNumber: null,
          status: 'UNRESOLVED',
          reason: 'TEAM_NOT_ASSIGNED_TO_MATCH',
        };
      }

      return {
        position: row.position,
        tag: row.tag,
        kills: row.kills,
        teamId: team.id,
        slotId: slot.id,
        slotNumber: slot.slotNumber,
        status: 'OK',
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
      preview: ordered,
      ...this.splitPreview(ordered),
    };
  }

  async previewScreenshot(actor: AuthUser, dto: IngestScreenshotDto) {
    const match = await this.results.ensureMatch(actor, dto.matchId);
    this.assertSupportedMatch(match);
    const organizationId = this.requireMatchOrganizationId(match);
    const parsedRows = await this.parser.parseScreenshot(dto.imageUrl);

    return this.buildPreview(match.id, organizationId, parsedRows);
  }

  async applyScreenshotResults(
    actor: AuthUser,
    dto: ApplyScreenshotResultsDto,
  ) {
    const match = await this.results.ensureMatch(actor, dto.matchId);
    this.assertSupportedMatch(match);
    this.requireMatchOrganizationId(match);

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
        },
      });
      const slotById = new Map(slots.map((slot) => [slot.id, slot] as const));

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
        await this.results.assertSlotPresentForMutation({
          id: slotResult.id,
          matchId: slotResult.matchId,
          slotNumber: slotResult.slotNumber,
          teamId: slotResult.teamId ?? null,
          wasPresentInMatch: slotResult.wasPresentInMatch ?? null,
        });

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
            manualTotalKills: true,
          },
        });
      }
    });

    await this.results.recalculateMatchResults(match.id);

    return {
      ok: true,
      matchId: match.id,
      updatedCount: dto.results.length,
    };
  }
}

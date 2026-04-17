import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../db/prisma.service';
import { type MapConfig, getMapConfig } from './map.config';
import { PcobGateway } from '../pcob/pcob.gateway';
import type { AuthUser } from '../../common/auth/auth.types';
import { normalizePublicAssetUrl } from '../../common/public-asset-url.util';
import {
  MatchControlStateStore,
  type LiveMatchState,
} from '../match-control/state.store';

const isRecord = (val: unknown): val is Record<string, unknown> =>
  !!val && typeof val === 'object';

type PlayerMarker = {
  playerId?: string;
  teamId?: string | null;
  x: number;
  y: number;
  alive?: boolean;
  knocked?: boolean;
};

type TeamMarker = {
  teamId: string | null;
  x: number;
  y: number;
  alive?: boolean;
  playerCount: number;
  alivePlayers: number;
};

type LiveMarkerSnapshot = {
  playerMarkers: PlayerMarker[];
  teamMarkers: TeamMarker[];
};

type RawPositionSnapshot = {
  playerMarkers: PlayerMarker[];
  updatedAt: string | null;
};

type CircleZone = { x: number; y: number; r: number } | null;

type TelemetryCircleSnapshot = {
  safeZone: CircleZone;
  nextZone: CircleZone;
  phaseIndex: number | null;
  nextShrinkAtMs: number | null;
};

const OBSERVER_CIRCLE_WRAPPER_KEYS = [
  'circle',
  'circleInfo',
  'CircleInfo',
  'allInfo',
  'routePayloads',
  'latestRoutePayloads',
  'data',
  'Data',
  'result',
  'Result',
  'zone',
  'zones',
  'map',
] as const;

@Injectable()
export class MapStateService {
  private lastHash = new Map<string, string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: PcobGateway,
    private readonly stateStore: MatchControlStateStore,
  ) {}

  private canAccess(
    actor: Partial<AuthUser> | null | undefined,
    ownerUserId: string,
  ) {
    if (!actor) return false;
    const role = actor.role ?? actor.actorRole;
    if (role === Role.SUPER_ADMIN) return true;
    const actorId = actor.actorId ?? actor.id;
    return actorId === ownerUserId;
  }

  private mapConfigFor(mapKey: string | null | undefined): MapConfig | null {
    if (!mapKey) return null;
    return getMapConfig(mapKey);
  }

  private numberValue(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
  }

  private stringValue(value: unknown): string | null {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      return `${value}`;
    }

    return null;
  }

  private booleanValue(value: unknown): boolean | null {
    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'number') {
      if (value === 1) return true;
      if (value === 0) return false;
    }

    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true' || normalized === '1') {
        return true;
      }
      if (normalized === 'false' || normalized === '0') {
        return false;
      }
    }

    return null;
  }

  private extractPosition(payload: unknown) {
    const posCandidate =
      (isRecord(payload) && payload.position) ??
      (isRecord(payload) && payload.location) ??
      (isRecord(payload) && payload.pos) ??
      (isRecord(payload) && payload.loc) ??
      payload;
    if (!isRecord(posCandidate)) return null;
    const rawX =
      posCandidate.x ??
      posCandidate.X ??
      posCandidate.lon ??
      posCandidate.lng ??
      posCandidate.long ??
      null;
    const rawY = posCandidate.y ?? posCandidate.Y ?? posCandidate.lat ?? null;
    if (
      rawX === null ||
      rawX === undefined ||
      rawY === null ||
      rawY === undefined
    ) {
      return null;
    }
    const x = Number(rawX);
    const y = Number(rawY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
  }

  private extractCircleZone(value: unknown): CircleZone {
    if (!isRecord(value)) return null;

    const center =
      (isRecord(value.center) && value.center) ??
      (isRecord(value.zoneCenter) && value.zoneCenter) ??
      value;
    const rawX =
      value.x ??
      value.X ??
      value.centerX ??
      value.cx ??
      (isRecord(center) ? (center.x ?? center.X ?? center.lon) : null) ??
      null;
    const rawY =
      value.y ??
      value.Y ??
      value.centerY ??
      value.cy ??
      (isRecord(center) ? (center.y ?? center.Y ?? center.lat) : null) ??
      null;
    const rawR =
      value.r ??
      value.radius ??
      value.Radius ??
      value.size ??
      value.zoneRadius ??
      null;

    if (
      rawX === null ||
      rawX === undefined ||
      rawY === null ||
      rawY === undefined
    ) {
      return null;
    }
    if (rawR === null || rawR === undefined) {
      return null;
    }

    const x = Number(rawX);
    const y = Number(rawY);
    const r = Number(rawR);

    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(r)) {
      return null;
    }

    return { x, y, r };
  }

  private resolveTimestampMs(value: unknown): number | null {
    if (value instanceof Date) {
      return value.getTime();
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      return value < 10_000_000_000 ? value * 1000 : value;
    }

    if (typeof value === 'string') {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) {
        return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
      }
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
  }

  private deriveEffectiveWorldSize(
    baseWorldSize: number | null | undefined,
    playerMarkers: PlayerMarker[],
    teamMarkers: TeamMarker[],
    safeZone: CircleZone,
    nextZone: CircleZone,
  ): number | null {
    const base =
      typeof baseWorldSize === 'number' && Number.isFinite(baseWorldSize)
        ? baseWorldSize
        : null;
    if (!base) {
      return null;
    }

    let observedMax = base;
    const includePoint = (x: unknown, y: unknown) => {
      const xNum = this.numberValue(x);
      const yNum = this.numberValue(y);
      if (xNum !== null) {
        observedMax = Math.max(observedMax, Math.abs(xNum));
      }
      if (yNum !== null) {
        observedMax = Math.max(observedMax, Math.abs(yNum));
      }
    };
    const includeCircle = (circle: CircleZone) => {
      if (!circle) {
        return;
      }
      observedMax = Math.max(
        observedMax,
        Math.abs(circle.x - circle.r),
        Math.abs(circle.x + circle.r),
        Math.abs(circle.y - circle.r),
        Math.abs(circle.y + circle.r),
      );
    };

    for (const marker of playerMarkers) {
      includePoint(marker.x, marker.y);
    }
    for (const marker of teamMarkers) {
      includePoint(marker.x, marker.y);
    }
    includeCircle(safeZone);
    includeCircle(nextZone);

    let effective = base;
    while (effective * 1.02 < observedMax) {
      effective *= 10;
    }

    return effective;
  }

  private observerTelemetryRoot(
    payload: unknown,
  ): Record<string, unknown> | null {
    if (!isRecord(payload)) {
      return null;
    }

    const observerTelemetry = isRecord(payload.observerTelemetry)
      ? payload.observerTelemetry
      : null;

    return observerTelemetry ?? payload;
  }

  private observerCircleScore(record: Record<string, unknown>): number {
    let score = 0;

    if (
      isRecord(record.safeZone) ||
      isRecord(record.safezone) ||
      isRecord(record.blueZone)
    ) {
      score += 100;
    }
    if (
      isRecord(record.nextZone) ||
      isRecord(record.nextzone) ||
      isRecord(record.whiteZone)
    ) {
      score += 80;
    }
    if (isRecord(record.zoneCenter) || record.zoneRadius !== undefined) {
      score += 70;
    }
    if (isRecord(record.zone)) {
      score += 50;
    }
    if (
      record.phase !== undefined ||
      record.phaseIndex !== undefined ||
      record.circlePhase !== undefined ||
      record.CircleIndex !== undefined ||
      record.circleIndex !== undefined
    ) {
      score += 12;
    }
    if (
      record.CircleStatus !== undefined ||
      record.circleStatus !== undefined ||
      record.Counter !== undefined ||
      record.MaxTime !== undefined
    ) {
      score += 6;
    }

    return score;
  }

  private isObserverCircleRecord(record: Record<string, unknown>): boolean {
    return (
      record.safeZone !== undefined ||
      record.safezone !== undefined ||
      record.blueZone !== undefined ||
      record.nextZone !== undefined ||
      record.nextzone !== undefined ||
      record.whiteZone !== undefined ||
      record.zoneCenter !== undefined ||
      record.zoneRadius !== undefined ||
      record.phase !== undefined ||
      record.phaseIndex !== undefined ||
      record.circlePhase !== undefined ||
      record.CircleIndex !== undefined ||
      record.circleIndex !== undefined ||
      record.CircleStatus !== undefined ||
      record.circleStatus !== undefined ||
      record.Counter !== undefined ||
      record.MaxTime !== undefined
    );
  }

  private findObserverCircleRecord(
    payload: unknown,
  ): Record<string, unknown> | null {
    const root = this.observerTelemetryRoot(payload);
    if (!root) {
      return null;
    }

    const queue: Array<Record<string, unknown>> = [root];
    const seen = new Set<Record<string, unknown>>();
    let best: Record<string, unknown> | null = null;
    let bestScore = -1;

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || seen.has(current)) {
        continue;
      }
      seen.add(current);

      if (this.isObserverCircleRecord(current)) {
        const score = this.observerCircleScore(current);
        if (score > bestScore) {
          best = current;
          bestScore = score;
        }
      }

      for (const key of OBSERVER_CIRCLE_WRAPPER_KEYS) {
        const nested = isRecord(current[key]) ? current[key] : null;
        if (nested && !seen.has(nested)) {
          queue.push(nested);
        }
      }

      for (const value of Object.values(current)) {
        const nested = isRecord(value) ? value : null;
        if (nested && !seen.has(nested)) {
          queue.push(nested);
        }
      }
    }

    return best;
  }

  private resolveObserverTeamId(
    rawTeam: unknown,
    slotTeamIds: Map<number, string | null>,
  ): string | null {
    const slot = this.numberValue(rawTeam);
    if (slot !== null) {
      return slotTeamIds.get(slot) ?? `slot:${slot}`;
    }

    return this.stringValue(rawTeam);
  }

  private buildMarkersFromObserverTelemetry(
    payload: unknown,
    slotTeamIds: Map<number, string | null>,
  ): LiveMarkerSnapshot | null {
    const observer = this.observerTelemetryRoot(payload);
    const players = Array.isArray(observer?.players) ? observer.players : [];
    if (players.length === 0) {
      return null;
    }

    const playerMarkers: PlayerMarker[] = [];
    for (const item of players) {
      if (!isRecord(item)) {
        continue;
      }

      const position = this.extractPosition(item);
      if (!position) {
        continue;
      }

      const teamId = this.resolveObserverTeamId(
        item.teamId ??
          item.teamID ??
          item.team ??
          item.slot ??
          item.teamNumber ??
          item.teamNo,
        slotTeamIds,
      );
      const health = this.numberValue(item.health);
      const liveState = this.numberValue(item.liveState);
      const eliminated =
        item.bHasDied === true || health === 0 || liveState === 5;
      const knocked = !eliminated && liveState === 4;
      const alive = !eliminated;

      if (!alive && !knocked) {
        continue;
      }

      playerMarkers.push({
        playerId:
          this.stringValue(
            item.playerOpenId ??
              item.playerId ??
              item.uId ??
              item.playerKey ??
              item.playerName,
          ) ?? undefined,
        teamId,
        x: position.x,
        y: position.y,
        alive,
        knocked,
      });
    }

    if (playerMarkers.length === 0) {
      return null;
    }

    const teamMarkers = this.teamMarkersFromPlayers(playerMarkers);

    return {
      playerMarkers,
      teamMarkers,
    };
  }

  private buildCircleFromObserverTelemetry(
    payload: unknown,
  ): TelemetryCircleSnapshot | null {
    const circle = this.findObserverCircleRecord(payload);
    if (!circle) {
      return null;
    }

    const circleInfo = isRecord(circle.circleInfo) ? circle.circleInfo : circle;
    const safeZone = this.extractCircleZone(
      circle.safeZone ??
        circle.safezone ??
        circle.blueZone ??
        circle.current ??
        null,
    );
    const nextZone = this.extractCircleZone(
      circle.nextZone ??
        circle.nextzone ??
        circle.whiteZone ??
        circle.nextSafeZone ??
        circle.next ??
        null,
    );
    const phaseIndex =
      this.numberValue(
        circleInfo.CircleIndex ??
          circleInfo.circleIndex ??
          circleInfo.phase ??
          circleInfo.phaseIndex ??
          circleInfo.zonePhaseIndex,
      ) ?? null;
    const directShrinkAt =
      this.resolveTimestampMs(
        circleInfo.nextShrinkAt ??
          circleInfo.nextShrinkTs ??
          circleInfo.nextShrinkTime ??
          circleInfo.zoneNextShrinkAt,
      ) ?? null;
    const counter = this.numberValue(circleInfo.Counter ?? circleInfo.counter);
    const maxTime = this.numberValue(circleInfo.MaxTime ?? circleInfo.maxTime);
    const nextShrinkAtMs =
      directShrinkAt ??
      (counter !== null && maxTime !== null && maxTime >= counter
        ? Date.now() + (maxTime - counter) * 1000
        : null);

    if (
      safeZone === null &&
      nextZone === null &&
      phaseIndex === null &&
      nextShrinkAtMs === null
    ) {
      return null;
    }

    return {
      safeZone,
      nextZone,
      phaseIndex,
      nextShrinkAtMs,
    };
  }

  private inferSafeZoneFromObserverPlayers(
    payload: unknown,
    worldSizeHint: number | null | undefined,
  ): CircleZone {
    const observer = this.observerTelemetryRoot(payload);
    const players = Array.isArray(observer?.players) ? observer.players : [];
    if (players.length === 0) {
      return null;
    }

    const phaseIndex =
      this.buildCircleFromObserverTelemetry(payload)?.phaseIndex ?? null;
    const allSamples: Array<{
      x: number;
      y: number;
      inside: boolean;
      rank: number | null;
      survivalTime: number | null;
    }> = [];
    const activeSamples: Array<{
      x: number;
      y: number;
      inside: boolean;
      rank: number | null;
      survivalTime: number | null;
    }> = [];
    for (const item of players) {
      if (!isRecord(item)) {
        continue;
      }

      const outside = this.booleanValue(
        item.isOutsideBlueCircle ??
          item.outsideBlueCircle ??
          item.isOutsideSafeZone ??
          item.outsideSafeZone,
      );
      if (outside === null) {
        continue;
      }

      const position = this.extractPosition(item);
      if (!position) {
        continue;
      }

      const sample = {
        x: position.x,
        y: position.y,
        inside: !outside,
        rank: this.numberValue(item.rank),
        survivalTime: this.numberValue(item.survivalTime),
      };
      allSamples.push(sample);

      const health = this.numberValue(item.health);
      const liveState = this.numberValue(item.liveState);
      const hasDied = item.bHasDied === true;
      const isActive =
        !hasDied &&
        (health === null ||
          health > 0 ||
          (liveState !== null && liveState < 5));
      if (isActive) {
        activeSamples.push(sample);
      }
    }

    const latePlacementThreshold =
      phaseIndex !== null && phaseIndex >= 6 ? 6 : null;
    const latePlacementSamples =
      latePlacementThreshold !== null
        ? allSamples.filter(
            (sample) =>
              sample.rank !== null && sample.rank <= latePlacementThreshold,
          )
        : [];
    const recentSamples =
      allSamples.length > 0
        ? [...allSamples]
            .sort(
              (left, right) =>
                (right.survivalTime ?? 0) - (left.survivalTime ?? 0),
            )
            .slice(0, 16)
        : [];

    return (
      this.fitSafeZoneFromPlayerSamples(activeSamples, worldSizeHint) ??
      this.fitSafeZoneFromPlayerSamples(latePlacementSamples, worldSizeHint) ??
      this.fitSafeZoneFromPlayerSamples(recentSamples, worldSizeHint) ??
      this.fitSafeZoneFromPlayerSamples(allSamples, worldSizeHint)
    );
  }

  private fitSafeZoneFromPlayerSamples(
    samples: Array<{
      x: number;
      y: number;
      inside: boolean;
      rank?: number | null;
      survivalTime?: number | null;
    }>,
    worldSizeHint: number | null | undefined,
  ): CircleZone {
    const insideSamples = samples.filter((sample) => sample.inside);
    const outsideSamples = samples.filter((sample) => !sample.inside);
    if (insideSamples.length < 2 || outsideSamples.length < 1) {
      return null;
    }

    const centroid = insideSamples.reduce(
      (acc, sample) => {
        acc.x += sample.x;
        acc.y += sample.y;
        return acc;
      },
      { x: 0, y: 0 },
    );
    const cx = centroid.x / insideSamples.length;
    const cy = centroid.y / insideSamples.length;
    const r = insideSamples.reduce((max, sample) => {
      return Math.max(max, Math.hypot(sample.x - cx, sample.y - cy));
    }, 1);

    const allSamples = [...insideSamples, ...outsideSamples];
    const minX = Math.min(...allSamples.map((sample) => sample.x));
    const maxX = Math.max(...allSamples.map((sample) => sample.x));
    const minY = Math.min(...allSamples.map((sample) => sample.y));
    const maxY = Math.max(...allSamples.map((sample) => sample.y));
    const worldSize =
      typeof worldSizeHint === 'number' && Number.isFinite(worldSizeHint)
        ? worldSizeHint
        : Math.max(maxX - minX, maxY - minY, 8000);
    const smallestStep = Math.max(250, worldSize / 1024);

    const objective = (x: number, y: number, radius: number) => {
      let penalty = 0;

      for (const sample of insideSamples) {
        const gap = Math.hypot(sample.x - x, sample.y - y) - radius;
        if (gap > 0) {
          penalty += gap * gap * 12;
        }
      }

      for (const sample of outsideSamples) {
        const gap = radius - Math.hypot(sample.x - x, sample.y - y);
        if (gap > 0) {
          penalty += gap * gap * 18;
        }
      }

      // Prefer the smallest valid circle once classifications are satisfied.
      penalty += radius * 0.025;
      return penalty;
    };

    let best = { cx, cy, r, score: objective(cx, cy, r) };
    const baseSpan = Math.max(maxX - minX, maxY - minY, worldSize / 8);
    const steps: number[] = [];
    for (
      let step = Math.max(baseSpan / 2, smallestStep * 8);
      step >= smallestStep;
      step /= 2
    ) {
      steps.push(step);
    }

    for (const step of steps) {
      let improved = true;
      while (improved) {
        improved = false;
        const radiusDown = Math.max(smallestStep, best.r - step);
        const candidates = [
          { cx: best.cx + step, cy: best.cy, r: best.r },
          { cx: best.cx - step, cy: best.cy, r: best.r },
          { cx: best.cx, cy: best.cy + step, r: best.r },
          { cx: best.cx, cy: best.cy - step, r: best.r },
          { cx: best.cx + step, cy: best.cy + step, r: best.r },
          { cx: best.cx + step, cy: best.cy - step, r: best.r },
          { cx: best.cx - step, cy: best.cy + step, r: best.r },
          { cx: best.cx - step, cy: best.cy - step, r: best.r },
          { cx: best.cx, cy: best.cy, r: best.r + step },
          { cx: best.cx, cy: best.cy, r: radiusDown },
        ];

        for (const candidate of candidates) {
          const score = objective(candidate.cx, candidate.cy, candidate.r);
          if (score + 1 < best.score) {
            best = { ...candidate, score };
            improved = true;
          }
        }
      }
    }

    const insideViolations = insideSamples.filter(
      (sample) => Math.hypot(sample.x - best.cx, sample.y - best.cy) > best.r,
    ).length;
    const outsideViolations = outsideSamples.filter(
      (sample) => Math.hypot(sample.x - best.cx, sample.y - best.cy) < best.r,
    ).length;

    if (
      insideViolations > Math.max(1, Math.floor(insideSamples.length * 0.2)) ||
      outsideViolations > Math.max(2, Math.floor(outsideSamples.length * 0.35))
    ) {
      return null;
    }

    return {
      x: Math.round(best.cx),
      y: Math.round(best.cy),
      r: Math.round(best.r),
    };
  }

  private buildMarkersFromLiveState(
    liveState: LiveMatchState | null,
  ): LiveMarkerSnapshot | null {
    if (!liveState?.teams?.length) {
      return null;
    }

    const playerMarkers: PlayerMarker[] = [];
    const teamMarkers: TeamMarker[] = [];

    for (const team of liveState.teams) {
      const positionedPlayers = (team.players ?? []).filter((player) => {
        const position = player.position;
        return (
          position !== null &&
          position !== undefined &&
          Number.isFinite(position.x) &&
          Number.isFinite(position.y) &&
          (player.alive || player.knocked || player.eliminated !== true)
        );
      });

      if (!positionedPlayers.length) {
        continue;
      }

      let xSum = 0;
      let ySum = 0;
      let alivePlayers = 0;

      for (const player of positionedPlayers) {
        const position = player.position!;
        xSum += position.x;
        ySum += position.y;
        if (player.alive || player.knocked) {
          alivePlayers += 1;
        }

        playerMarkers.push({
          playerId:
            player.playerId ??
            player.id ??
            player.externalPlayerId ??
            player.pubgPlayerId ??
            undefined,
          teamId: team.teamId ?? null,
          x: position.x,
          y: position.y,
          alive: player.alive,
          knocked: player.knocked,
        });
      }

      teamMarkers.push({
        teamId: team.teamId ?? null,
        x: xSum / positionedPlayers.length,
        y: ySum / positionedPlayers.length,
        alive: team.alive ?? alivePlayers > 0,
        playerCount: positionedPlayers.length,
        alivePlayers,
      });
    }

    if (!playerMarkers.length && !teamMarkers.length) {
      return null;
    }

    return { playerMarkers, teamMarkers };
  }

  private buildPlayerStateLookup(liveState: LiveMatchState | null) {
    return (liveState?.teams ?? []).reduce<
      Record<
        string,
        {
          alive?: boolean;
          knocked?: boolean;
          teamId?: string | null;
          slot?: number | null;
          position?: { x: number; y: number } | null;
        }
      >
    >((acc, team) => {
      for (const player of team.players ?? []) {
        const keys = [
          player.playerId,
          player.id,
          player.externalPlayerId,
          player.pubgPlayerId,
        ].filter((value): value is string => typeof value === 'string');
        for (const key of keys) {
          acc[key] = {
            alive: player.alive,
            knocked: player.knocked,
            teamId: team.teamId ?? null,
            slot: team.slot ?? null,
            position: player.position ?? null,
          };
        }
      }
      return acc;
    }, {});
  }

  private buildTeamAliveLookup(liveState: LiveMatchState | null) {
    return (liveState?.teams ?? []).reduce<Record<string, boolean>>(
      (acc, team) => {
        if (team.teamId) {
          acc[team.teamId] = (team.alivePlayers ?? 0) > 0;
        }
        return acc;
      },
      {},
    );
  }

  private async latestPositions(matchId: string) {
    const events = await this.prisma.pcobRawEvent.findMany({
      where: { matchId },
      orderBy: [{ timestamp: 'desc' }, { receivedAt: 'desc' }],
      take: 500,
    });

    const playerMarkers = new Map<string, PlayerMarker>();
    let latestUpdatedAtMs: number | null = null;
    for (const evt of events) {
      const payload = evt.payload;
      const payloadObj =
        payload && typeof payload === 'object'
          ? (payload as Record<string, unknown>)
          : null;
      const playerIdRaw =
        payloadObj?.playerId ??
        payloadObj?.id ??
        (payloadObj?.victim as Record<string, unknown> | undefined)?.playerId ??
        payloadObj?.victimId ??
        (payloadObj?.killer as Record<string, unknown> | undefined)?.playerId;
      const playerId = typeof playerIdRaw === 'string' ? playerIdRaw : null;
      const teamId =
        (payloadObj?.teamId as string | null | undefined) ??
        (payloadObj?.team as string | null | undefined) ??
        ((payloadObj?.victim as Record<string, unknown> | undefined)?.teamId as
          | string
          | null
          | undefined) ??
        ((payloadObj?.killer as Record<string, unknown> | undefined)?.teamId as
          | string
          | null
          | undefined) ??
        null;
      const pos = this.extractPosition(payloadObj);
      if (!pos || !playerId) continue;
      if (!playerMarkers.has(playerId)) {
        playerMarkers.set(playerId, { playerId, teamId, x: pos.x, y: pos.y });
        latestUpdatedAtMs =
          latestUpdatedAtMs ??
          this.resolveTimestampMs(
            evt.timestamp ??
              evt.receivedAt ??
              (payloadObj?.timestamp as string | number | Date | null | undefined) ??
              null,
          );
      }
    }
    return {
      playerMarkers: Array.from(playerMarkers.values()),
      updatedAt:
        latestUpdatedAtMs !== null
          ? new Date(latestUpdatedAtMs).toISOString()
          : null,
    } satisfies RawPositionSnapshot;
  }

  private teamMarkersFromPlayers(playerMarkers: PlayerMarker[]): TeamMarker[] {
    const byTeam = new Map<
      string,
      { x: number; y: number; count: number; alivePlayers: number }
    >();

    for (const marker of playerMarkers) {
      if (!marker.teamId) continue;
      const agg = byTeam.get(marker.teamId) ?? {
        x: 0,
        y: 0,
        count: 0,
        alivePlayers: 0,
      };
      agg.x += marker.x;
      agg.y += marker.y;
      agg.count += 1;
      if (marker.alive !== false) {
        agg.alivePlayers += 1;
      }
      byTeam.set(marker.teamId, agg);
    }

    return Array.from(byTeam.entries()).map(([teamId, agg]) => ({
      teamId,
      x: agg.x / agg.count,
      y: agg.y / agg.count,
      alive: agg.alivePlayers > 0,
      playerCount: agg.count,
      alivePlayers: agg.alivePlayers,
    }));
  }

  private async lookupMatch(matchId: string) {
    return this.prisma.match.findFirst({
      where: { id: matchId, deletedAt: null },
      select: {
        id: true,
        map: true,
        matchSlots: {
          select: {
            slotNumber: true,
            teamId: true,
          },
        },
        tournament: {
          select: {
            organizationId: true,
            ownerUserId: true,
          },
        },
      },
    });
  }

  async getMapState(matchId: string) {
    const match = await this.lookupMatch(matchId);
    if (!match) throw new NotFoundException('Match not found');

    const liveState = await this.stateStore.get(matchId);
    const liveMarkers = this.buildMarkersFromLiveState(liveState);
    const playerStateLookup = this.buildPlayerStateLookup(liveState);
    const teamAliveLookup = this.buildTeamAliveLookup(liveState);
    const slotTeamIds = new Map<number, string | null>(
      (match.matchSlots ?? [])
        .filter(
          (slot): slot is { slotNumber: number; teamId: string | null } =>
            typeof slot.slotNumber === 'number',
        )
        .map((slot) => [slot.slotNumber, slot.teamId ?? null]),
    );

    const mapConfig = this.mapConfigFor(match.map ?? null);
    const telemetry = await this.prisma.matchTelemetry.findUnique({
      where: { matchId },
      select: {
        payload: true,
        updatedAt: true,
        zoneCenter: true,
        zoneRadius: true,
        zonePhaseIndex: true,
        zoneNextShrinkAt: true,
      },
    });
    const telemetryMarkers = this.buildMarkersFromObserverTelemetry(
      telemetry?.payload ?? null,
      slotTeamIds,
    );
    const telemetryCircle = this.buildCircleFromObserverTelemetry(
      telemetry?.payload ?? null,
    );

    const rawFallback = liveMarkers
      ? { playerMarkers: [], updatedAt: null }
      : await this.latestPositions(matchId);
    const playerMarkers = liveMarkers
      ? liveMarkers.playerMarkers
      : rawFallback.playerMarkers.length > 0
        ? rawFallback.playerMarkers.map((marker) => ({
            ...marker,
            alive:
              marker.playerId && playerStateLookup[marker.playerId]
                ? (playerStateLookup[marker.playerId]?.alive ?? undefined)
                : undefined,
            knocked:
              marker.playerId && playerStateLookup[marker.playerId]
                ? (playerStateLookup[marker.playerId]?.knocked ?? undefined)
                : undefined,
          }))
        : (telemetryMarkers?.playerMarkers ?? []);
    const teamMarkers = liveMarkers
      ? liveMarkers.teamMarkers
      : (rawFallback.playerMarkers.length > 0
          ? this.teamMarkersFromPlayers(playerMarkers)
          : (telemetryMarkers?.teamMarkers ?? [])
        ).map((marker) => ({
          ...marker,
          alive:
            marker.teamId && teamAliveLookup[marker.teamId] !== undefined
              ? teamAliveLookup[marker.teamId]
              : marker.alive,
        }));

    const safeZone =
      liveState?.circle?.safeZone ??
      this.extractCircleZone({
        center: telemetry?.zoneCenter ?? null,
        radius: telemetry?.zoneRadius ?? null,
      }) ??
      telemetryCircle?.safeZone ??
      this.inferSafeZoneFromObserverPlayers(
        telemetry?.payload ?? null,
        mapConfig?.worldSize ?? null,
      ) ??
      null;
    const nextZone =
      liveState?.circle?.nextZone ?? telemetryCircle?.nextZone ?? null;
    const phaseIndex =
      liveState?.circle?.phase ??
      telemetry?.zonePhaseIndex ??
      telemetryCircle?.phaseIndex ??
      null;
    const nextShrinkAtMs = this.resolveTimestampMs(
      liveState?.circle?.nextShrinkAt ??
        telemetry?.zoneNextShrinkAt ??
        telemetryCircle?.nextShrinkAtMs ??
        null,
    );
    const timerRemaining =
      nextShrinkAtMs !== null ? Math.max(0, nextShrinkAtMs - Date.now()) : null;
    const timeRemainingToNextPhase =
      timerRemaining !== null ? Math.round(timerRemaining / 1000) : null;
    const phaseLabel =
      phaseIndex !== null && phaseIndex !== undefined
        ? `Phase ${phaseIndex}`
        : null;
    const effectiveWorldSize = this.deriveEffectiveWorldSize(
      mapConfig?.worldSize ?? null,
      playerMarkers,
      teamMarkers,
      safeZone,
      nextZone,
    );
    const updatedAtMs = Math.max(
      this.resolveTimestampMs(liveState?.updatedAt) ?? 0,
      this.resolveTimestampMs(telemetry?.updatedAt) ?? 0,
      this.resolveTimestampMs(rawFallback.updatedAt) ?? 0,
    );

    return {
      matchId,
      updatedAt:
        updatedAtMs > 0 ? new Date(updatedAtMs).toISOString() : null,
      map: mapConfig
        ? {
            ...mapConfig,
            worldSize: effectiveWorldSize ?? mapConfig.worldSize,
          }
        : null,
      circle: {
        safeZone,
        nextZone,
        phaseIndex,
        nextShrinkAt:
          nextShrinkAtMs !== null
            ? new Date(nextShrinkAtMs).toISOString()
            : null,
        timerRemaining,
        timeRemainingToNextPhase,
        phaseLabel,
      },
      teamMarkers,
      playerMarkers,
    };
  }

  async emitIfChanged(matchId: string) {
    const state = await this.getMapState(matchId);
    const hash = JSON.stringify(state);
    const prev = this.lastHash.get(matchId);
    if (prev !== hash) {
      this.lastHash.set(matchId, hash);
      const match = await this.lookupMatch(matchId);
      const organizationId = match?.tournament?.organizationId ?? null;
      this.gateway.emitMapState(matchId, state, organizationId);
      this.gateway.emitMapUpdate(matchId, state, organizationId);
    }
    return state;
  }

  async getOperatorMapState(orgId: string, matchId: string) {
    const match = await this.prisma.match.findFirst({
      where: {
        id: matchId,
        deletedAt: null,
        tournament: { organizationId: orgId },
      },
      include: {
        matchSlots: { include: { team: true } },
      },
    });
    if (!match) throw new NotFoundException('Match not found');

    const mapName = match.map ?? null;
    const liveState = await this.stateStore.get(matchId);
    const playerStateLookup = this.buildPlayerStateLookup(liveState);
    const positions = (await this.latestPositions(matchId)).playerMarkers;

    const slotByTeam: Record<string, { slotNumber: number | null }> = {};
    match.matchSlots.forEach((slot) => {
      if (slot.teamId) {
        slotByTeam[slot.teamId] = { slotNumber: slot.slotNumber ?? null };
      }
    });

    const canonicalPlayers = (liveState?.teams ?? []).flatMap((team) =>
      (team.players ?? [])
        .filter(
          (player) =>
            player.position !== null &&
            player.position !== undefined &&
            Number.isFinite(player.position.x) &&
            Number.isFinite(player.position.y),
        )
        .map((player) => ({
          playerId:
            player.playerId ??
            player.id ??
            player.externalPlayerId ??
            player.pubgPlayerId ??
            null,
          pubgAccountId: player.pubgPlayerId ?? null,
          ign: player.name ?? player.ign ?? null,
          teamSlot:
            team.slot ??
            (team.teamId
              ? (slotByTeam[team.teamId]?.slotNumber ?? null)
              : null),
          x: player.position!.x,
          y: player.position!.y,
          isAlive: player.alive,
          alive: player.alive,
          knocked: player.knocked,
          eliminated: player.eliminated === true || player.alive === false,
        })),
    );

    const players =
      canonicalPlayers.length > 0
        ? canonicalPlayers
        : positions.map((player) => {
            const playerState = player.playerId
              ? playerStateLookup[player.playerId]
              : undefined;
            const aliveFlag = playerState?.alive ?? null;
            const knockedFlag = playerState?.knocked ?? null;
            const teamId = player.teamId ?? playerState?.teamId ?? null;
            return {
              playerId: player.playerId ?? null,
              pubgAccountId: null,
              ign: null,
              teamSlot: teamId
                ? (slotByTeam[teamId]?.slotNumber ?? null)
                : null,
              x: player.x,
              y: player.y,
              isAlive: aliveFlag,
              alive: aliveFlag,
              knocked: knockedFlag,
              eliminated: aliveFlag === false ? true : null,
            };
          });

    const teams = match.matchSlots.map((slot) => {
      const teamPlayers = players.filter(
        (player) => player.teamSlot === slot.slotNumber,
      );
      const aliveCount = teamPlayers.filter(
        (player) => player.isAlive !== false,
      ).length;
      return {
        teamId: slot.teamId ?? null,
        slot: slot.slotNumber ?? null,
        name: slot.team?.name ?? null,
        tag: slot.team?.tag ?? null,
        logoUrl: normalizePublicAssetUrl(slot.team?.logoUrl),
        aliveCount,
        eliminated: aliveCount === 0 ? true : null,
      };
    });

    const zone = await this.prisma.matchTelemetry.findUnique({
      where: { matchId },
    });
    const nextShrinkAtMs =
      typeof liveState?.circle?.nextShrinkAt === 'number'
        ? liveState.circle.nextShrinkAt
        : zone?.zoneNextShrinkAt instanceof Date
          ? zone.zoneNextShrinkAt.getTime()
          : null;
    const timerRemaining =
      nextShrinkAtMs !== null ? Math.max(0, nextShrinkAtMs - Date.now()) : null;
    const timeRemainingToNextPhase =
      timerRemaining !== null ? Math.round(timerRemaining / 1000) : null;
    const phaseLabel =
      zone?.zonePhaseIndex !== null && zone?.zonePhaseIndex !== undefined
        ? `Phase ${zone.zonePhaseIndex}`
        : null;

    return {
      matchId,
      mapName,
      serverTime: Date.now(),
      safeZone: liveState?.circle?.safeZone
        ? {
            x: liveState.circle.safeZone.x,
            y: liveState.circle.safeZone.y,
            radius: liveState.circle.safeZone.r,
          }
        : zone?.zoneCenter && typeof zone.zoneCenter === 'object'
          ? {
              x: (zone.zoneCenter as Record<string, unknown>).x ?? null,
              y: (zone.zoneCenter as Record<string, unknown>).y ?? null,
              radius: zone.zoneRadius ?? null,
            }
          : { x: null, y: null, radius: null },
      nextSafeZone: liveState?.circle?.nextZone
        ? {
            x: liveState.circle.nextZone.x,
            y: liveState.circle.nextZone.y,
            radius: liveState.circle.nextZone.r,
          }
        : null,
      phase: liveState?.circle?.phase ?? zone?.zonePhaseIndex ?? null,
      nextPhaseAt: nextShrinkAtMs,
      timeRemainingToNextPhase,
      phaseLabel,
      players,
      teams,
    };
  }

  async getMapStateForActor(actor: Partial<AuthUser> | null, matchId: string) {
    const match = await this.lookupMatch(matchId);
    if (!match) throw new NotFoundException('Match not found');
    if (!this.canAccess(actor, match.tournament?.ownerUserId ?? '')) {
      throw new ForbiddenException('Not allowed to access match map state');
    }
    return this.getMapState(matchId);
  }
}

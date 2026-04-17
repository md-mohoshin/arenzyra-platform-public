import { Injectable, Logger } from '@nestjs/common';

type NodeInfo = { priority: number; last: number; capabilities: string[] };
type MatchScaleState = {
  leaderNodeId?: string; // failover mode
  leaderPriority?: number;
  leaderLastHeartbeat?: number;
  leaders: Record<string, string | undefined>; // per signal
  leaderPriorities: Record<string, number | undefined>;
  leaderLast: Record<string, number | undefined>;
  nodes: Map<string, NodeInfo>;
};

@Injectable()
export class ScaleService {
  private readonly logger = new Logger('ScaleService');
  private readonly enabled = process.env.SCALE_ENABLED !== 'false';
  private readonly timeoutMs =
    Number(process.env.SCALE_HEARTBEAT_TIMEOUT_SEC ?? 6) * 1000;
  private readonly preferHigher =
    (process.env.SCALE_PREFER_HIGHER_PRIORITY ?? 'true') === 'true';
  private readonly mode: 'failover_only' | 'active_active' =
    (process.env.SCALE_MODE as 'failover_only' | 'active_active') ||
    'active_active';
  private readonly dedupeTtlMs = 3000;
  private readonly signals = {
    TEAM_PANEL: [
      'MATCH_LIVE',
      'MATCH_END',
      'MATCH_ENDED',
      'TEAM_ALIVE',
      'TEAM_ELIMINATED',
      'TEAM_PLACEMENT',
    ],
    MINIMAP: ['TEAM_MINIMAP_PRESENCE'],
  };

  private matches = new Map<string, MatchScaleState>();
  private dedupe = new Map<string, number>();

  private state(matchId: string): MatchScaleState {
    if (!this.matches.has(matchId)) {
      this.matches.set(matchId, {
        nodes: new Map(),
        leaders: {},
        leaderPriorities: {},
        leaderLast: {},
      });
    }
    return this.matches.get(matchId)!;
  }

  private normalizeCaps(caps: string[] | undefined | null): string[] {
    if (!caps) return [];
    return caps
      .map((c) =>
        String(c || '')
          .trim()
          .toUpperCase(),
      )
      .filter((c) => !!c);
  }

  private pruneDedupe(now: number) {
    for (const [k, ts] of this.dedupe.entries()) {
      if (now - ts > this.dedupeTtlMs) this.dedupe.delete(k);
    }
  }

  filter(matchId: string, payload: unknown): boolean {
    if (!this.enabled) return true;
    if (!matchId || !payload) return true;
    const payloadRec = isRecord(payload) ? payload : {};
    const type = (
      getString(payloadRec.type) ??
      getString(payloadRec.eventType) ??
      ''
    )
      .trim()
      .toUpperCase();
    const meta = isRecord(payloadRec.meta) ? payloadRec.meta : {};
    const nodeId: string | undefined =
      getString(meta.nodeId) ?? getString(meta.node_id);
    const priority: number = Number(meta?.priority ?? 0);
    const now = Date.now();
    this.pruneDedupe(now);
    // sweep stale leaders before making accept decisions
    this.sweep(matchId, now);

    // Heartbeats always accepted and used for leader selection
    if (type === 'NODE_HEARTBEAT') {
      const capsSource =
        (Array.isArray(meta?.capabilities) && meta.capabilities) ||
        (isRecord(payloadRec.payload) &&
        Array.isArray(payloadRec.payload.capabilities)
          ? payloadRec.payload.capabilities
          : []);
      const caps: string[] = this.normalizeCaps(capsSource);
      if (!caps.length) {
        this.logger.warn(
          `[SCALE] heartbeat missing capabilities nodeId=${nodeId ?? 'unknown'} match=${matchId}`,
        );
      }
      this.updateLeader(matchId, nodeId, priority, now, caps);
      return true;
    }

    // If no node info, accept (backward compatible)
    if (!nodeId) return true;

    const st = this.state(matchId);
    // Determine signal
    const signal = this.resolveSignal(type);
    if (this.mode === 'active_active' && signal) {
      const leader = st.leaders[signal];
      if (!leader) {
        // No leader yet, try to elect deterministically
        this.promoteSignal(matchId, signal, nodeId, priority, now);
      }
      const current = this.state(matchId).leaders[signal];
      if (!current || current !== nodeId) {
        this.logger.warn(
          `[SCALE] dropped non-leader event node=${nodeId} type=${type} signal=${signal} leader=${current ?? 'none'}`,
        );
        return false;
      }
    } else {
      // failover_only mode
      if (!st.leaderNodeId) {
        const metaCaps = Array.isArray(meta?.capabilities)
          ? meta.capabilities
          : undefined;
        const leaderCaps = this.normalizeCaps(metaCaps ?? []);
        st.leaderNodeId = nodeId;
        st.leaderPriority = priority;
        st.leaderLastHeartbeat = now;
        st.nodes.set(nodeId, {
          priority,
          last: now,
          capabilities: leaderCaps,
        });
        this.logger.warn(
          `[SCALE] leader selected match=${matchId} leader=${nodeId}`,
        );
      }
      if (st.leaderNodeId && nodeId !== st.leaderNodeId) {
        this.logger.warn(
          `[SCALE] dropped non-leader event node=${nodeId} type=${type} leader=${st.leaderNodeId}`,
        );
        return false;
      }
    }

    // Dedupe by payload
    // Skip dedupe for high-frequency minimap presence to avoid suppressing updates
    if (type !== 'TEAM_MINIMAP_PRESENCE') {
      const key = `${matchId}|${type}|${JSON.stringify(payloadRec.payload ?? payloadRec)}`;
      if (
        this.dedupe.has(key) &&
        now - (this.dedupe.get(key) || 0) <= this.dedupeTtlMs
      ) {
        this.logger.warn(`[SCALE] dedupe drop type=${type}`);
        return false;
      }
      this.dedupe.set(key, now);
    }
    return true;
  }

  updateLeader(
    matchId: string,
    nodeId?: string,
    priority = 0,
    now: number = Date.now(),
    caps: string[] = [],
  ) {
    if (!nodeId) return;
    const normalizedCaps = this.normalizeCaps(caps);
    const st = this.state(matchId);
    st.nodes.set(nodeId, { priority, last: now, capabilities: normalizedCaps });
    // reevaluate leaders for provided capabilities
    for (const cap of normalizedCaps) {
      this.promoteSignal(
        matchId,
        cap,
        nodeId,
        priority,
        now,
        /*reason*/ 'heartbeat',
      );
    }

    if (this.mode === 'failover_only') {
      const leaderMissing =
        st.leaderLastHeartbeat &&
        now - (st.leaderLastHeartbeat || 0) > this.timeoutMs;
      const shouldPromote =
        !st.leaderNodeId ||
        leaderMissing ||
        (this.preferHigher &&
          priority > (st.leaderPriority ?? 0) &&
          st.leaderNodeId !== nodeId);

      if (shouldPromote) {
        const old = st.leaderNodeId;
        st.leaderNodeId = nodeId;
        st.leaderPriority = priority;
        st.leaderLastHeartbeat = now;
        if (old !== nodeId) {
          this.logger.warn(
            `[SCALE] leader changed match=${matchId} from=${old ?? 'none'} to=${nodeId}`,
          );
        } else if (leaderMissing) {
          this.logger.warn(
            `[SCALE] leader revived match=${matchId} leader=${nodeId}`,
          );
        }
        return;
      }

      if (st.leaderNodeId === nodeId) {
        st.leaderLastHeartbeat = now;
        st.leaderPriority = priority;
      }

      // Failover if leader timed out
      if (leaderMissing) {
        let bestNode: string | undefined;
        let bestPrio = -Infinity;
        for (const [id, info] of st.nodes.entries()) {
          if (now - info.last > this.timeoutMs) continue;
          if (info.priority > bestPrio) {
            bestPrio = info.priority;
            bestNode = id;
          }
        }
        if (bestNode) {
          const old = st.leaderNodeId;
          st.leaderNodeId = bestNode;
          st.leaderPriority = st.nodes.get(bestNode)?.priority;
          st.leaderLastHeartbeat = st.nodes.get(bestNode)?.last;
          this.logger.warn(
            `[SCALE] leader changed match=${matchId} from=${old ?? 'none'} to=${bestNode}`,
          );
        }
      }
    } else {
      // active_active handled by promoteSignal and sweep
      return;
    }
  }

  nodes(matchId: string) {
    const st = this.matches.get(matchId);
    if (!st) return { matchId, leaderNodeId: null, leaders: {}, nodes: [] };
    return {
      matchId,
      leaderNodeId: st.leaderNodeId ?? null,
      leaders: st.leaders ?? {},
      nodes: Array.from(st.nodes.entries()).map(([nodeId, info]) => ({
        nodeId,
        priority: info.priority,
        capabilities: info.capabilities,
        lastHeartbeatTs: info.last,
      })),
    };
  }

  private resolveSignal(type: string): string | null {
    for (const [sig, types] of Object.entries(this.signals)) {
      if (types.includes(type)) return sig;
    }
    return null;
  }

  private sweep(matchId: string, now: number) {
    const st = this.state(matchId);
    for (const signal of Object.keys(this.signals)) {
      const leader = st.leaders[signal];
      const last = st.leaderLast[signal] ?? 0;
      const leaderInfo = leader ? st.nodes.get(leader) : undefined;
      const leaderStale =
        !leaderInfo || now - (leaderInfo.last ?? last) > this.timeoutMs;
      // recompute deterministically
      this.promoteSignal(
        matchId,
        signal,
        undefined,
        undefined,
        now,
        leaderStale ? 'timeout' : undefined,
      );
    }
  }

  private promoteSignal(
    matchId: string,
    signal: string,
    nodeId?: string,
    priority?: number,
    now: number = Date.now(),
    reason?: string,
  ) {
    const st = this.state(matchId);
    // build candidate list of alive nodes with capability
    let bestNode: string | undefined;
    let bestPrio = -Infinity;
    for (const [id, info] of st.nodes.entries()) {
      if (!info.capabilities?.includes(signal)) continue;
      if (now - info.last > this.timeoutMs) continue;
      if (info.priority > bestPrio) {
        bestPrio = info.priority;
        bestNode = id;
      } else if (info.priority === bestPrio && bestNode && id < bestNode) {
        bestNode = id; // deterministic tie-breaker: lowest nodeId
      }
    }

    const curLeader = st.leaders[signal];
    const curPrio = st.leaderPriorities[signal] ?? -Infinity;
    const curAlive =
      curLeader &&
      st.nodes.has(curLeader) &&
      now - (st.nodes.get(curLeader)?.last ?? 0) <= this.timeoutMs;

    // If a specific node was provided (fresh heartbeat), check if it supersedes by higher priority
    if (nodeId && priority !== undefined) {
      if (
        curAlive &&
        priority > (curPrio ?? -Infinity) &&
        st.nodes.get(nodeId)?.capabilities?.includes(signal)
      ) {
        bestNode = nodeId;
        bestPrio = priority;
      }
    }

    if (!bestNode) {
      if (curLeader) {
        st.leaders[signal] = undefined;
        st.leaderPriorities[signal] = undefined;
        st.leaderLast[signal] = undefined;
        this.logger.warn(
          `[SCALE] leader lost capability=${signal} nodeId=${curLeader} reason=${reason ?? 'timeout'}`,
        );
      } else {
        this.logger.warn(
          `[SCALE] no candidates for capability=${signal} (leaders unchanged)`,
        );
      }
      return;
    }

    if (!curLeader) {
      st.leaders[signal] = bestNode;
      st.leaderPriorities[signal] = bestPrio;
      st.leaderLast[signal] = st.nodes.get(bestNode)?.last ?? now;
      this.logger.warn(
        `[SCALE] leader selected capability=${signal} nodeId=${bestNode} priority=${bestPrio}`,
      );
      return;
    }

    // Keep current leader unless superseded by strictly higher priority or current is stale
    if (!curAlive || bestPrio > (curPrio ?? -Infinity)) {
      const reasonText = !curAlive ? 'timeout' : 'superseded';
      this.logger.warn(
        `[SCALE] leader lost capability=${signal} nodeId=${curLeader} reason=${reasonText}`,
      );
      st.leaders[signal] = bestNode;
      st.leaderPriorities[signal] = bestPrio;
      st.leaderLast[signal] = st.nodes.get(bestNode)?.last ?? now;
      this.logger.warn(
        `[SCALE] leader selected capability=${signal} nodeId=${bestNode} priority=${bestPrio}`,
      );
      return;
    }

    // No change; optionally log when curLeader still authoritative
    if (reason === 'heartbeat') {
      this.logger.debug?.(
        `[SCALE] leader retained capability=${signal} nodeId=${curLeader} priority=${curPrio}`,
      );
    }
  }
}

const isRecord = (val: unknown): val is Record<string, unknown> =>
  !!val && typeof val === 'object';

const getString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

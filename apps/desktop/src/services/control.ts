import { io, Socket } from "socket.io-client";
import type { BackendSnapshot, KillEvent, LivePlayer, LiveTeam } from "./backend";

export type ControlStatus = "PENDING" | "LIVE" | "FINISHED";

export type ControlTeam = {
  teamId: string;
  name: string | null;
  tag: string | null;
  slot: number | null;
  kills: number;
  placement: number | null;
  points: number | null;
  logoUrl: string | null;
  alivePlayers?: number | null;
  totalPlayers?: number | null;
  alive?: boolean;
  players?: Array<{
    id?: string | null;
    ign?: string | null;
    name?: string | null;
    alive?: boolean;
    knocked?: boolean;
  }>;
};

export type ControlState = {
  matchId: string;
  status: ControlStatus;
  startedAt: string | null;
  endedAt: string | null;
  version: number;
  updatedAt: string;
  teams: ControlTeam[];
  matchName?: string | null;
  mapName?: string | null;
  phase?: string | number | null;
  timerMs?: number | null;
  aliveTeams?: number | null;
  alivePlayers?: number | null;
};

export type KillFeedItem = {
  matchId: string;
  teamId: string;
  delta: number;
  totalKills: number;
  ts: number;
};

type ServerToClientEvents = {
  "match:state": (state: ControlState) => void;
  "match:update": (state: ControlState) => void;
  "match:end": (state: ControlState) => void;
  "kill:feed": (payload: KillFeedItem) => void;
};

type ClientToServerEvents = {
  "match:join": (
    payload: { matchId: string },
    ack?: (payload: { ok: boolean; state?: ControlState; error?: string }) => void,
  ) => void;
  "control:ping": (payload: { matchId?: string }) => void;
};

export type ControlSocket = {
  connect: () => void;
  disconnect: () => void;
};

const toSnapshot = (state: ControlState, feed: KillFeedItem[]): BackendSnapshot => {
  const teams: LiveTeam[] = state.teams.map((t) => ({
    id: t.teamId,
    name: t.name,
    tag: t.tag,
    slot: t.slot,
    logoUrl: t.logoUrl,
    color: null,
    kills: t.kills,
    placement: t.placement,
    points: t.points,
    alivePlayers: t.alivePlayers,
    totalPlayers: t.totalPlayers,
    alive:
      t.alivePlayers === null || t.alivePlayers === undefined
        ? undefined
        : t.alivePlayers > 0,
  }));

  const players: LivePlayer[] = state.teams.flatMap((t) =>
    (t.players ?? []).map((p, idx) => ({
      id: p.id || `${t.teamId}-p${idx + 1}`,
      ign: p.ign ?? p.name ?? null,
      name: p.name ?? p.ign ?? null,
      teamId: t.teamId,
      photoUrl: null,
    })),
  );

  const kills: KillEvent[] = feed.map((k) => ({
    ts: k.ts,
    killerTeamId: k.teamId,
    killerName: null,
    victimTeamId: null,
    victimName: null,
    weapon: null,
  }));

  return {
    match: {
      matchId: state.matchId,
      status: state.status,
      startedAt: state.startedAt,
      updatedAt: state.updatedAt,
    },
    teams,
    players,
    kills,
    circle: null,
    observer: null,
  };
};

export function createControlSocket(
  baseUrl: string,
  token: string,
  matchId: string,
  handlers: {
    onSnapshot: (snap: BackendSnapshot) => void;
    onUpdate: (snap: BackendSnapshot) => void;
    onStatus: (status: "disconnected" | "connecting" | "connected" | "error") => void;
  },
): ControlSocket {
  let socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;
  const feed: KillFeedItem[] = [];
  let lastState: ControlState | null = null;

  const connect = () => {
    const base = baseUrl.replace(/\/$/, "");
    const url = base + "/ws";
    handlers.onStatus("connecting");
    socket = io(url, {
      transports: ["websocket", "polling"],
      path: "/socket.io",
      auth: { token },
      extraHeaders: { Authorization: `Bearer ${token}` },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelayMax: 5000,
    });

    const join = () => socket?.emit("match:join", { matchId }, (ack) => {
      if (ack?.ok && ack.state) {
        feed.length = 0;
        lastState = ack.state;
        handlers.onSnapshot(toSnapshot(ack.state, feed));
        handlers.onStatus("connected");
      } else if (ack && !ack.ok) {
        handlers.onStatus("error");
      }
    });

    socket.on("connect", () => {
      handlers.onStatus("connected");
      join();
      socket?.emit("control:ping", { matchId });
    });
    socket.on("disconnect", () => handlers.onStatus("disconnected"));
    socket.on("connect_error", () => handlers.onStatus("error"));
    socket.on("match:state", (state) => {
      lastState = state;
      handlers.onSnapshot(toSnapshot(state, feed));
    });
    socket.on("match:update", (state) => {
      lastState = state;
      handlers.onUpdate(toSnapshot(state, feed));
    });
    socket.on("match:end", (state) => {
      lastState = state;
      handlers.onUpdate(toSnapshot(state, feed));
    });
    socket.on("kill:feed", (item) => {
      feed.unshift(item);
      feed.splice(50);
      handlers.onUpdate(toSnapshot(stateFallback(lastState ?? undefined), feed));
    });
  };

  const stateFallback = (state: ControlState | undefined): ControlState =>
    state ?? {
      matchId,
      status: "PENDING",
      startedAt: null,
      endedAt: null,
      version: 0,
      updatedAt: new Date().toISOString(),
      teams: [],
    };

  const disconnect = () => {
    if (socket) {
      socket.removeAllListeners();
      socket.disconnect();
      socket = null;
    }
  };

  return { connect, disconnect };
}

export async function fetchControlSnapshot(
  api: { get: (path: string) => Promise<{ data: unknown }> },
  matchId: string,
): Promise<BackendSnapshot> {
  const res = await api.get(`/me/matches/${matchId}/control`);
  const state = res.data as ControlState;
  return toSnapshot(state, []);
}

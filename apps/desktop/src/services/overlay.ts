import { io, Socket } from "socket.io-client";
import type { BackendSnapshot, KillEvent, LiveTeam } from "./backend";

export type OverlayTeamDto = {
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
};

export type OverlayMatchStateDto = {
  matchId: string;
  status: string;
  startedAt: string | null;
  endedAt: string | null;
  version: number;
  updatedAt: string;
  teams: OverlayTeamDto[];
  focus?: unknown;
};

export type OverlayKillFeedDto = {
  matchId: string;
  teamId: string;
  delta: number;
  totalKills: number;
  ts: number;
};

export type OverlaySocketStatus = "disconnected" | "connecting" | "connected" | "error";

type ServerToClientEvents = {
  "overlay:state": (payload: OverlayMatchStateDto) => void;
  "overlay:update": (payload: OverlayMatchStateDto) => void;
  "overlay:end": (payload: OverlayMatchStateDto) => void;
  "overlay:killfeed": (payload: OverlayKillFeedDto) => void;
  "overlay:focus": (payload: unknown) => void;
};

type ClientToServerEvents = {
  "overlay:join": (payload: { matchId: string }) => void;
};

const toSnapshot = (state: OverlayMatchStateDto, killFeed: OverlayKillFeedDto[]): BackendSnapshot => {
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

  const kills: KillEvent[] = killFeed
    .filter((k) => k.matchId === state.matchId)
    .map((k) => ({
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
    players: [], // overlay state does not include players
    kills,
    circle: null,
    observer: null,
  };
};

export function createOverlaySocket(
  baseUrl: string,
  matchId: string,
  handlers: {
    onSnapshot: (snap: BackendSnapshot) => void;
    onUpdate: (snap: BackendSnapshot) => void;
    onStatus: (status: OverlaySocketStatus) => void;
  },
) {
  let socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;
  const killFeed: OverlayKillFeedDto[] = [];
  let lastState: OverlayMatchStateDto | null = null;

  const connect = () => {
      handlers.onStatus("connecting");
      socket = io(`${baseUrl.replace(/\/$/, "")}/overlay`, {
        transports: ["websocket", "polling"],
      });

    socket.on("connect", () => {
      handlers.onStatus("connected");
      socket?.emit("overlay:join", { matchId });
    });
    socket.on("disconnect", () => handlers.onStatus("disconnected"));
    socket.on("connect_error", () => handlers.onStatus("error"));

    socket.on("overlay:state", (state) => {
      lastState = state;
      handlers.onSnapshot(toSnapshot(state, killFeed));
    });
    socket.on("overlay:update", (state) => {
      lastState = state;
      handlers.onUpdate(toSnapshot(state, killFeed));
    });
    socket.on("overlay:end", (state) => {
      lastState = state;
      handlers.onUpdate(toSnapshot(state, killFeed));
    });
    socket.on("overlay:killfeed", (item) => {
      killFeed.unshift(item);
      killFeed.splice(50);
      if (lastState) {
        handlers.onUpdate(toSnapshot(lastState, killFeed));
      }
    });
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

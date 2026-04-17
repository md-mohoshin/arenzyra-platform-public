import axios from "axios";
import type { KillEvent, LivePlayer, LiveTeam } from "./backend";

export const defaultPcobBase = import.meta.env.VITE_PCOB_BASE_URL || "http://localhost:4000";

export type PcobClient = {
  loadTeams: (teams: LiveTeam[]) => Promise<void>;
  pushTeams: (teams: LiveTeam[]) => Promise<void>;
  loadPlayers: (players: LivePlayer[]) => Promise<void>;
  loadLogos: (teams: LiveTeam[]) => Promise<void>;
  assignSlots: (slots: Array<{ slot: number; teamId: string }>) => Promise<void>;
  loadTheme: (theme: BrandingPackage) => Promise<void>;
  loadOverlayTemplate: (template: OverlayTemplate) => Promise<void>;
  loadBranding: (branding: BrandingPackage) => Promise<void>;
  updateScoreboard: (matchId: string, teams: LiveTeam[]) => Promise<void>;
  updateKillfeed: (matchId: string, kills: KillEvent[]) => Promise<void>;
  updatePlayerHud: (payload: PlayerHudPayload) => Promise<void>;
  updateCircle: (payload: CirclePayload) => Promise<void>;
  updateStats: (matchId: string, stats: Record<string, unknown>) => Promise<void>;
  showOverlay: (templateId: string, payload?: Record<string, unknown>) => Promise<void>;
  hideOverlay: (templateId: string) => Promise<void>;
  triggerAnimation: (key: string, templateId?: string) => Promise<void>;
  resetGraphics: () => Promise<void>;
};

export type BrandingPackage = {
  tournament?: string;
  theme?: string;
  font?: string;
  primaryColor?: string;
  secondaryColor?: string;
  teamLogos?: Record<string, string>;
  playerPhotos?: Record<string, string>;
  sponsorAssets?: Record<string, string>;
};

export type OverlayTemplate = {
  templateId: string;
  name: string;
  layout: string;
  supports: string[];
  animations?: string[];
};

export type PlayerHudPayload = {
  playerId: string;
  teamId?: string | null;
  ign?: string | null;
  name?: string | null;
  hp?: number | null;
  status?: string | null;
  weapons?: string[] | null;
  stance?: string | null;
};

export type CirclePayload = {
  phase?: number | null;
  center?: { x: number; y: number } | null;
  radius?: number | null;
  nextShrinkAt?: number | null;
  shrinking?: boolean;
};

export function makePcobClient(baseUrl: string): PcobClient {
  const base = baseUrl.replace(/\/$/, "") || defaultPcobBase;
  const client = axios.create({ baseURL: base });

  const loadTeams = async (teams: LiveTeam[]) => {
    await client.post("/pcob/load-teams", {
      teams: teams.map((t) => ({
        id: t.id,
        name: t.name,
        tag: t.tag,
        slot: t.slot,
        logoUrl: t.logoUrl,
        color: t.color,
      })),
    });
  };

  const pushTeams = async (teams: LiveTeam[]) => {
    await client.post("/pcob/pushTeams", {
      teams: teams.map((t) => ({
        id: t.id,
        name: t.name,
        tag: t.tag,
        slot: t.slot,
        logoUrl: t.logoUrl,
        color: t.color,
      })),
    });
  };

  const loadPlayers = async (players: LivePlayer[]) => {
    await client.post("/pcob/load-players", {
      players: players.map((p) => ({
        id: p.id,
        name: p.name ?? p.ign,
        ign: p.ign,
        teamId: p.teamId,
        photoUrl: p.photoUrl,
      })),
    });
  };

  const loadLogos = async (teams: LiveTeam[]) => {
    await client.post("/pcob/load-logos", {
      logos: teams.map((t) => ({ teamId: t.id, logoUrl: t.logoUrl })),
    });
  };

  const assignSlots = async (slots: Array<{ slot: number; teamId: string }>) => {
    if (!slots.length) return;
    await client.post("/pcob/assign-slots", { slots });
  };

  const loadTheme = async (theme: BrandingPackage) => {
    await client.post("/pcob/load-theme", theme);
  };

  const loadOverlayTemplate = async (template: OverlayTemplate) => {
    await client.post("/pcob/load-overlay-template", template);
  };

  const loadBranding = async (branding: BrandingPackage) => {
    await client.post("/pcob/load-branding", branding);
  };

  const updateScoreboard = async (matchId: string, teams: LiveTeam[]) => {
    await client.post("/pcob/update-scoreboard", {
      matchId,
      teams: teams.map((t) => ({
        teamId: t.id,
        placement: t.placement,
        kills: t.kills,
        points: t.points,
        slot: t.slot,
        name: t.name,
        tag: t.tag,
      })),
    });
  };

  const updateKillfeed = async (matchId: string, kills: KillEvent[]) => {
    const sorted = [...kills].sort((a, b) => b.ts - a.ts).slice(0, 50);
    await client.post("/pcob/update-killfeed", {
      matchId,
      events: sorted.map((k) => ({
        ts: k.ts,
        killerTeamId: k.killerTeamId,
        victimTeamId: k.victimTeamId,
        killerName: k.killerName,
        victimName: k.victimName,
        weapon: k.weapon,
      })),
    });
  };

  const updatePlayerHud = async (payload: PlayerHudPayload) => {
    await client.post("/pcob/update-playerhud", payload);
  };

  const updateCircle = async (payload: CirclePayload) => {
    await client.post("/pcob/update-circle", payload);
  };

  const updateStats = async (matchId: string, stats: Record<string, unknown>) => {
    await client.post("/pcob/update-stats", { matchId, stats });
  };

  const showOverlay = async (templateId: string, payload: Record<string, unknown> = {}) => {
    await client.post("/pcob/show-overlay", { templateId, payload });
  };

  const hideOverlay = async (templateId: string) => {
    await client.post("/pcob/hide-overlay", { templateId });
  };

  const triggerAnimation = async (key: string, templateId?: string) => {
    await client.post("/pcob/trigger-animation", { key, templateId });
  };

  const resetGraphics = async () => {
    await client.post("/pcob/reset-graphics");
  };

  return {
    loadTeams,
    pushTeams,
    loadPlayers,
    loadLogos,
    assignSlots,
    loadTheme,
    loadOverlayTemplate,
    loadBranding,
    updateScoreboard,
    updateKillfeed,
    updatePlayerHud,
    updateCircle,
    updateStats,
    showOverlay,
    hideOverlay,
    triggerAnimation,
    resetGraphics,
  };
}

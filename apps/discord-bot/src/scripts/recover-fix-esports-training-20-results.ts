import { REST, Routes, type RESTPostAPIChannelMessageResult } from "discord.js";
import {
  ArenzyraApiClient,
  type MatchResultRowResponse,
  type SessionMatchResponse,
  type SessionRegistrationResponse,
} from "../api/api-client";
import { botConfig } from "../config";
import { DiscordSessionService } from "../services/session.service";

export const TARGET_SESSION_NAME = "Fix Esports Training Series 20:00";
export const TARGET_GUILD_NAME = "Fix Esports";
export const TARGET_SESSION_NAMES = {
  "20": [
    TARGET_SESSION_NAME,
    "Fix Esports Traning Series 20:00",
    "FIX ESPORTS | 20:00",
  ],
  "23": [
    "Fix Esports Training Series 23:00",
    "Fix Esports Traning Series 23:00",
    "FIX ESPORTS | 23:00",
  ],
} as const;

export type RecoveryTeamKey =
  | "SGE" | "FPS" | "NOVEX" | "HEL" | "DS" | "AB" | "TRH"
  | "GOAT" | "GHOST" | "SV" | "ELP" | "G7" | "OG" | "OUT"
  | "MERCY" | "CLY" | "4M" | "GE" | "N1"
  | "PI" | "TL23" | "C2" | "C4" | "AG" | "VCS" | "BLX"
  | "MPWR" | "TI" | "MAR" | "TEAM6" | "OUT_MAIN" | "OUT44"
  | "TEAM11" | "2K" | "HOMIES";

export type RecoveryResult = {
  team: RecoveryTeamKey;
  placement: number;
  kills: number;
};

export const RECOVERY_GAMES: Readonly<Record<number, readonly RecoveryResult[]>> = {
  1: [
    { team: "SGE", placement: 1, kills: 16 },
    { team: "FPS", placement: 2, kills: 5 },
    { team: "NOVEX", placement: 3, kills: 10 },
    { team: "HEL", placement: 4, kills: 11 },
    { team: "DS", placement: 5, kills: 0 },
    { team: "AB", placement: 6, kills: 0 },
    { team: "TRH", placement: 7, kills: 1 },
    { team: "GOAT", placement: 8, kills: 1 },
    { team: "GHOST", placement: 9, kills: 0 },
    { team: "SV", placement: 10, kills: 1 },
    { team: "ELP", placement: 11, kills: 1 },
    { team: "G7", placement: 12, kills: 0 },
    { team: "OG", placement: 13, kills: 3 },
    { team: "OUT", placement: 14, kills: 2 },
    { team: "MERCY", placement: 15, kills: 2 },
    { team: "CLY", placement: 16, kills: 1 },
    { team: "4M", placement: 17, kills: 0 },
    { team: "GE", placement: 18, kills: 0 },
  ],
  2: [
    { team: "TRH", placement: 1, kills: 14 },
    { team: "GOAT", placement: 2, kills: 5 },
    { team: "AB", placement: 3, kills: 7 },
    { team: "MERCY", placement: 4, kills: 1 },
    { team: "OG", placement: 5, kills: 4 },
    { team: "ELP", placement: 6, kills: 2 },
    { team: "FPS", placement: 7, kills: 0 },
    { team: "GHOST", placement: 8, kills: 0 },
    { team: "DS", placement: 9, kills: 10 },
    { team: "N1", placement: 10, kills: 2 },
    { team: "SGE", placement: 11, kills: 7 },
    { team: "NOVEX", placement: 12, kills: 3 },
    { team: "OUT", placement: 13, kills: 1 },
    { team: "4M", placement: 14, kills: 0 },
    { team: "SV", placement: 15, kills: 1 },
    { team: "HEL", placement: 16, kills: 3 },
    { team: "CLY", placement: 17, kills: 1 },
    { team: "G7", placement: 18, kills: 1 },
    { team: "GE", placement: 19, kills: 1 },
  ],
  3: [
    { team: "AB", placement: 1, kills: 9 },
    { team: "N1", placement: 2, kills: 18 },
    { team: "GOAT", placement: 3, kills: 2 },
    { team: "SGE", placement: 4, kills: 11 },
    { team: "HEL", placement: 5, kills: 7 },
    { team: "OUT", placement: 6, kills: 6 },
    { team: "4M", placement: 7, kills: 8 },
    { team: "NOVEX", placement: 8, kills: 9 },
    { team: "FPS", placement: 9, kills: 3 },
    { team: "OG", placement: 10, kills: 12 },
    { team: "G7", placement: 11, kills: 3 },
    { team: "TRH", placement: 12, kills: 6 },
    { team: "DS", placement: 13, kills: 2 },
    { team: "ELP", placement: 14, kills: 1 },
    { team: "GE", placement: 15, kills: 2 },
    { team: "MERCY", placement: 16, kills: 7 },
    { team: "CLY", placement: 17, kills: 5 },
    { team: "SV", placement: 18, kills: 5 },
    { team: "GHOST", placement: 19, kills: 0 },
  ],
  4: [
    { team: "SGE", placement: 1, kills: 10 },
    { team: "NOVEX", placement: 2, kills: 6 },
    { team: "N1", placement: 3, kills: 9 },
    { team: "MERCY", placement: 4, kills: 5 },
    { team: "DS", placement: 5, kills: 2 },
    { team: "GOAT", placement: 6, kills: 4 },
    { team: "ELP", placement: 7, kills: 7 },
    { team: "CLY", placement: 8, kills: 0 },
    { team: "AB", placement: 9, kills: 0 },
    { team: "GHOST", placement: 10, kills: 1 },
    { team: "TRH", placement: 11, kills: 1 },
    { team: "HEL", placement: 12, kills: 5 },
    { team: "OG", placement: 13, kills: 4 },
    { team: "G7", placement: 14, kills: 0 },
    { team: "4M", placement: 15, kills: 0 },
    { team: "OUT", placement: 16, kills: 0 },
  ],
};

export const RECOVERY_GAMES_23: Readonly<Record<number, readonly RecoveryResult[]>> = {
  1: [
    { team: "AB", placement: 1, kills: 10 },
    { team: "BLX", placement: 2, kills: 9 },
    { team: "2K", placement: 3, kills: 6 },
    { team: "TI", placement: 4, kills: 1 },
    { team: "OUT_MAIN", placement: 5, kills: 0 },
    { team: "C4", placement: 6, kills: 0 },
    { team: "AG", placement: 7, kills: 2 },
    { team: "TL23", placement: 8, kills: 5 },
    { team: "PI", placement: 9, kills: 0 },
    { team: "TEAM6", placement: 10, kills: 0 },
    { team: "CLY", placement: 11, kills: 4 },
    { team: "GE", placement: 12, kills: 8 },
    { team: "VCS", placement: 13, kills: 2 },
    { team: "G7", placement: 14, kills: 3 },
    { team: "C2", placement: 15, kills: 0 },
    { team: "MPWR", placement: 16, kills: 5 },
    { team: "HOMIES", placement: 17, kills: 0 },
    { team: "MAR", placement: 18, kills: 0 },
    { team: "OUT44", placement: 19, kills: 2 },
  ],
  2: [
    { team: "PI", placement: 1, kills: 15 },
    { team: "TL23", placement: 2, kills: 9 },
    { team: "C2", placement: 3, kills: 10 },
    { team: "GE", placement: 4, kills: 0 },
    { team: "C4", placement: 5, kills: 13 },
    { team: "AB", placement: 6, kills: 4 },
    { team: "VCS", placement: 7, kills: 7 },
    { team: "MPWR", placement: 8, kills: 5 },
    { team: "MAR", placement: 9, kills: 1 },
    { team: "OUT_MAIN", placement: 10, kills: 0 },
    { team: "TEAM11", placement: 11, kills: 0 },
    { team: "BLX", placement: 12, kills: 3 },
    { team: "AG", placement: 13, kills: 0 },
    { team: "TEAM6", placement: 14, kills: 0 },
    { team: "OUT44", placement: 15, kills: 0 },
    { team: "HOMIES", placement: 16, kills: 0 },
    { team: "TI", placement: 17, kills: 0 },
    { team: "G7", placement: 18, kills: 1 },
    { team: "2K", placement: 19, kills: 2 },
  ],
  3: [
    { team: "OUT44", placement: 1, kills: 15 },
    { team: "GE", placement: 2, kills: 6 },
    { team: "PI", placement: 3, kills: 9 },
    { team: "2K", placement: 4, kills: 11 },
    { team: "MPWR", placement: 5, kills: 2 },
    { team: "AG", placement: 6, kills: 11 },
    { team: "BLX", placement: 7, kills: 13 },
    { team: "AB", placement: 8, kills: 6 },
    { team: "VCS", placement: 9, kills: 9 },
    { team: "G7", placement: 10, kills: 3 },
    { team: "CLY", placement: 11, kills: 9 },
    { team: "TI", placement: 12, kills: 1 },
    { team: "MAR", placement: 13, kills: 1 },
    { team: "OUT_MAIN", placement: 14, kills: 5 },
    { team: "TL23", placement: 15, kills: 4 },
    { team: "C4", placement: 16, kills: 4 },
    { team: "C2", placement: 17, kills: 0 },
    { team: "TEAM6", placement: 18, kills: 2 },
  ],
  4: [
    { team: "AG", placement: 1, kills: 4 },
    { team: "TL23", placement: 2, kills: 9 },
    { team: "AB", placement: 3, kills: 9 },
    { team: "TI", placement: 4, kills: 2 },
    { team: "VCS", placement: 5, kills: 0 },
    { team: "CLY", placement: 6, kills: 3 },
    { team: "C4", placement: 7, kills: 8 },
    { team: "PI", placement: 8, kills: 3 },
    { team: "MAR", placement: 9, kills: 1 },
    { team: "GE", placement: 10, kills: 2 },
    { team: "OUT44", placement: 11, kills: 9 },
    { team: "BLX", placement: 12, kills: 2 },
    { team: "TEAM6", placement: 13, kills: 0 },
    { team: "MPWR", placement: 14, kills: 4 },
    { team: "2K", placement: 15, kills: 2 },
    { team: "C2", placement: 16, kills: 1 },
    { team: "G7", placement: 17, kills: 1 },
  ],
};

const TEAM_ALIASES: Readonly<Record<RecoveryTeamKey, readonly string[]>> = {
  SGE: ["sge"], FPS: ["fps"], NOVEX: ["novex"], HEL: ["hel"],
  DS: ["ds"], AB: ["ab"], TRH: ["trh"], GOAT: ["goat"],
  GHOST: ["ghost"], SV: ["sv", "svmvp"], ELP: ["elp"], G7: ["g7"],
  OG: ["og"], OUT: ["out"], MERCY: ["mercy"], CLY: ["cly"],
  "4M": ["4m"], GE: ["ge"], N1: ["n1"],
  PI: ["pi"], TL23: ["tl", "tl23"], C2: ["c2"], C4: ["c4"],
  AG: ["ag"], VCS: ["vcs"], BLX: ["blx"], MPWR: ["mpwr"],
  TI: ["ti"], MAR: ["mar"], TEAM6: ["team6"],
  OUT_MAIN: ["outmain"], OUT44: ["out44"], TEAM11: ["team11"],
  "2K": ["2k"], HOMIES: ["homies"],
};

const PLAYER_ANCHORS: Readonly<Record<RecoveryTeamKey, readonly string[]>> = {
  SGE: ["vegaboyyy", "buro", "harlow77k"],
  FPS: ["raes", "naruto", "sauron", "mask", "s7"],
  NOVEX: ["trip99k", "soulman", "fates", "shine"],
  HEL: ["clumsy", "bilal", "altair"],
  DS: ["seeyou", "redalone", "mushi", "eagle", "t3rror"],
  AB: ["bladexhawk", "phantom", "bunny", "caraxes"],
  TRH: ["alazar", "clutcher77", "kova", "bundi"],
  GOAT: ["godless", "shakku", "madl", "akhil"],
  GHOST: ["rehan", "brand", "blitz"],
  SV: ["ninja", "nobey", "avand", "c4ptin"],
  ELP: ["arrow", "dentex", "giannel", "edison"],
  G7: ["yenni", "akai", "horsemann", "lucyie"],
  OG: ["gill", "sandhu", "dhillon", "raja", "iqoo"],
  OUT: ["fuego", "spasic", "zeltex", "gagibog"],
  MERCY: ["mercyyash", "mercygod", "mercysavage", "scout", "mercyjdt"],
  CLY: ["rayder", "nitro", "raven", "zoroboy"],
  "4M": ["slayzy", "midrell", "bingalo", "vagaa"],
  GE: ["sanjay", "gexdip", "gexnasty"],
  N1: ["andyy", "besk", "twixx", "bibis"],
  PI: ["zenits", "nikeyw", "aymanw", "s9levii"],
  TL23: ["tlliar", "toxin302", "stiles", "tlhell"],
  C2: ["cmpxwbk", "havertz", "brimowbk", "cr7wbk"],
  C4: ["papito", "octomvp", "sigma", "dems"],
  AG: ["agerzemon", "agxfaceless", "agrezsukuna", "agrezwolf"],
  VCS: ["vcsicy", "zeyn", "zayn", "theworldis"],
  BLX: ["blxthanos", "blxwarvs99", "blxzax", "blxivar24"],
  MPWR: ["mpwrskorup", "ddn007", "mpwrmeister", "mpwrcera77"],
  TI: ["bicho", "andre", "kywinky", "david"],
  MAR: ["tiagoxb", "caquilo", "ptwyuki", "killerofs"],
  TEAM6: ["byakuya", "tuki", "sapiboss", "geniyakuza", "50kingboss"],
  OUT_MAIN: ["outxrp", "hrsvetilija", "outrainbowdash", "kukixm"],
  OUT44: ["dwtmadeira", "outgoat44", "outpatron44", "outspasic44"],
  TEAM11: ["yallasaro", "maskdear", "hpsxri0077k", "karyaro"],
  "2K": ["coolboy", "psesasuke", "joyboy"],
  HOMIES: ["homiesyoyo", "homieslucifr", "homiesyakuza", "homieslafa"],
};

export function normalizeRecoveryText(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function selectRecoveryGuild(
  guilds: Array<{ id: string; name: string }>,
) {
  const targetName = normalizeRecoveryText(TARGET_GUILD_NAME);
  const targets = guilds.filter(
    (guild) => normalizeRecoveryText(guild.name) === targetName,
  );
  if (targets.length !== 1) {
    throw new Error(
      `Fix Esports Discord guild count is ${targets.length}, expected exactly 1`,
    );
  }
  return targets[0];
}

export function selectRecoverySession<
  T extends { name: string; status?: string | null; startsAt?: string | null },
>(sessions: T[], sessionNames: readonly string[], series: "20" | "23") {
  const normalizedSessionNames = new Set(sessionNames.map(normalizeRecoveryText));
  const exact = sessions.filter(
    (session) => normalizedSessionNames.has(normalizeRecoveryText(session.name)),
  );
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    throw new Error(`target ${series}:00 session count is ${exact.length}, expected exactly 1`);
  }

  const related = sessions.filter((session) => {
    const words = new Set(normalizeRecoveryText(session.name).split(/\s+/g));
    return words.has(series) && words.has("series") &&
      (words.has("training") || words.has("traning"));
  });
  if (related.length === 1) return related[0];

  const inventory = sessions
    .filter((session) => {
      const words = new Set(normalizeRecoveryText(session.name).split(/\s+/g));
      return words.has(series) || words.has("training") || words.has("traning");
    })
    .slice(0, 12)
    .map((session) => ({
      name: session.name,
      status: session.status ?? null,
      startsAt: session.startsAt ?? null,
    }));
  throw new Error(
    `target ${series}:00 session count is ${related.length}, expected exactly 1; related=${JSON.stringify(inventory)}`,
  );
}

function compact(value: string | null | undefined) {
  return normalizeRecoveryText(value).replace(/\s+/g, "");
}

export function recoveryTeamScore(row: MatchResultRowResponse, key: RecoveryTeamKey) {
  const tag = compact(row.team?.tag);
  const name = normalizeRecoveryText(row.team?.name);
  const nameWords = new Set(name.split(/\s+/g).filter(Boolean));
  let score = 0;
  for (const alias of TEAM_ALIASES[key]) {
    if (tag === alias) score = Math.max(score, 100);
    if (nameWords.has(alias) || compact(name) === alias) score = Math.max(score, 60);
  }
  const players = (row.players ?? []).map((player) => compact(player.name));
  for (const anchor of PLAYER_ANCHORS[key]) {
    if (players.some((player) => player.includes(anchor))) score += 10;
  }
  return score;
}

export function recoveryRegistrationTeamScore(
  registration: SessionRegistrationResponse,
  key: RecoveryTeamKey,
) {
  return recoveryTeamScore({
    id: registration.id,
    matchId: "recovery-registration",
    teamId: registration.teamId,
    slot: registration.slotNumber,
    kills: 0,
    placement: null,
    placementPoints: 0,
    totalPoints: 0,
    team: registration.team,
    players: [],
  }, key);
}

export function mapRecoveryRegistrations(
  registrations: SessionRegistrationResponse[],
  keys: readonly RecoveryTeamKey[],
) {
  const unique = new Map<string, SessionRegistrationResponse>();
  for (const registration of registrations) {
    if (registration.team) unique.set(registration.teamId, registration);
  }
  const candidates = Array.from(unique.values());
  const used = new Set<string>();
  return keys.map((key) => {
    const scored = candidates
      .filter((registration) => !used.has(registration.teamId))
      .map((registration) => ({
        registration,
        score: recoveryRegistrationTeamScore(registration, key),
      }))
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => right.score - left.score);
    if (!scored.length || (scored[1] && scored[1].score === scored[0].score)) {
      throw new Error(`deleted registration team ${key} did not resolve uniquely`);
    }
    used.add(scored[0].registration.teamId);
    return {
      key,
      teamId: scored[0].registration.teamId,
      label: scored[0].registration.team?.tag?.trim() ||
        scored[0].registration.team?.name?.trim() || key,
    };
  });
}

export function mapRecoveryRows(
  rows: MatchResultRowResponse[],
  expected: readonly RecoveryResult[],
) {
  const active = rows.filter((row) => row.wasPresentInMatch !== false);
  if (active.length !== expected.length) {
    throw new Error(`active team count ${active.length} does not match screenshot count ${expected.length}`);
  }
  const used = new Set<string>();
  return expected.map((entry) => {
    const scored = active
      .filter((row) => !used.has(row.teamId))
      .map((row) => ({ row, score: recoveryTeamScore(row, entry.team) }))
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => right.score - left.score);
    if (!scored.length || (scored[1] && scored[1].score === scored[0].score)) {
      throw new Error(`team ${entry.team} did not resolve uniquely`);
    }
    used.add(scored[0].row.teamId);
    return {
      teamId: scored[0].row.teamId,
      placement: entry.placement,
      kills: entry.kills,
      label: scored[0].row.team?.tag?.trim() || scored[0].row.team?.name?.trim() || entry.team,
    };
  });
}

function matchForGame(matches: SessionMatchResponse[], game: number) {
  const candidates = matches.filter((match) => match.matchNumber === game);
  if (candidates.length !== 1) {
    const inventory = matches.slice(0, 12).map((match) => ({
      name: match.name ?? null,
      matchNumber: match.matchNumber ?? null,
      status: match.status ?? null,
      liveState: match.liveState ?? null,
    }));
    throw new Error(
      `game ${game} match count is ${candidates.length}, expected exactly 1; matches=${JSON.stringify(inventory)}`,
    );
  }
  return candidates[0];
}

async function run() {
  const mode = process.argv[2];
  const parsed = /^--(20|23)-(check|apply)$/.exec(mode ?? "");
  if (process.argv.length !== 3 || !parsed) {
    throw new Error("exactly --20-check, --20-apply, --23-check, or --23-apply is required");
  }
  const series = parsed[1] as "20" | "23";
  const apply = parsed[2] === "apply";
  const sessionNames = TARGET_SESSION_NAMES[series];
  const expectedGames = series === "20" ? RECOVERY_GAMES : RECOVERY_GAMES_23;
  const api = new ArenzyraApiClient();
  const rest = new REST({ version: "10" }).setToken(botConfig.discordToken);
  const guilds = await rest.get(Routes.userGuilds()) as Array<{ id: string; name: string }>;
  const guild = selectRecoveryGuild(guilds);
  const resolvedGuild = await api.resolveDiscordGuild(guild.id);

  await api.withOrganization(resolvedGuild.organizationId, async () => {
    const sessions = await api.listSessions();
    const session = selectRecoverySession(sessions, sessionNames, series);
    if (session.status === "LIVE") throw new Error("target session is still LIVE");

    const matches = await api.listSessionMatches(session.id);
    if (matches.length === 0) {
      const registrations = await api.listRegistrations(session.id, { includeDeleted: true });
      const requiredKeys = Array.from(new Set(
        Object.values(expectedGames).flat().map((entry) => entry.team),
      ));
      const mapped = mapRecoveryRegistrations(registrations, requiredKeys);
      console.log(
        `RESULT_RECOVERY_REBUILD_CHECK series=${series}:00 registrations=${registrations.length} teams=${mapped.length} mapping=pass`,
      );
      if (!apply) {
        console.log(`RESULT_RECOVERY_CHECK session=${session.name} games=0 rebuild=required status=pass`);
        return;
      }
      throw new Error("match reconstruction apply is not enabled until the deleted-registration check is reviewed");
    }
    const prepared: Array<{
      game: number;
      match: SessionMatchResponse;
      version: number | null | undefined;
      rows: ReturnType<typeof mapRecoveryRows>;
    }> = [];
    for (const game of [1, 2, 3, 4]) {
      const match = matchForGame(matches, game);
      if (match.status === "LIVE" || match.liveState === "LIVE") {
        throw new Error(`game ${game} is still LIVE`);
      }
      const current = await api.getMatchResults(match.id);
      if (current.locked) {
        throw new Error(`game ${game} results are locked (${current.lockReason ?? current.lockState ?? "unknown reason"})`);
      }
      const rows = mapRecoveryRows(current.results ?? current.data ?? [], expectedGames[game]);
      prepared.push({ game, match, version: current.version, rows });
      console.log(
        `RESULT_RECOVERY_CHECK series=${series}:00 game=${game} match=${match.name ?? `Game ${game}`} teams=${rows.length} mapping=pass`,
      );
    }
    if (!apply) {
      console.log(`RESULT_RECOVERY_CHECK session=${session.name} games=4 status=pass`);
      return;
    }

    for (const item of prepared) {
      const updated = await api.updateManualMatchResults(item.match.id, {
        expectedVersion: item.version,
        results: item.rows.map(({ teamId, placement, kills }) => ({ teamId, placement, kills })),
      });
      if (updated.updatedCount !== item.rows.length) {
        throw new Error(`game ${item.game} updated ${updated.updatedCount ?? 0} rows, expected ${item.rows.length}`);
      }
      console.log(`RESULT_RECOVERY_APPLY series=${series}:00 game=${item.game} rows=${item.rows.length} status=pass`);
    }

    const config = await api.getSessionDiscordConfig(session.id);
    const targetChannelId =
      config.emojis?.finalResultPostChannelId?.trim() ||
      config.emojis?.overallResultPostChannelId?.trim() ||
      config.resultsChannelId?.trim();
    if (!targetChannelId) throw new Error("configured final result channel is missing");

    const lastMatch = prepared[prepared.length - 1].match;
    const sessionService = new DiscordSessionService(api);
    const post = await sessionService.buildFinalResultPost(lastMatch.id, config);
    const files = (post.imageFiles ?? []).map((file) => ({ data: file.buffer, name: file.name }));
    const body = {
      content: (post.publicContent ?? post.content).slice(0, 2000),
      allowed_mentions: { parse: [] as string[] },
      attachments: files.map((file, index) => ({ id: String(index), filename: file.name })),
    };
    const storedChannelId = config.emojis?.finalResultPostChannelId?.trim();
    const storedMessageId = config.emojis?.finalResultPostMessageId?.trim();
    let sent: RESTPostAPIChannelMessageResult | null = null;
    if (storedChannelId === targetChannelId && storedMessageId) {
      sent = await rest
        .patch(Routes.channelMessage(targetChannelId, storedMessageId), { body, files })
        .catch(() => null) as RESTPostAPIChannelMessageResult | null;
    }
    sent ??= await rest.post(Routes.channelMessages(targetChannelId), { body, files }) as RESTPostAPIChannelMessageResult;
    await sessionService.rememberFinalResultPost(session.id, targetChannelId, sent.id);

    const standings = await api.getSessionStandings(session.id);
    if (!standings.teams.length) throw new Error("final standings are empty after apply");
    console.log(
      `RESULT_RECOVERY_COMPLETE session=${session.name} games=4 teams=${standings.teams.length} channel=${targetChannelId} message=${sent.id} status=pass`,
    );
  });
}

if (require.main === module) {
  run().catch((error) => {
    console.error(`FIX ESPORTS RESULT RECOVERY FAILED: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}

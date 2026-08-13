import { createHash } from "node:crypto";
import { REST, Routes } from "discord.js";
import {
  ArenzyraApiClient,
  type SessionDiscordConfigResponse,
  type SessionMatchResponse,
  type SessionResponse,
  type TeamSummary,
} from "../api/api-client";
import { botConfig } from "../config";
import { fetchRemoteRasterImage } from "../security/remote-image";
import { DiscordSessionService } from "../services/session.service";

const TARGET_GUILD_NAME = "Fix Esports";
const HISTORY_LIMIT = 500;
const RESULT_CHANNEL_NUMBER = "16";
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MANAGED_TEAM_LOGO_EMOJI = /^azt_v1_([0-9a-f]{10})_[0-9a-f]{6}$/;

type DiscordAttachment = {
  id?: string | null;
  url?: string | null;
  filename?: string | null;
  content_type?: string | null;
  contentType?: string | null;
  size?: number | null;
};

type DiscordMessage = {
  id: string;
  channel_id?: string;
  content?: string | null;
  author?: { id?: string | null } | null;
  attachments?: DiscordAttachment[];
};

type DiscordChannel = { id: string; name?: string | null };

type DiscordEmoji = {
  id: string;
  name?: string | null;
  animated?: boolean | null;
  available?: boolean | null;
};

export type LogoCandidate = {
  team: TeamSummary;
  channelId: string;
  messageId: string;
  attachment: DiscordAttachment & { url: string };
  source: "command" | "plain-exact" | "managed-guild-emoji";
};

type SessionContext = {
  session: SessionResponse;
  config: SessionDiscordConfigResponse;
};

export function normalizeFixText(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function configuredLogoChannelIds(
  configs: Array<Pick<SessionDiscordConfigResponse, "emojis">>,
) {
  const raw = configs
    .flatMap((config) => [
      config.emojis?.discordLogoChannelIds,
      config.emojis?.logoChannelIds,
    ])
    .filter((value): value is string => Boolean(value?.trim()))
    .join("\n");
  return [...new Set(raw.match(/\d{15,25}/g) ?? [])];
}

function cleanMessageLines(content: string | null | undefined) {
  return (content ?? "")
    .replace(/https?:\/\/\S+/gi, " ")
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function logoMessageLabels(content: string | null | undefined) {
  const lines = cleanMessageLines(content);
  if (!lines.length) return { source: null, labels: [] as string[] };
  const command = /^(?:<@!?\d+>\s*)?%logo\b/i.test(lines[0]);
  const first = command
    ? lines[0].replace(/^(?:<@!?\d+>\s*)?%logo\b/i, "").trim()
    : lines[0];
  const fields = [first, ...lines.slice(1)]
    .flatMap((line) => line.split("|"))
    .map((value) => value.replace(/^"|"$/g, "").trim())
    .filter(Boolean);
  return {
    source: command ? ("command" as const) : ("plain-exact" as const),
    labels: [...new Set(fields.map(normalizeFixText).filter(Boolean))],
  };
}

function allowedImageAttachment(message: DiscordMessage) {
  const candidates = (message.attachments ?? []).filter((attachment) => {
    const contentType = String(
      attachment.content_type ?? attachment.contentType ?? "",
    )
      .split(";", 1)[0]
      .trim()
      .toLowerCase();
    const filename = attachment.filename ?? attachment.url ?? "";
    return (
      Boolean(attachment.url?.trim()) &&
      (ALLOWED_IMAGE_TYPES.has(contentType) ||
        /\.(?:png|jpe?g|webp)(?:\?|$)/i.test(filename))
    );
  });
  return candidates.length === 1
    ? ({ ...candidates[0], url: candidates[0].url!.trim() } as const)
    : null;
}

export function logoCandidateForMessage(
  message: DiscordMessage,
  channelId: string,
  teams: TeamSummary[],
): LogoCandidate | null {
  const attachment = allowedImageAttachment(message);
  const parsed = logoMessageLabels(message.content);
  if (!attachment || !parsed.source || !parsed.labels.length) return null;

  const matchedTeams = teams.filter((team) => {
    const identities = new Set(
      [normalizeFixText(team.name), normalizeFixText(team.tag)].filter(Boolean),
    );
    return parsed.labels.some((label) => identities.has(label));
  });
  const unique = new Map(matchedTeams.map((team) => [team.id, team]));
  if (unique.size !== 1) return null;
  const team = [...unique.values()][0];

  if (parsed.source === "plain-exact") {
    const identities = new Set(
      [normalizeFixText(team.name), normalizeFixText(team.tag)].filter(Boolean),
    );
    if (!parsed.labels.every((label) => identities.has(label))) return null;
  }

  return {
    team,
    channelId,
    messageId: message.id,
    attachment,
    source: parsed.source,
  };
}

export function newestLogoCandidates(candidates: LogoCandidate[]) {
  const newest = new Map<string, LogoCandidate>();
  for (const candidate of candidates) {
    const current = newest.get(candidate.team.id);
    if (!current || compareSnowflakes(candidate.messageId, current.messageId) > 0) {
      newest.set(candidate.team.id, candidate);
    }
  }
  return [...newest.values()];
}

function teamIdHash(teamId: string) {
  return createHash("sha1").update(teamId).digest("hex").slice(0, 10);
}

export function managedGuildEmojiCandidates(
  emojis: DiscordEmoji[],
  guildId: string,
  teams: TeamSummary[],
) {
  const teamsByHash = new Map<string, TeamSummary[]>();
  for (const team of teams) {
    const hash = teamIdHash(team.id);
    teamsByHash.set(hash, [...(teamsByHash.get(hash) ?? []), team]);
  }

  return emojis.flatMap((emoji): LogoCandidate[] => {
    const match = MANAGED_TEAM_LOGO_EMOJI.exec(emoji.name ?? "");
    if (
      !match ||
      emoji.available === false ||
      emoji.animated ||
      !/^\d{15,25}$/.test(emoji.id)
    ) {
      return [];
    }
    const matchedTeams = teamsByHash.get(match[1]) ?? [];
    if (matchedTeams.length !== 1) return [];
    return [
      {
        team: matchedTeams[0],
        channelId: guildId,
        messageId: emoji.id,
        attachment: {
          id: emoji.id,
          url: `https://cdn.discordapp.com/emojis/${emoji.id}.png?size=256&quality=lossless`,
          filename: `${emoji.name}.png`,
          content_type: "image/png",
        },
        source: "managed-guild-emoji",
      },
    ];
  });
}

function compareSnowflakes(left: string, right: string) {
  try {
    const leftId = BigInt(left);
    const rightId = BigInt(right);
    return leftId === rightId ? 0 : leftId > rightId ? 1 : -1;
  } catch {
    return left.localeCompare(right);
  }
}

export function selectResultRefreshTarget(
  contexts: SessionContext[],
  channelNames: ReadonlyMap<string, string>,
) {
  const candidates = contexts
    .filter(({ session, config }) => {
      const channelId = config.emojis?.finalResultPostChannelId?.trim();
      const messageId = config.emojis?.finalResultPostMessageId?.trim();
      const channelName = normalizeFixText(
        channelNames.get(channelId ?? "") ?? config.resultsChannelName,
      );
      const tokens = new Set(channelName.split(" ").filter(Boolean));
      return (
        session.status !== "LIVE" &&
        Boolean(channelId && messageId) &&
        tokens.has(RESULT_CHANNEL_NUMBER) &&
        [...tokens].some((token) => token.startsWith("result"))
      );
    })
    .sort((left, right) => {
      const rightTime = Date.parse(right.session.startsAt ?? "") || 0;
      const leftTime = Date.parse(left.session.startsAt ?? "") || 0;
      return rightTime - leftTime;
    });
  if (!candidates.length) return null;
  const firstTime = Date.parse(candidates[0].session.startsAt ?? "") || 0;
  const tied = candidates.filter(
    (candidate) =>
      (Date.parse(candidate.session.startsAt ?? "") || 0) === firstTime,
  );
  if (tied.length !== 1) {
    throw new Error("Fix Esports channel 16 result target is ambiguous");
  }
  return candidates[0];
}

function latestMatch(matches: SessionMatchResponse[]) {
  return matches
    .filter((match) => match.id?.trim())
    .slice()
    .sort((left, right) => {
      const numberOrder = (right.matchNumber ?? -1) - (left.matchNumber ?? -1);
      if (numberOrder !== 0) return numberOrder;
      const rightTime =
        Date.parse(right.endedAt ?? right.updatedAt ?? right.createdAt ?? "") || 0;
      const leftTime =
        Date.parse(left.endedAt ?? left.updatedAt ?? left.createdAt ?? "") || 0;
      return rightTime - leftTime;
    })[0];
}

async function fetchChannelMessages(
  rest: REST,
  channelId: string,
  limit = HISTORY_LIMIT,
) {
  const messages: DiscordMessage[] = [];
  let before: string | undefined;
  while (messages.length < limit) {
    const batchLimit = Math.min(100, limit - messages.length);
    const query = new URLSearchParams({ limit: String(batchLimit) });
    if (before) query.set("before", before);
    const batch = (await rest.get(Routes.channelMessages(channelId), {
      query,
    })) as DiscordMessage[];
    if (!batch.length) break;
    messages.push(...batch);
    before = batch[batch.length - 1]?.id;
    if (!before || batch.length < batchLimit) break;
  }
  return messages;
}

async function mapWithConcurrency<T, R>(
  values: T[],
  limit: number,
  work: (value: T) => Promise<R>,
) {
  const results = new Array<R>(values.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, async () => {
      while (cursor < values.length) {
        const index = cursor++;
        results[index] = await work(values[index]);
      }
    }),
  );
  return results;
}

async function logoIsUsable(logoUrl: string | null | undefined) {
  const value = logoUrl?.trim();
  if (!value || /default|placeholder/i.test(value)) return false;
  return fetchRemoteRasterImage(value, {
    maxBytes: 8 * 1024 * 1024,
    maxOutputBytes: 8 * 1024 * 1024,
    timeoutMs: 10_000,
  })
    .then(() => true)
    .catch(() => false);
}

async function loadContexts(
  api: ArenzyraApiClient,
  guildId: string,
): Promise<SessionContext[]> {
  const sessions = (await api.listSessions()).filter(
    (session) => session.type === "SCRIM" && session.status !== "ARCHIVED",
  );
  const contexts: SessionContext[] = [];
  for (const session of sessions) {
    const config = await api.getSessionDiscordConfig(session.id).catch(() => null);
    if (config?.enabled !== false && config?.guildId === guildId) {
      contexts.push({ session, config });
    }
  }
  return contexts;
}

async function assertStoredResultPostTarget(
  rest: REST,
  api: ArenzyraApiClient,
  context: SessionContext,
) {
  const channelId = context.config.emojis.finalResultPostChannelId?.trim();
  const messageId = context.config.emojis.finalResultPostMessageId?.trim();
  if (!channelId || !messageId) throw new Error("stored final result post is missing");
  const existing = (await rest.get(
    Routes.channelMessage(channelId, messageId),
  )) as DiscordMessage;
  if (existing.author?.id !== botConfig.discordClientId) {
    throw new Error("stored final result post is not owned by the configured bot");
  }
  if (!(existing.attachments ?? []).length) {
    throw new Error("stored final result post has no recoverable attachments");
  }

  const service = new DiscordSessionService(api);
  const matches = await service.listSessionMatchesForDiscord(context.session.id);
  if (
    !matches.length ||
    matches.some(
      (match) => match.status === "LIVE" || match.liveState === "LIVE",
    )
  ) {
    throw new Error("result refresh requires completed, non-live matches");
  }
  const match = latestMatch(matches);
  if (!match) throw new Error("result refresh has no match source");
  return { channelId, messageId, existing, service, match };
}

async function refreshStoredResultPost(
  rest: REST,
  api: ArenzyraApiClient,
  context: SessionContext,
) {
  const { channelId, messageId, existing, service, match } =
    await assertStoredResultPostTarget(rest, api, context);
  const rendered = await service.buildFinalResultPost(match.id, {
    ...context.config,
    sessionId: context.session.id,
  });
  const files = (rendered.imageFiles ?? []).map((file) => ({
    data: file.buffer,
    name: file.name,
  }));
  if (!files.length) throw new Error("result refresh rendered no image files");

  const oldFiles = await Promise.all(
    (existing.attachments ?? []).map(async (attachment, index) => {
      if (!attachment.url) throw new Error("existing result attachment URL is missing");
      const image = await fetchRemoteRasterImage(attachment.url, {
        maxBytes: 16 * 1024 * 1024,
        maxOutputBytes: 16 * 1024 * 1024,
        timeoutMs: 10_000,
      });
      return {
        data: image.buffer,
        name: attachment.filename?.trim() || `old-result-${index + 1}.png`,
      };
    }),
  );
  const originalContent = existing.content ?? "";
  const body = {
    content: originalContent,
    allowed_mentions: { parse: [] as string[] },
    attachments: files.map((file, index) => ({
      id: String(index),
      filename: file.name,
    })),
  };
  try {
    await rest.patch(Routes.channelMessage(channelId, messageId), {
      body,
      files,
    });
    const verified = (await rest.get(
      Routes.channelMessage(channelId, messageId),
    )) as DiscordMessage;
    const actualNames = (verified.attachments ?? []).map((file) => file.filename);
    if (
      verified.content !== originalContent ||
      actualNames.length !== files.length ||
      files.some((file) => !actualNames.includes(file.name))
    ) {
      throw new Error("refreshed result post verification failed");
    }
  } catch (error) {
    if (oldFiles.length) {
      await rest
        .patch(Routes.channelMessage(channelId, messageId), {
          body: {
            content: originalContent,
            allowed_mentions: { parse: [] as string[] },
            attachments: oldFiles.map((file, index) => ({
              id: String(index),
              filename: file.name,
            })),
          },
          files: oldFiles,
        })
        .catch(() => undefined);
    }
    throw error;
  }
  return { channelId, messageId, files: files.length };
}

async function run() {
  const mode = process.argv[2];
  if (process.argv.length !== 3 || !["--check", "--apply"].includes(mode ?? "")) {
    throw new Error("exactly --check or --apply is required");
  }
  const apply = mode === "--apply";
  const api = new ArenzyraApiClient();
  const rest = new REST({ version: "10" }).setToken(botConfig.discordToken);
  const guilds = (await rest.get(Routes.userGuilds())) as Array<{
    id: string;
    name: string;
  }>;
  const targetGuilds = guilds.filter(
    (guild) => normalizeFixText(guild.name) === normalizeFixText(TARGET_GUILD_NAME),
  );
  if (targetGuilds.length !== 1) {
    throw new Error(`Fix Esports guild count is ${targetGuilds.length}, expected 1`);
  }
  const guild = targetGuilds[0];
  const resolved = await api.resolveDiscordGuild(guild.id);

  await api.withOrganization(resolved.organizationId, async () => {
    const contexts = await loadContexts(api, guild.id);
    if (!contexts.length) throw new Error("no active Fix Esports SCRIM session found");
    const logoChannelIds = configuredLogoChannelIds(
      contexts.map((context) => context.config),
    );
    if (!logoChannelIds.length) throw new Error("no configured Fix Esports logo channel found");

    const registrations = (
      await Promise.all(
        contexts.map((context) => api.listRegistrations(context.session.id)),
      )
    ).flat();
    const scopedTeamIds = new Set(
      registrations
        .filter((registration) => registration.team && !registration.removedAt)
        .map((registration) => registration.teamId),
    );
    for (const context of contexts) {
      const matches = await api.listSessionMatches(context.session.id);
      for (const match of matches) {
        const result = await api.getMatchResults(match.id, resolved.organizationId);
        for (const row of result.results ?? result.data ?? []) {
          if (row.teamId) scopedTeamIds.add(row.teamId);
        }
      }
    }
    const teams = (await api.searchTeams("")).filter((team) =>
      scopedTeamIds.has(team.id),
    );
    if (!teams.length) throw new Error("no registered Fix Esports teams found");

    const channelNames = new Map<string, string>();
    const resultChannelIds = contexts
      .flatMap(({ config }) => [
        config.emojis?.finalResultPostChannelId,
        config.emojis?.overallResultPostChannelId,
        config.resultsChannelId,
      ])
      .filter((value): value is string => Boolean(value?.trim()));
    for (const channelId of logoChannelIds) {
      const channel = (await rest.get(Routes.channel(channelId))) as DiscordChannel;
      channelNames.set(channelId, channel.name?.trim() || "unnamed");
    }
    for (const channelId of new Set(resultChannelIds)) {
      if (channelNames.has(channelId)) continue;
      const channel = (await rest
        .get(Routes.channel(channelId))
        .catch(() => null)) as DiscordChannel | null;
      if (channel) channelNames.set(channelId, channel.name?.trim() || "unnamed");
    }
    const guildEmojis = (await rest.get(
      Routes.guildEmojis(guild.id),
    )) as DiscordEmoji[];
    channelNames.set(guild.id, "managed-server-emoji");

    const messagesByChannel = await Promise.all(
      logoChannelIds.map(async (channelId) => ({
        channelId,
        messages: await fetchChannelMessages(rest, channelId),
      })),
    );
    const candidates = newestLogoCandidates([
      ...messagesByChannel.flatMap(({ channelId, messages }) =>
        messages.flatMap((message) => {
          const candidate = logoCandidateForMessage(message, channelId, teams);
          return candidate ? [candidate] : [];
        }),
      ),
      ...managedGuildEmojiCandidates(guildEmojis, guild.id, teams),
    ]);
    const states = await mapWithConcurrency(teams, 6, async (team) => ({
      team,
      usable: await logoIsUsable(team.logoUrl),
    }));
    const stateByTeamId = new Map(states.map((state) => [state.team.id, state]));
    const repairs = candidates.filter(
      (candidate) => !stateByTeamId.get(candidate.team.id)?.usable,
    );
    const refreshTarget = selectResultRefreshTarget(contexts, channelNames);
    const missingWithoutCandidate = states.filter(
      (state) =>
        !state.usable && !candidates.some((candidate) => candidate.team.id === state.team.id),
    );

    console.log(
      `FIX_ESPORTS_LOGO_CHECK sessions=${contexts.length} channels=${logoChannelIds.length} scanned=${messagesByChannel.reduce((sum, entry) => sum + entry.messages.length, 0)} teams=${teams.length} candidates=${candidates.length} repairs=${repairs.length} unresolved=${missingWithoutCandidate.length} refresh=${refreshTarget?.session.name ?? "none"} status=pass`,
    );
    for (const repair of repairs) {
      console.log(
        `FIX_ESPORTS_LOGO_REPAIR_READY team=${JSON.stringify(repair.team.tag?.trim() || repair.team.name)} source=${repair.source} channel=${JSON.stringify(channelNames.get(repair.channelId) ?? "unnamed")}`,
      );
    }
    if (!apply) return;
    if (refreshTarget) {
      await assertStoredResultPostTarget(rest, api, refreshTarget);
    }
    if (!repairs.length) {
      console.log("FIX_ESPORTS_LOGO_APPLY teams=0 status=noop");
    } else {
      const prepared = await mapWithConcurrency(repairs, 4, async (repair) => ({
        repair,
        image: await fetchRemoteRasterImage(repair.attachment.url, {
          maxBytes: 8 * 1024 * 1024,
          maxOutputBytes: 8 * 1024 * 1024,
          timeoutMs: 10_000,
        }),
      }));
      for (const { repair, image } of prepared) {
        const uploaded = await api.uploadTeamLogo(repair.team.id, {
          buffer: image.buffer,
          filename: "team-logo.png",
          contentType: image.contentType,
        });
        if (!uploaded.logoUrl || !(await logoIsUsable(uploaded.logoUrl))) {
          throw new Error(`logo postcondition failed for ${repair.team.name}`);
        }
        console.log(
          `FIX_ESPORTS_LOGO_APPLY team=${JSON.stringify(repair.team.tag?.trim() || repair.team.name)} status=pass`,
        );
      }
    }

    const refreshedTeams = await api.searchTeams("");
    for (const repair of repairs) {
      const team = refreshedTeams.find((candidate) => candidate.id === repair.team.id);
      if (!team || !(await logoIsUsable(team.logoUrl))) {
        throw new Error(`final logo verification failed for ${repair.team.name}`);
      }
    }
    if (refreshTarget) {
      const refreshed = await refreshStoredResultPost(rest, api, refreshTarget);
      console.log(
        `FIX_ESPORTS_RESULT_REFRESH session=${JSON.stringify(refreshTarget.session.name)} channel=${JSON.stringify(channelNames.get(refreshed.channelId) ?? "unnamed")} files=${refreshed.files} content=preserved status=pass`,
      );
    } else {
      console.log("FIX_ESPORTS_RESULT_REFRESH target=none status=skipped");
    }
  });
}

if (require.main === module) {
  run().catch((error) => {
    console.error(
      `FIX ESPORTS LOGO REPAIR FAILED: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}

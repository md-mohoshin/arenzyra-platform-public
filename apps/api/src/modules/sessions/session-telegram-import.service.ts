import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import * as path from 'node:path';
import {
  GameKey,
  LiveState,
  MatchStatus,
  Prisma,
  SessionRegistrationStatus,
  SessionStatus,
  SessionType,
} from '@prisma/client';
import type { Actor } from '../../common/auth/jwt.strategy';
import { defaultSlotCountForGame } from '../../common/game-rules.util';
import { effectiveOrganizationId } from '../../common/org/org.util';
import { PrismaService } from '../../db/prisma.service';
import { storeTeamLogo } from '../teams/asset.util';
import { ImportTelegramEventDto } from './dto/import-telegram-event.dto';
import {
  type DiscordEventSlotParseOptions,
  type DiscordEventSlotRow,
  parseDiscordEventSlotRows,
} from './session-discord-sync.service';
import {
  syncMatchSlotsWithSessionRegistrations,
  type SyncSessionMatchSlotsResult,
} from './session-match-slot-sync';

const TELEGRAM_API_BASE_URL = 'https://api.telegram.org';
const TELEGRAM_EVENT_IMPORT_NOTE_PREFIX = 'TELEGRAM_EVENT_IMPORT:';
const TELEGRAM_MESSAGE_CACHE_LIMIT = 100;
const TELEGRAM_LOGO_CACHE_LIMIT = 200;
const TELEGRAM_POLL_TIMEOUT_SECONDS = 20;
const TELEGRAM_MAX_LOGO_BYTES = 5 * 1024 * 1024;

const TELEGRAM_IMAGE_MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

type TelegramApiResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
};

type TelegramChat = {
  id: number | string;
  type?: string;
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
};

type TelegramMessage = {
  message_id: number;
  date?: number;
  edit_date?: number;
  text?: string;
  caption?: string;
  chat: TelegramChat;
  photo?: Array<{
    file_id: string;
    file_unique_id?: string;
    width?: number;
    height?: number;
    file_size?: number;
  }>;
  document?: {
    file_id: string;
    file_unique_id?: string;
    file_name?: string;
    mime_type?: string;
    file_size?: number;
  };
};

type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
  edited_channel_post?: TelegramMessage;
};

type CachedTelegramMessage = {
  id: string;
  chatId: string;
  chatTitle: string;
  chatType: string | null;
  messageId: string;
  text: string;
  preview: string;
  date: string | null;
  updatedAt: string;
};

type CachedTelegramLogo = {
  id: string;
  chatId: string;
  chatTitle: string;
  messageId: string;
  fileId: string;
  fileUniqueId: string | null;
  fileName: string | null;
  mimeType: string | null;
  caption: string | null;
  date: string | null;
  updatedAt: string;
};

type CachedTelegramChat = {
  id: string;
  title: string;
  type: string | null;
  username: string | null;
  lastMessageAt: string | null;
  messages: CachedTelegramMessage[];
  logos: CachedTelegramLogo[];
};

type TelegramLogoTarget = {
  teamId: string;
  teamName: string;
  teamTag: string | null;
};

type TelegramLinkedEvent = {
  id: string;
  organizationId: string;
  name: string;
  createdById: string | null;
  updatedById: string | null;
  game: { id: string; key: GameKey; name: string } | null;
};

function telegramChatId(chat: TelegramChat | string | number) {
  return typeof chat === 'object' ? String(chat.id) : String(chat);
}

function telegramChatTitle(chat: TelegramChat) {
  const displayName = [chat.first_name, chat.last_name]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' ');
  return chat.title?.trim() || displayName || chat.username || String(chat.id);
}

function telegramMessageText(message: TelegramMessage) {
  return message.text?.trim() || message.caption?.trim() || '';
}

function telegramMessageImage(message: TelegramMessage) {
  const documentMime = message.document?.mime_type?.trim() ?? '';
  if (message.document?.file_id && documentMime.startsWith('image/')) {
    return {
      fileId: message.document.file_id,
      fileUniqueId: message.document.file_unique_id ?? null,
      fileName: message.document.file_name?.trim() || null,
      mimeType: documentMime,
      fileSize: message.document.file_size ?? null,
    };
  }

  const photo = message.photo?.slice().sort((left, right) => {
    const leftPixels = (left.width ?? 0) * (left.height ?? 0);
    const rightPixels = (right.width ?? 0) * (right.height ?? 0);
    if (leftPixels !== rightPixels) return rightPixels - leftPixels;
    return (right.file_size ?? 0) - (left.file_size ?? 0);
  })[0];
  if (!photo?.file_id) return null;
  return {
    fileId: photo.file_id,
    fileUniqueId: photo.file_unique_id ?? null,
    fileName: null,
    mimeType: 'image/jpeg',
    fileSize: photo.file_size ?? null,
  };
}

function compactPreview(value: string, maxLength = 140) {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > maxLength
    ? `${compact.slice(0, maxLength - 3).trimEnd()}...`
    : compact;
}

function isTelegramSlotListMessageText(value: string | null | undefined) {
  const normalized = stripTelegramMarkdown(value ?? '').toLowerCase();
  return /(?:^|[^a-z0-9])slots?[\s_-]*list(?:[^a-z0-9]|$)/i.test(normalized);
}

function normalizeTelegramLogoMatchText(value: string | null | undefined) {
  return stripTelegramMarkdown(value ?? '')
    .replace(/\.[a-z0-9]{2,5}$/i, ' ')
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase();
}

function compactLogoMatchText(value: string) {
  return value.replace(/\s+/g, '');
}

function telegramLogoTextMatchesTeam(
  source: string | null | undefined,
  teamName: string,
  teamTag: string | null | undefined,
) {
  const candidate = normalizeTelegramLogoMatchText(source);
  if (!candidate) return false;

  const name = normalizeTelegramLogoMatchText(teamName);
  const tag = normalizeTelegramLogoMatchText(teamTag);
  const compactCandidate = compactLogoMatchText(candidate);
  const compactName = compactLogoMatchText(name);

  if (name && (candidate === name || candidate.includes(name))) return true;
  if (
    compactName.length >= 4 &&
    (compactCandidate === compactName || compactCandidate.includes(compactName))
  ) {
    return true;
  }
  return Boolean(
    tag.length >= 3 &&
    (candidate === tag || candidate.split(/\s+/).includes(tag)),
  );
}

function normalizeTelegramEventName(value: string | null | undefined) {
  return stripTelegramMarkdown(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function parseTelegramEventImportNote(note: string | null | undefined) {
  if (!note?.startsWith(TELEGRAM_EVENT_IMPORT_NOTE_PREFIX)) return null;
  const params = new URLSearchParams(
    note.slice(TELEGRAM_EVENT_IMPORT_NOTE_PREFIX.length).replace(/;/g, '&'),
  );
  const chatId = params.get('chat')?.trim() || null;
  const messageId = params.get('message')?.trim() || null;
  if (!chatId || !messageId) return null;
  return { chatId, messageId };
}

function stripTelegramMarkdown(value: string) {
  return value
    .replace(/[*_`~>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanTelegramSlotLine(value: string) {
  return stripTelegramMarkdown(value)
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/t\.me\/\S+/gi, ' ')
    .replace(/@\w{2,32}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripLeadingTelegramDecorations(value: string) {
  return value
    .replace(/^\s*[-\u2022]\s+/, '')
    .replace(/^[^\p{L}\p{N}#[\]]+/u, '')
    .trim();
}

function isEmptyTelegramSlotLabel(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (!normalized) return true;
  return [
    'empty',
    'open',
    'available',
    'free',
    'vacant',
    'tbd',
    'to be decided',
    'none',
    'no team',
    'team name',
  ].some((label) => normalized === label || normalized.startsWith(`${label} `));
}

function isTelegramSlotHeaderLine(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (!normalized) return true;
  return (
    normalized === 'team' ||
    normalized === 'teams' ||
    normalized === 'team list' ||
    normalized === 'slot' ||
    normalized === 'slots' ||
    normalized === 'slot list' ||
    normalized === 'registered teams' ||
    normalized === 'confirmed teams' ||
    normalized.includes('registration') ||
    normalized.includes('room id') ||
    normalized.includes('password') ||
    normalized.includes('schedule') ||
    normalized.includes('thanks to everyone')
  );
}

function deriveTelegramTeamTag(teamName: string, explicitTag: string | null) {
  if (explicitTag?.trim()) {
    return explicitTag.trim().slice(0, 15).toUpperCase();
  }
  const letters = teamName
    .split(/\s+/)
    .map((part) => part.replace(/[^a-z0-9]/gi, '').charAt(0))
    .join('')
    .slice(0, 5)
    .toUpperCase();
  const fallback = teamName
    .replace(/[^a-z0-9]/gi, '')
    .slice(0, 5)
    .toUpperCase();
  return letters || fallback || 'TEAM';
}

function parseTelegramTeamLabel(value: string) {
  let label = stripLeadingTelegramDecorations(cleanTelegramSlotLine(value))
    .replace(/\b(confirm|confirmed|not playing|playing)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (
    !label ||
    isTelegramSlotHeaderLine(label) ||
    isEmptyTelegramSlotLabel(label)
  ) {
    return null;
  }

  let tag: string | null = null;
  const bracket = /^\[([^\]]{1,15})\]\s*(.+)$/.exec(label);
  if (bracket) {
    tag = bracket[1].trim();
    label = bracket[2].trim();
  }

  const pipe = /^([A-Z0-9_.-]{2,15})\s*[|/]\s*(.+)$/i.exec(label);
  if (!tag && pipe) {
    tag = pipe[1].trim();
    label = pipe[2].trim();
  }

  label = label.replace(/\s+/g, ' ').slice(0, 120).trim();
  if (!label || isEmptyTelegramSlotLabel(label)) return null;

  return {
    teamName: label,
    teamTag: deriveTelegramTeamTag(label, tag),
  };
}

function parseTelegramPlainSlotRows(
  text: string,
  options: DiscordEventSlotParseOptions,
) {
  const optionStartSlot =
    typeof options.startSlot === 'number' &&
    Number.isInteger(options.startSlot) &&
    options.startSlot >= 1 &&
    options.startSlot <= 100
      ? options.startSlot
      : 3;
  const optionNormalSlots =
    typeof options.normalSlots === 'number' &&
    Number.isInteger(options.normalSlots) &&
    options.normalSlots >= 0 &&
    options.normalSlots <= 100
      ? options.normalSlots
      : null;
  const bySlot = new Map<number, DiscordEventSlotRow>();
  const unnumberedRows: Array<Omit<DiscordEventSlotRow, 'slotNumber'>> = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = cleanTelegramSlotLine(rawLine);
    if (!line || isTelegramSlotHeaderLine(line)) continue;

    const stripped = stripLeadingTelegramDecorations(line);
    const numericMatch =
      /^(?:slot\s*)?#?(\d{1,3})\s*(?:[.)\]:-]|\s+-\s+|\s+)\s*(.+)$/i.exec(
        stripped,
      );
    if (numericMatch) {
      const slotNumber = Number.parseInt(numericMatch[1], 10);
      const team = parseTelegramTeamLabel(numericMatch[2]);
      if (
        Number.isInteger(slotNumber) &&
        slotNumber >= 1 &&
        slotNumber <= 100 &&
        team &&
        !bySlot.has(slotNumber)
      ) {
        bySlot.set(slotNumber, {
          slotNumber,
          teamName: team.teamName,
          teamTag: team.teamTag,
        });
      }
      continue;
    }

    const team = parseTelegramTeamLabel(stripped);
    if (team) {
      unnumberedRows.push({
        teamName: team.teamName,
        teamTag: team.teamTag,
      });
    }
  }

  if (unnumberedRows.length > 0) {
    const existingSlots = Array.from(bySlot.keys());
    let nextSlot =
      existingSlots.length > 0
        ? Math.max(...existingSlots) + 1
        : optionStartSlot;
    const endSlot =
      optionNormalSlots === null
        ? 100
        : Math.min(100, optionStartSlot + optionNormalSlots - 1);

    for (const row of unnumberedRows) {
      while (bySlot.has(nextSlot)) nextSlot += 1;
      if (nextSlot > endSlot || nextSlot > 100) break;
      bySlot.set(nextSlot, {
        slotNumber: nextSlot,
        teamName: row.teamName,
        teamTag: row.teamTag,
      });
      nextSlot += 1;
    }
  }

  return Array.from(bySlot.values()).sort(
    (left, right) => left.slotNumber - right.slotNumber,
  );
}

function parseTelegramEventSlotRows(
  text: string,
  options: DiscordEventSlotParseOptions,
) {
  const rows = parseDiscordEventSlotRows(
    [{ id: 'telegram-message', content: text, embeds: [] }],
    options,
  );
  return rows.length > 0 ? rows : parseTelegramPlainSlotRows(text, options);
}

@Injectable()
export class SessionTelegramImportService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(SessionTelegramImportService.name);
  private readonly token = process.env.TELEGRAM_BOT_TOKEN?.trim() || null;
  private readonly pollingEnabled =
    process.env.TELEGRAM_IMPORT_POLLING?.trim().toLowerCase() === 'true';
  private readonly chats = new Map<string, CachedTelegramChat>();
  private offset: number | null = null;
  private stopped = false;
  private pollTimer: NodeJS.Timeout | null = null;
  private botUsername: string | null = null;
  private lastError: string | null = null;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    if (!this.token || !this.pollingEnabled) return;
    void this.initializePolling();
  }

  onModuleDestroy() {
    this.stopped = true;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  getImportSources(chatId?: string | null) {
    const selectedChatId = chatId?.trim() || null;
    const chats = Array.from(this.chats.values())
      .map((chat) => ({
        id: chat.id,
        title: chat.title,
        type: chat.type,
        username: chat.username,
        lastMessageAt: chat.lastMessageAt,
        messageCount: chat.messages.length,
        logoCount: chat.logos?.length ?? 0,
      }))
      .sort((left, right) =>
        String(right.lastMessageAt ?? '').localeCompare(
          String(left.lastMessageAt ?? ''),
        ),
      );
    const selectedChat =
      (selectedChatId ? this.chats.get(selectedChatId) : null) ??
      (chats[0] ? this.chats.get(chats[0].id) : null);

    return {
      configured: Boolean(this.token),
      polling: this.pollingEnabled,
      botUsername: this.botUsername,
      lastError: this.lastError,
      chats,
      messages:
        selectedChat?.messages
          .filter((message) => isTelegramSlotListMessageText(message.text))
          .slice()
          .sort((left, right) =>
            String(right.date ?? right.updatedAt).localeCompare(
              String(left.date ?? left.updatedAt),
            ),
          ) ?? [],
    };
  }

  async importEvent(dto: ImportTelegramEventDto, actor: Actor) {
    const organizationId = this.requireOrg(actor);
    const ownerUserId = this.actorId(actor);
    if (!ownerUserId) {
      throw new ForbiddenException('Actor id is required to import an event');
    }
    if (!this.token) {
      throw new BadRequestException('Telegram bot token is not configured');
    }

    const chatId = dto.chatId.trim();
    const messageId = dto.messageId.trim();
    const cachedMessage = this.chats
      .get(chatId)
      ?.messages.find((message) => message.messageId === messageId);
    if (!cachedMessage) {
      throw new BadRequestException(
        'Telegram message is not in the local cache. Add the bot to the chat, then repost or edit the slot-list message.',
      );
    }

    const requestedGame = await this.resolveGameIdentity(dto.gameKey ?? null);
    const effectiveGame =
      requestedGame ?? ({ id: null, key: GameKey.PUBG_MOBILE } as const);
    const defaultSlotCount = defaultSlotCountForGame(effectiveGame.key);
    const startSlot = 3;
    const parseOptions = {
      startSlot,
      normalSlots: Math.max(0, defaultSlotCount - startSlot + 1),
    } satisfies DiscordEventSlotParseOptions;
    const slotRows =
      dto.importTeams === false
        ? []
        : parseTelegramEventSlotRows(cachedMessage.text, parseOptions);
    const slotCount = Math.min(
      100,
      Math.max(
        defaultSlotCount,
        slotRows.reduce((max, row) => Math.max(max, row.slotNumber), 0),
      ),
    );
    const eventName =
      dto.eventName?.trim() ||
      this.deriveEventNameFromMessage(cachedMessage) ||
      cachedMessage.chatTitle ||
      'Telegram Event';

    const importResult = await this.prisma.$transaction(async (tx) => {
      const session = await tx.session.create({
        data: {
          organizationId,
          name: eventName.slice(0, 120),
          type: SessionType.EVENT,
          status: SessionStatus.OPEN,
          slotCount,
          maxTeams: slotCount,
          gameId: effectiveGame.id,
          waitlistEnabled: true,
          createdById: ownerUserId,
          updatedById: ownerUserId,
        },
        select: {
          id: true,
          name: true,
          status: true,
          slotCount: true,
          gameId: true,
          game: { select: { id: true, key: true, name: true } },
          createdAt: true,
        },
      });

      const applied =
        dto.importTeams === false
          ? { importedTeams: 0, logoTargets: [], skipped: [] }
          : await this.applyTelegramEventSlotRows({
              tx,
              organizationId,
              sessionId: session.id,
              chatId,
              messageId,
              ownerUserId,
              rows: slotRows,
            });

      return {
        ...session,
        importedTeams: applied.importedTeams,
        logoTargets: applied.logoTargets,
        telegram: {
          chatId,
          chatTitle: cachedMessage.chatTitle,
          messageId,
          parsedSlotRows: slotRows.length,
        },
        skipped: applied.skipped,
      };
    });

    const { logoTargets, ...result } = importResult;
    const logos = await this.applyTelegramLogosToTeams({
      organizationId,
      chatId,
      targets: logoTargets,
    });

    return {
      ...result,
      logos,
    };
  }

  async refreshEvent(sessionId: string, actor: Actor) {
    const organizationId = this.requireOrg(actor);
    const ownerUserId = this.actorId(actor);
    if (!ownerUserId) {
      throw new ForbiddenException('Actor id is required to refresh an event');
    }
    if (!this.token) {
      throw new BadRequestException('Telegram bot token is not configured');
    }

    const session = await this.prisma.session.findFirst({
      where: {
        id: sessionId,
        organizationId,
        type: SessionType.EVENT,
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        status: true,
        slotCount: true,
        gameId: true,
        game: { select: { id: true, key: true, name: true } },
        createdAt: true,
      },
    });
    if (!session) {
      throw new NotFoundException('Event not found');
    }

    const importedRegistrations =
      await this.prisma.sessionRegistration.findMany({
        where: {
          organizationId,
          sessionId: session.id,
          deletedAt: null,
          note: { startsWith: TELEGRAM_EVENT_IMPORT_NOTE_PREFIX },
        },
        select: { note: true },
        orderBy: { updatedAt: 'desc' },
      });
    const source = importedRegistrations
      .map((registration) => parseTelegramEventImportNote(registration.note))
      .find(
        (parsed): parsed is { chatId: string; messageId: string } =>
          parsed !== null,
      );
    if (!source) {
      throw new BadRequestException(
        'This event is not linked to a Telegram import source',
      );
    }

    const cachedMessage = this.findRefreshSourceMessage(
      source.chatId,
      source.messageId,
    );
    if (!cachedMessage) {
      throw new BadRequestException(
        'No Telegram slot-list message is cached for this chat. Send or edit a message containing SLOT LIST, then refresh again.',
      );
    }

    const effectiveGame =
      session.game ?? ({ id: null, key: GameKey.PUBG_MOBILE } as const);
    const defaultSlotCount = defaultSlotCountForGame(effectiveGame.key);
    const startSlot = 3;
    const parseOptions = {
      startSlot,
      normalSlots: Math.max(0, defaultSlotCount - startSlot + 1),
    } satisfies DiscordEventSlotParseOptions;
    const slotRows = parseTelegramEventSlotRows(
      cachedMessage.text,
      parseOptions,
    );
    const slotCount = Math.min(
      100,
      Math.max(
        defaultSlotCount,
        slotRows.reduce((max, row) => Math.max(max, row.slotNumber), 0),
      ),
    );

    const refreshResult = await this.prisma.$transaction(async (tx) => {
      const updatedSession = await tx.session.update({
        where: { id: session.id },
        data: {
          slotCount,
          maxTeams: slotCount,
          updatedById: ownerUserId,
        },
        select: {
          id: true,
          name: true,
          status: true,
          slotCount: true,
          gameId: true,
          game: { select: { id: true, key: true, name: true } },
          createdAt: true,
        },
      });

      const applied = await this.applyTelegramEventSlotRows({
        tx,
        organizationId,
        sessionId: session.id,
        chatId: source.chatId,
        messageId: cachedMessage.messageId,
        ownerUserId,
        rows: slotRows,
      });

      return {
        ...updatedSession,
        importedTeams: applied.importedTeams,
        logoTargets: applied.logoTargets,
        telegram: {
          chatId: source.chatId,
          chatTitle: cachedMessage.chatTitle,
          messageId: cachedMessage.messageId,
          parsedSlotRows: slotRows.length,
        },
        skipped: applied.skipped,
      };
    });
    const { logoTargets, ...result } = refreshResult;
    const logos = await this.applyTelegramLogosToTeams({
      organizationId,
      chatId: source.chatId,
      targets: logoTargets,
    });
    const syncedMatches = await this.syncDraftEventMatchesFromRegistrations(
      session.id,
      organizationId,
    );

    return {
      ...result,
      logos,
      syncedMatches,
    };
  }

  private async initializePolling() {
    try {
      const me = await this.telegramRequest<{
        username?: string;
        first_name?: string;
      }>('getMe');
      this.botUsername = me.username ?? me.first_name ?? null;
      this.lastError = null;
    } catch (error) {
      this.lastError = String(error);
    }
    this.schedulePoll(0);
  }

  private schedulePoll(delayMs: number) {
    if (this.stopped) return;
    this.pollTimer = setTimeout(() => {
      void this.pollOnce();
    }, delayMs);
  }

  private async pollOnce() {
    if (this.stopped || !this.token) return;
    try {
      const params = new URLSearchParams({
        timeout: String(TELEGRAM_POLL_TIMEOUT_SECONDS),
        limit: '50',
        allowed_updates: JSON.stringify([
          'message',
          'edited_message',
          'channel_post',
          'edited_channel_post',
        ]),
      });
      if (this.offset !== null) {
        params.set('offset', String(this.offset));
      }
      const updates = await this.telegramRequest<TelegramUpdate[]>(
        `getUpdates?${params.toString()}`,
      );
      for (const update of updates) {
        this.offset = Math.max(this.offset ?? 0, update.update_id + 1);
        const message =
          update.message ??
          update.edited_message ??
          update.channel_post ??
          update.edited_channel_post ??
          null;
        if (message) {
          const cached = this.cacheMessage(message);
          if (
            cached?.message &&
            isTelegramSlotListMessageText(cached.message.text)
          ) {
            void this.autoRefreshFromTelegramSlotList(cached.message).catch(
              (error) => {
                this.logger.warn(
                  `Telegram slot-list auto-refresh skipped: ${String(error)}`,
                );
              },
            );
          }
          if (cached?.logo) {
            void this.autoApplyTelegramLogo(cached.logo).catch((error) => {
              this.logger.warn(
                `Telegram logo auto-apply skipped: ${String(error)}`,
              );
            });
          }
        }
      }
      this.lastError = null;
      this.schedulePoll(0);
    } catch (error) {
      this.lastError = String(error).slice(0, 500);
      this.schedulePoll(5000);
    }
  }

  private async telegramRequest<T>(methodAndQuery: string) {
    if (!this.token) {
      throw new BadRequestException('Telegram bot token is not configured');
    }
    const response = await fetch(
      `${TELEGRAM_API_BASE_URL}/bot${this.token}/${methodAndQuery}`,
    );
    const payload = (await response
      .json()
      .catch(() => null)) as TelegramApiResponse<T> | null;
    if (!response.ok || !payload?.ok) {
      throw new Error(
        payload?.description ||
          `Telegram API request failed with HTTP ${response.status}`,
      );
    }
    return payload.result as T;
  }

  private telegramLogoCandidateMatchesTeam(
    logo: CachedTelegramLogo,
    target: Pick<TelegramLogoTarget, 'teamName' | 'teamTag'>,
  ) {
    return (
      telegramLogoTextMatchesTeam(
        logo.caption,
        target.teamName,
        target.teamTag,
      ) ||
      telegramLogoTextMatchesTeam(
        logo.fileName,
        target.teamName,
        target.teamTag,
      )
    );
  }

  private findTelegramLogoCandidate(
    chatId: string,
    target: Pick<TelegramLogoTarget, 'teamName' | 'teamTag'>,
  ) {
    const chat = this.chats.get(chatId);
    if (!chat?.logos?.length) return null;
    return (
      chat.logos
        .filter((logo) => this.telegramLogoCandidateMatchesTeam(logo, target))
        .slice()
        .sort((left, right) =>
          String(right.date ?? right.updatedAt).localeCompare(
            String(left.date ?? left.updatedAt),
          ),
        )[0] ?? null
    );
  }

  private telegramLogoMimeType(
    filePath: string | null,
    fallback?: string | null,
  ) {
    const cleanFallback = fallback?.split(';')[0].trim().toLowerCase() ?? '';
    if (Object.values(TELEGRAM_IMAGE_MIME_BY_EXT).includes(cleanFallback)) {
      return cleanFallback;
    }
    const ext = path.extname(filePath ?? '').toLowerCase();
    return TELEGRAM_IMAGE_MIME_BY_EXT[ext] ?? null;
  }

  private async downloadTelegramLogo(logo: CachedTelegramLogo) {
    const file = await this.telegramRequest<{
      file_id: string;
      file_unique_id?: string;
      file_size?: number;
      file_path?: string;
    }>(`getFile?file_id=${encodeURIComponent(logo.fileId)}`);
    if (!file.file_path) {
      throw new Error('Telegram file path is missing');
    }
    if (file.file_size && file.file_size > TELEGRAM_MAX_LOGO_BYTES) {
      throw new Error('Telegram logo file is too large');
    }

    const response = await fetch(
      `${TELEGRAM_API_BASE_URL}/file/bot${this.token}/${file.file_path}`,
    );
    if (!response.ok) {
      throw new Error(
        `Telegram file download failed with HTTP ${response.status}`,
      );
    }
    const contentLength = Number(response.headers.get('content-length') ?? '0');
    if (contentLength > TELEGRAM_MAX_LOGO_BYTES) {
      throw new Error('Telegram logo file is too large');
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > TELEGRAM_MAX_LOGO_BYTES) {
      throw new Error('Telegram logo file is too large');
    }

    const mimetype = this.telegramLogoMimeType(
      file.file_path,
      response.headers.get('content-type') ?? logo.mimeType,
    );
    if (!mimetype) {
      throw new Error('Telegram logo file type is not supported');
    }
    return { buffer, mimetype };
  }

  private async applyTelegramLogosToTeams(params: {
    organizationId: string;
    chatId: string;
    targets: TelegramLogoTarget[];
  }) {
    let matched = 0;
    let updated = 0;
    const skipped: Array<{ teamName: string; reason: string }> = [];
    const seenTeamIds = new Set<string>();

    for (const target of params.targets) {
      if (seenTeamIds.has(target.teamId)) continue;
      seenTeamIds.add(target.teamId);

      const logo = this.findTelegramLogoCandidate(params.chatId, target);
      if (!logo) continue;
      matched += 1;

      const team = await this.prisma.team.findFirst({
        where: {
          id: target.teamId,
          organizationId: params.organizationId,
          deletedAt: null,
        },
        select: { id: true, name: true },
      });
      if (!team) {
        skipped.push({ teamName: target.teamName, reason: 'team not found' });
        continue;
      }

      try {
        const file = await this.downloadTelegramLogo(logo);
        const stored = storeTeamLogo(team.id, file);
        await this.prisma.team.update({
          where: { id: team.id },
          data: { logoUrl: stored.url },
          select: { id: true },
        });
        updated += 1;
      } catch (error) {
        skipped.push({
          teamName: target.teamName,
          reason: String(error).slice(0, 300),
        });
      }
    }

    return {
      matched,
      updated,
      skipped,
    };
  }

  private async linkedTelegramEventsForChat(chatId: string) {
    const notePrefix = `${TELEGRAM_EVENT_IMPORT_NOTE_PREFIX}chat=${chatId};`;
    return this.prisma.session.findMany({
      where: {
        type: SessionType.EVENT,
        deletedAt: null,
        status: { not: SessionStatus.ARCHIVED },
        registrations: {
          some: {
            deletedAt: null,
            note: { startsWith: notePrefix },
          },
        },
      },
      select: {
        id: true,
        organizationId: true,
        name: true,
        createdById: true,
        updatedById: true,
        game: { select: { id: true, key: true, name: true } },
      },
    }) as Promise<TelegramLinkedEvent[]>;
  }

  private selectAutoRefreshEvent(
    events: TelegramLinkedEvent[],
    message: CachedTelegramMessage,
  ) {
    if (events.length === 1) return events[0];

    const messageName = normalizeTelegramEventName(
      this.deriveEventNameFromMessage(message),
    );
    if (!messageName) return null;

    const matches = events.filter(
      (event) => normalizeTelegramEventName(event.name) === messageName,
    );
    return matches.length === 1 ? matches[0] : null;
  }

  private async refreshLinkedTelegramEventFromMessage(params: {
    event: TelegramLinkedEvent;
    message: CachedTelegramMessage;
  }) {
    const ownerUserId = params.event.updatedById ?? params.event.createdById;
    if (!ownerUserId) {
      throw new Error(`event ${params.event.id} has no owner user`);
    }

    const effectiveGame =
      params.event.game ?? ({ id: null, key: GameKey.PUBG_MOBILE } as const);
    const defaultSlotCount = defaultSlotCountForGame(effectiveGame.key);
    const startSlot = 3;
    const parseOptions = {
      startSlot,
      normalSlots: Math.max(0, defaultSlotCount - startSlot + 1),
    } satisfies DiscordEventSlotParseOptions;
    const slotRows = parseTelegramEventSlotRows(
      params.message.text,
      parseOptions,
    );
    const slotCount = Math.min(
      100,
      Math.max(
        defaultSlotCount,
        slotRows.reduce((max, row) => Math.max(max, row.slotNumber), 0),
      ),
    );

    const refreshResult = await this.prisma.$transaction(async (tx) => {
      await tx.session.update({
        where: { id: params.event.id },
        data: {
          slotCount,
          maxTeams: slotCount,
          updatedById: ownerUserId,
        },
        select: { id: true },
      });

      return this.applyTelegramEventSlotRows({
        tx,
        organizationId: params.event.organizationId,
        sessionId: params.event.id,
        chatId: params.message.chatId,
        messageId: params.message.messageId,
        ownerUserId,
        rows: slotRows,
      });
    });

    const logos = await this.applyTelegramLogosToTeams({
      organizationId: params.event.organizationId,
      chatId: params.message.chatId,
      targets: refreshResult.logoTargets,
    });
    const syncedMatches = await this.syncDraftEventMatchesFromRegistrations(
      params.event.id,
      params.event.organizationId,
    );

    return {
      importedTeams: refreshResult.importedTeams,
      parsedSlotRows: slotRows.length,
      logos,
      syncedMatches,
      skipped: refreshResult.skipped,
    };
  }

  private async autoRefreshFromTelegramSlotList(
    message: CachedTelegramMessage,
  ) {
    const events = await this.linkedTelegramEventsForChat(message.chatId);
    if (events.length === 0) return null;

    const event = this.selectAutoRefreshEvent(events, message);
    if (!event) {
      this.logger.warn(
        `Telegram slot-list auto-refresh skipped for chat ${message.chatId}: ${events.length} linked events and no exact event-name match`,
      );
      return null;
    }

    return this.refreshLinkedTelegramEventFromMessage({ event, message });
  }

  private async autoApplyTelegramLogo(logo: CachedTelegramLogo) {
    const notePrefix = `${TELEGRAM_EVENT_IMPORT_NOTE_PREFIX}chat=${logo.chatId};`;
    const registrations = await this.prisma.sessionRegistration.findMany({
      where: {
        deletedAt: null,
        status: {
          notIn: [
            SessionRegistrationStatus.REMOVED,
            SessionRegistrationStatus.DECLINED,
          ],
        },
        note: { startsWith: notePrefix },
        session: {
          type: SessionType.EVENT,
          deletedAt: null,
          status: { not: SessionStatus.ARCHIVED },
        },
      },
      select: {
        organizationId: true,
        team: {
          select: {
            id: true,
            name: true,
            tag: true,
          },
        },
      },
    });

    const targetsByOrg = new Map<string, TelegramLogoTarget[]>();
    for (const registration of registrations) {
      const team = registration.team;
      if (
        !team ||
        !this.telegramLogoCandidateMatchesTeam(logo, {
          teamName: team.name,
          teamTag: team.tag,
        })
      ) {
        continue;
      }
      const targets = targetsByOrg.get(registration.organizationId) ?? [];
      targets.push({
        teamId: team.id,
        teamName: team.name,
        teamTag: team.tag,
      });
      targetsByOrg.set(registration.organizationId, targets);
    }

    const results: Array<{
      matched: number;
      updated: number;
      skipped: Array<{ teamName: string; reason: string }>;
    }> = [];
    for (const [organizationId, targets] of targetsByOrg) {
      results.push(
        await this.applyTelegramLogosToTeams({
          organizationId,
          chatId: logo.chatId,
          targets,
        }),
      );
    }
    return results;
  }

  private findRefreshSourceMessage(chatId: string, messageId: string) {
    const chat = this.chats.get(chatId);
    if (!chat) return null;

    const exact = chat.messages.find(
      (message) => message.messageId === messageId,
    );
    const newestSlotList = chat.messages
      .filter((message) => isTelegramSlotListMessageText(message.text))
      .slice()
      .sort((left, right) =>
        String(right.date ?? right.updatedAt).localeCompare(
          String(left.date ?? left.updatedAt),
        ),
      )[0];

    if (!newestSlotList) return exact ?? null;
    if (!exact) return newestSlotList;

    const newestTime = Date.parse(
      newestSlotList.date ?? newestSlotList.updatedAt,
    );
    const exactTime = Date.parse(exact.date ?? exact.updatedAt);
    if (
      newestSlotList.messageId !== exact.messageId &&
      Number.isFinite(newestTime) &&
      (!Number.isFinite(exactTime) || newestTime >= exactTime)
    ) {
      return newestSlotList;
    }

    return exact;
  }

  private cacheMessage(message: TelegramMessage) {
    const text = telegramMessageText(message);
    const image = telegramMessageImage(message);
    if (!text && !image) return;

    const chatId = telegramChatId(message.chat);
    const messageId = String(message.message_id);
    const updatedAt = new Date().toISOString();
    const date = new Date(
      1000 *
        (message.edit_date ?? message.date ?? Math.floor(Date.now() / 1000)),
    ).toISOString();
    const chat =
      this.chats.get(chatId) ??
      ({
        id: chatId,
        title: telegramChatTitle(message.chat),
        type: message.chat.type ?? null,
        username: message.chat.username ?? null,
        lastMessageAt: null,
        messages: [],
        logos: [],
      } satisfies CachedTelegramChat);

    chat.title = telegramChatTitle(message.chat);
    chat.type = message.chat.type ?? chat.type;
    chat.username = message.chat.username ?? chat.username;
    chat.lastMessageAt = date;
    chat.messages ??= [];
    chat.logos ??= [];

    let cachedMessage: CachedTelegramMessage | null = null;
    let cachedLogo: CachedTelegramLogo | null = null;

    if (text) {
      cachedMessage = {
        id: `${chatId}:${messageId}`,
        chatId,
        chatTitle: chat.title,
        chatType: chat.type,
        messageId,
        text,
        preview: compactPreview(text),
        date,
        updatedAt,
      } satisfies CachedTelegramMessage;

      const existingIndex = chat.messages.findIndex(
        (entry) => entry.messageId === messageId,
      );
      if (existingIndex >= 0) {
        chat.messages[existingIndex] = cachedMessage;
      } else {
        chat.messages.unshift(cachedMessage);
        chat.messages = chat.messages.slice(0, TELEGRAM_MESSAGE_CACHE_LIMIT);
      }
    }

    if (image) {
      cachedLogo = {
        id: `${chatId}:${messageId}:${image.fileId}`,
        chatId,
        chatTitle: chat.title,
        messageId,
        fileId: image.fileId,
        fileUniqueId: image.fileUniqueId,
        fileName: image.fileName,
        mimeType: image.mimeType,
        caption: text || null,
        date,
        updatedAt,
      } satisfies CachedTelegramLogo;

      const existingLogoIndex = chat.logos.findIndex(
        (entry) => entry.messageId === messageId,
      );
      if (existingLogoIndex >= 0) {
        chat.logos[existingLogoIndex] = cachedLogo;
      } else {
        chat.logos.unshift(cachedLogo);
        chat.logos = chat.logos.slice(0, TELEGRAM_LOGO_CACHE_LIMIT);
      }
    }
    this.chats.set(chatId, chat);
    return {
      message: cachedMessage,
      logo: cachedLogo,
    };
  }

  private actorId(actor: Actor | null | undefined) {
    return actor?.actorId ?? actor?.id ?? null;
  }

  private requireOrg(actor: Actor) {
    const organizationId = effectiveOrganizationId(actor);
    if (!organizationId) {
      throw new ForbiddenException('Organization scope is required');
    }
    return organizationId;
  }

  private normalizeGameKey(input: string | null | undefined) {
    const trimmed = input?.trim();
    if (!trimmed) return null;
    const normalized = trimmed.toUpperCase();
    if (!Object.values(GameKey).includes(normalized as GameKey)) {
      throw new BadRequestException(
        `gameKey must be one of ${Object.values(GameKey).join(', ')}`,
      );
    }
    return normalized as GameKey;
  }

  private async resolveGameIdentity(gameKey: string | null | undefined) {
    const normalizedGameKey = this.normalizeGameKey(gameKey);
    if (!normalizedGameKey) return null;
    const game = await this.prisma.game.findUnique({
      where: { key: normalizedGameKey },
      select: { id: true, key: true },
    });
    if (!game) {
      throw new BadRequestException(
        `No Game record found for gameKey ${normalizedGameKey}`,
      );
    }
    return game;
  }

  private deriveEventNameFromMessage(message: CachedTelegramMessage) {
    return (
      message.text
        .split(/\r?\n/)
        .map((line) => stripTelegramMarkdown(line).trim())
        .find((line) => line && !isTelegramSlotHeaderLine(line))
        ?.slice(0, 120) ?? null
    );
  }

  private telegramEventImportNote(params: {
    chatId: string;
    messageId: string;
    slotNumber: number;
  }) {
    return `${TELEGRAM_EVENT_IMPORT_NOTE_PREFIX}chat=${params.chatId};message=${params.messageId};slot=${params.slotNumber}`;
  }

  private async findOrCreateImportedTelegramTeam(params: {
    tx: Prisma.TransactionClient;
    organizationId: string;
    ownerUserId: string;
    row: DiscordEventSlotRow;
  }) {
    const existing = await params.tx.team.findFirst({
      where: {
        organizationId: params.organizationId,
        deletedAt: null,
        name: { equals: params.row.teamName, mode: 'insensitive' },
      },
      select: { id: true },
    });
    if (existing) return existing.id;

    const team = await params.tx.team.create({
      data: {
        organizationId: params.organizationId,
        ownerUserId: params.ownerUserId,
        name: params.row.teamName,
        tag: params.row.teamTag?.trim() || null,
      },
      select: { id: true },
    });
    return team.id;
  }

  private async syncDraftEventMatchesFromRegistrations(
    sessionId: string,
    organizationId: string,
  ): Promise<SyncSessionMatchSlotsResult[]> {
    const session = await this.prisma.session.findFirst({
      where: { id: sessionId, organizationId, deletedAt: null },
      select: { slotCount: true },
    });
    const matches = await this.prisma.match.findMany({
      where: {
        sessionId,
        organizationId,
        deletedAt: null,
        status: MatchStatus.DRAFT,
        liveState: LiveState.UPCOMING,
      },
      select: {
        id: true,
        slotCount: true,
        dataMode: true,
        dataSource: true,
      },
      orderBy: [{ matchNumber: 'asc' }, { createdAt: 'asc' }],
    });

    const synced: SyncSessionMatchSlotsResult[] = [];
    for (const match of matches) {
      if (session && match.slotCount !== session.slotCount) {
        await this.prisma.match.update({
          where: { id: match.id },
          data: { slotCount: session.slotCount },
        });
      }
      const result = await syncMatchSlotsWithSessionRegistrations(this.prisma, {
        sessionId,
        organizationId,
        matchId: match.id,
        dataMode: match.dataMode,
        dataSource: match.dataSource,
      });
      synced.push(result);
    }
    return synced;
  }

  private async applyTelegramEventSlotRows(params: {
    tx: Prisma.TransactionClient;
    organizationId: string;
    sessionId: string;
    chatId: string;
    messageId: string;
    ownerUserId: string;
    rows: DiscordEventSlotRow[];
  }) {
    const existingRegistrations = await params.tx.sessionRegistration.findMany({
      where: {
        organizationId: params.organizationId,
        sessionId: params.sessionId,
        deletedAt: null,
      },
      select: {
        id: true,
        teamId: true,
        status: true,
        slotNumber: true,
        note: true,
      },
    });
    const importedRegistrations = existingRegistrations.filter((registration) =>
      registration.note?.startsWith(TELEGRAM_EVENT_IMPORT_NOTE_PREFIX),
    );
    const touchedRegistrationIds = new Set<string>();
    const touchedTeamIds = new Set<string>();
    const logoTargets = new Map<string, TelegramLogoTarget>();
    const skipped: Array<{
      slotNumber: number;
      teamName: string;
      reason: string;
    }> = [];
    const now = new Date();

    for (const row of params.rows) {
      const teamId = await this.findOrCreateImportedTelegramTeam({
        tx: params.tx,
        organizationId: params.organizationId,
        ownerUserId: params.ownerUserId,
        row,
      });
      if (touchedTeamIds.has(teamId)) {
        skipped.push({
          slotNumber: row.slotNumber,
          teamName: row.teamName,
          reason: 'team appears more than once in the Telegram slot list',
        });
        continue;
      }
      const slotConflict = existingRegistrations.find(
        (registration) =>
          registration.slotNumber === row.slotNumber &&
          registration.teamId !== teamId &&
          !registration.note?.startsWith(TELEGRAM_EVENT_IMPORT_NOTE_PREFIX) &&
          registration.status !== SessionRegistrationStatus.REMOVED &&
          registration.status !== SessionRegistrationStatus.DECLINED,
      );
      if (slotConflict) {
        skipped.push({
          slotNumber: row.slotNumber,
          teamName: row.teamName,
          reason: 'slot is already held by a manual registration',
        });
        continue;
      }
      touchedTeamIds.add(teamId);
      logoTargets.set(teamId, {
        teamId,
        teamName: row.teamName,
        teamTag: row.teamTag?.trim() || null,
      });

      const note = this.telegramEventImportNote({
        chatId: params.chatId,
        messageId: params.messageId,
        slotNumber: row.slotNumber,
      });
      const existing = existingRegistrations.find(
        (registration) => registration.teamId === teamId,
      );
      const importedSlot = existingRegistrations.find(
        (registration) =>
          registration.slotNumber === row.slotNumber &&
          registration.note?.startsWith(TELEGRAM_EVENT_IMPORT_NOTE_PREFIX),
      );
      if (existing && importedSlot && existing.id !== importedSlot.id) {
        await params.tx.sessionRegistration.update({
          where: { id: importedSlot.id },
          data: {
            status: SessionRegistrationStatus.REMOVED,
            slotNumber: null,
            waitlistPosition: null,
            removedAt: now,
            removalReason: 'Replaced by Telegram slot-list import',
          },
          select: { id: true },
        });
        importedSlot.status = SessionRegistrationStatus.REMOVED;
        importedSlot.slotNumber = null;
      }
      if (existing) {
        const updated = await params.tx.sessionRegistration.update({
          where: { id: existing.id },
          data: {
            teamId,
            status: SessionRegistrationStatus.CONFIRMED,
            slotNumber: row.slotNumber,
            waitlistPosition: null,
            confirmedAt: now,
            checkedInAt: null,
            removedAt: null,
            removalReason: null,
            deletedAt: null,
            note,
          },
          select: { id: true },
        });
        existing.teamId = teamId;
        existing.status = SessionRegistrationStatus.CONFIRMED;
        existing.slotNumber = row.slotNumber;
        existing.note = note;
        touchedRegistrationIds.add(updated.id);
      } else if (importedSlot) {
        const updated = await params.tx.sessionRegistration.update({
          where: { id: importedSlot.id },
          data: {
            teamId,
            status: SessionRegistrationStatus.CONFIRMED,
            slotNumber: row.slotNumber,
            waitlistPosition: null,
            confirmedAt: now,
            checkedInAt: null,
            removedAt: null,
            removalReason: null,
            deletedAt: null,
            note,
          },
          select: { id: true },
        });
        importedSlot.teamId = teamId;
        importedSlot.status = SessionRegistrationStatus.CONFIRMED;
        importedSlot.slotNumber = row.slotNumber;
        importedSlot.note = note;
        touchedRegistrationIds.add(updated.id);
      } else {
        const created = await params.tx.sessionRegistration.create({
          data: {
            organizationId: params.organizationId,
            sessionId: params.sessionId,
            teamId,
            status: SessionRegistrationStatus.CONFIRMED,
            slotNumber: row.slotNumber,
            waitlistPosition: null,
            confirmedAt: now,
            checkedInAt: null,
            note,
          },
          select: { id: true },
        });
        existingRegistrations.push({
          id: created.id,
          teamId,
          status: SessionRegistrationStatus.CONFIRMED,
          slotNumber: row.slotNumber,
          note,
        });
        touchedRegistrationIds.add(created.id);
      }
    }

    for (const registration of importedRegistrations) {
      if (touchedRegistrationIds.has(registration.id)) continue;
      await params.tx.sessionRegistration.update({
        where: { id: registration.id },
        data: {
          status: SessionRegistrationStatus.REMOVED,
          slotNumber: null,
          waitlistPosition: null,
          removedAt: now,
          removalReason: 'Removed from Telegram slot-list import',
        },
      });
    }

    return {
      importedTeams: touchedRegistrationIds.size,
      logoTargets: Array.from(logoTargets.values()),
      skipped,
    };
  }
}

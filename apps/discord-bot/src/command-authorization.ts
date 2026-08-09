import type {
  CommandAuthorizationPolicy,
  SlashCommandRegistration,
} from "./command-contract";
import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
} from "discord.js";
import { findApplicationCommandRegistration } from "./command-registry";

export type CommandAuthorizationSessionResolution =
  | Readonly<{ allowed: true; sessionId: string | null }>
  | Readonly<{
      allowed: false;
      reason: string;
      error?: unknown;
    }>;

type ConfiguredSessionLookup = (
  guildId: string,
  channelId: string,
  channelTopic: string | null,
) => Promise<{ session: { id: string } } | null>;

const CONFIGURED_SESSION_REQUIRED_REASON =
  "Use this command in a configured Arenzyra session channel or provide a session ID.";

const STAFF_CONTROL_ACTIONS = new Set([
  "create-scrim",
  "configure-scrim",
  "setup-channels",
  "sync-discord",
  "remove-team",
  "start-scrim",
  "post-room",
  "map-slots",
  "preview-results",
  "apply-results",
]);

const STAFF_COMPONENT_PREFIXES = [
  "destructive:",
  "clean-channel:",
  "autoclean:full:",
  "regctl:",
  "regctl-remove-",
  "regslot:",
  "waitctl:",
  "banctl:",
  "banctl-modal:",
  "cardban:",
  "cardban-modal:",
  "cardban-permanent-modal:",
  "livecenter:",
  "resultctl:",
  "resultctl-modal:",
  "resultctl-session-select",
  "resultedit:",
  "resultedit-modal:",
  "resultmanual:",
  "resultmanual-modal:",
  "resultban:",
  "resultban-modal:",
  "sessctl:",
  "result:auto:",
  "banflow:",
  "autoreggrant:",
  "stafftask:",
];

const SELF_SERVICE_COMPONENT_PREFIXES = [
  "play:",
  "playpick:",
  "captain:",
  "ticket:",
  "idpdm:reply:",
  "idpdm:modal:",
];

const SELF_SERVICE_CONTROL_ACTIONS = new Set([
  "register-team",
  "join-scrim",
  "leave-scrim",
  "list-slots",
  "standings",
]);

export function commandRequiresStaff(commandName: string) {
  return commandAuthorizationPolicy(commandName) === "staff";
}

export function commandAuthorizationPolicy(
  commandName: string,
): CommandAuthorizationPolicy | "unclassified" {
  return (
    findApplicationCommandRegistration(commandName)?.authorization.policy ??
    "unclassified"
  );
}

export function commandAuthorizationSessionId(
  commandName: string,
  getStringOption: (name: string) => string | null,
) {
  const sessionIdOption = findApplicationCommandRegistration(
    commandName,
  )?.authorization.sessionIdOption;
  if (!sessionIdOption) {
    return null;
  }
  return getStringOption(sessionIdOption)?.trim() || null;
}

/**
 * Resolve the session whose configuration must govern a staff command.
 *
 * `null` is returned as an allowed session only for commands that genuinely do
 * not require configured-channel inference. Commands that opt into inference
 * fail closed when the channel cannot be resolved, so callers never fall back
 * to guild-level staff-role matching after a lookup failure.
 */
export async function resolveCommandAuthorizationSession(
  registration: SlashCommandRegistration,
  interaction: ChatInputCommandInteraction | AutocompleteInteraction,
  lookupConfiguredSession: ConfiguredSessionLookup,
): Promise<CommandAuthorizationSessionResolution> {
  const optionName = registration.authorization.sessionIdOption;
  if (optionName) {
    try {
      const explicitSessionId = interaction.options
        .getString(optionName)
        ?.trim();
      if (explicitSessionId) {
        return { allowed: true, sessionId: explicitSessionId };
      }
    } catch {
      // The option can be absent from the active subcommand or incomplete
      // autocomplete payload. Configured-channel inference still applies when
      // the registry requires it.
    }
  }

  if (!registration.authorization.inferSessionFromConfiguredChannel) {
    return { allowed: true, sessionId: null };
  }

  if (!interaction.guildId) {
    return { allowed: false, reason: CONFIGURED_SESSION_REQUIRED_REASON };
  }

  let targetChannel = interaction.channel as {
    id: string;
    topic?: unknown;
  } | null;
  const channelOption = registration.authorization.channelOption;
  if (channelOption) {
    try {
      const chatOptions =
        interaction.options as ChatInputCommandInteraction["options"];
      targetChannel =
        (chatOptions.getChannel(channelOption) as {
          id: string;
          topic?: unknown;
        } | null) ?? targetChannel;
    } catch {
      // This subcommand does not expose the optional target-channel field.
    }
  }

  const channelId = targetChannel?.id ?? interaction.channelId;
  if (!channelId) {
    return { allowed: false, reason: CONFIGURED_SESSION_REQUIRED_REASON };
  }
  const topic = targetChannel?.topic;

  try {
    const resolved = await lookupConfiguredSession(
      interaction.guildId,
      channelId,
      typeof topic === "string" ? topic : null,
    );
    const sessionId = resolved?.session.id?.trim();
    return sessionId
      ? { allowed: true, sessionId }
      : { allowed: false, reason: CONFIGURED_SESSION_REQUIRED_REASON };
  } catch (error) {
    return {
      allowed: false,
      reason: CONFIGURED_SESSION_REQUIRED_REASON,
      error,
    };
  }
}

export async function interactionIsPausedFailClosed(
  lookup: () => Promise<boolean>,
  onError?: (error: unknown) => void,
) {
  try {
    return await lookup();
  } catch (error) {
    onError?.(error);
    return true;
  }
}

export function componentRequiresStaff(customId: string) {
  return componentAuthorizationPolicy(customId) === "staff";
}

export function componentAuthorizationPolicy(
  customId: string,
): "staff" | "self-service" | "unclassified" {
  const normalized = String(customId || "").trim();
  if (normalized.startsWith("control:") || normalized.startsWith("control-modal:")) {
    const parts = normalized.split(":");
    if (STAFF_CONTROL_ACTIONS.has(parts[1] || "")) return "staff";
    if (SELF_SERVICE_CONTROL_ACTIONS.has(parts[1] || "")) return "self-service";
    return "unclassified";
  }
  if (
    STAFF_COMPONENT_PREFIXES.some((prefix) => normalized.startsWith(prefix))
  ) {
    return "staff";
  }
  if (
    SELF_SERVICE_COMPONENT_PREFIXES.some((prefix) =>
      normalized.startsWith(prefix),
    )
  ) {
    return "self-service";
  }
  return "unclassified";
}

export function componentAuthorizationSessionId(customId: string) {
  const normalized = String(customId || "").trim();
  if (!componentRequiresStaff(normalized)) return null;
  const parts = normalized.split(":");

  if (normalized.startsWith("autoclean:full:")) return parts[3] || null;
  if (normalized.startsWith("control:")) return parts.slice(2).join(":") || null;
  if (normalized.startsWith("control-modal:")) return parts.slice(2).join(":") || null;
  if (normalized.startsWith("regctl:rm:")) return parts[3] || null;
  if (normalized.startsWith("regctl:")) return parts[2] || null;
  if (normalized.startsWith("regslot:")) return parts[1] || null;
  if (normalized.startsWith("waitctl:")) return parts[2] || null;
  if (normalized.startsWith("banctl-modal:")) return parts[2] || null;
  if (normalized.startsWith("banctl:")) {
    return parts[1] === "confirm" || parts[1] === "cancel"
      ? null
      : parts[2] || null;
  }
  if (normalized.startsWith("cardban-modal:")) return parts[1] || null;
  if (normalized.startsWith("cardban-permanent-modal:")) return parts[1] || null;
  if (normalized.startsWith("cardban:")) return parts[2] || null;
  if (normalized.startsWith("livecenter:")) return parts[2] || null;
  if (normalized.startsWith("resultctl-modal:")) return parts.slice(2).join(":") || null;
  if (normalized.startsWith("resultctl:")) return parts.slice(2).join(":") || null;
  if (normalized.startsWith("resultedit:match:")) return parts.slice(2).join(":") || null;
  if (normalized.startsWith("resultedit:rows:") || normalized.startsWith("resultedit:page:")) {
    return parts[2] || null;
  }
  if (normalized.startsWith("resultmanual:open:")) return parts[2] || null;
  if (normalized.startsWith("resultban:select:")) return parts[2] || null;
  if (normalized.startsWith("sessctl:")) return parts.slice(2).join(":") || null;
  return null;
}

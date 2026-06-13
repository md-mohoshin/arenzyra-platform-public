const DISCORD_SNOWFLAKE_PATTERN = /^\d{15,25}$/;
const DISCORD_USER_MENTION_PATTERN = /<@!?(\d{15,25})>/g;
const DISCORD_ROLE_MENTION_PATTERN = /<@&(\d{15,25})>/g;
const DISCORD_EVERYONE_HERE_PATTERN = /(^|[^\w])@(everyone|here)\b/i;

export type OrganizerAllowedMentions = {
  parse: Array<"everyone">;
  users?: string[];
  roles?: string[];
  repliedUser?: boolean;
};

function uniqueSnowflakes(values: readonly (string | null | undefined)[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const snowflake = value?.trim();
    if (!snowflake || !DISCORD_SNOWFLAKE_PATTERN.test(snowflake)) {
      continue;
    }
    if (seen.has(snowflake)) {
      continue;
    }
    seen.add(snowflake);
    result.push(snowflake);
    if (result.length >= 100) {
      break;
    }
  }
  return result;
}

function mentionIds(content: string, pattern: RegExp) {
  return Array.from(content.matchAll(pattern))
    .map((match) => match[1])
    .filter((value): value is string => Boolean(value));
}

export function allowedMentionsForOrganizerText(
  content: string,
  extras: {
    users?: readonly (string | null | undefined)[];
    roles?: readonly (string | null | undefined)[];
  } = {},
): OrganizerAllowedMentions {
  const users = uniqueSnowflakes([
    ...mentionIds(content, DISCORD_USER_MENTION_PATTERN),
    ...(extras.users ?? []),
  ]);
  const roles = uniqueSnowflakes([
    ...mentionIds(content, DISCORD_ROLE_MENTION_PATTERN),
    ...(extras.roles ?? []),
  ]);
  const allowedMentions: OrganizerAllowedMentions = {
    parse: DISCORD_EVERYONE_HERE_PATTERN.test(content) ? ["everyone"] : [],
  };
  if (users.length > 0) {
    allowedMentions.users = users;
  }
  if (roles.length > 0) {
    allowedMentions.roles = roles;
  }
  return allowedMentions;
}

export function mentionContentForOrganizerText(content: string) {
  const mentions: string[] = [];
  const seen = new Set<string>();
  const add = (mention: string) => {
    if (seen.has(mention) || mentions.length >= 100) {
      return;
    }
    seen.add(mention);
    mentions.push(mention);
  };

  if (/(^|[^\w])@everyone\b/i.test(content)) {
    add("@everyone");
  }
  if (/(^|[^\w])@here\b/i.test(content)) {
    add("@here");
  }
  for (const roleId of mentionIds(content, DISCORD_ROLE_MENTION_PATTERN)) {
    add(`<@&${roleId}>`);
  }
  for (const userId of mentionIds(content, DISCORD_USER_MENTION_PATTERN)) {
    add(`<@${userId}>`);
  }

  return mentions.join(" ");
}

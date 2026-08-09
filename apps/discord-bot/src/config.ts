import { config as loadEnv } from 'dotenv';
import path from 'path';

const configurationEnvFilePath = path.resolve(__dirname, '..', '.env');
loadEnv({ path: configurationEnvFilePath });
const configuredNodeEnv = process.env.NODE_ENV?.trim() || 'development';
const configuredStateDir = process.env.ARENZYRA_DISCORD_STATE_DIR?.trim() || null;
const envFilePath = configuredStateDir && configuredNodeEnv !== 'production'
  ? path.resolve(configuredStateDir, 'api-auth.env')
  : configurationEnvFilePath;
if (envFilePath !== configurationEnvFilePath) {
  // This file contains only bot-managed rotated API tokens. It intentionally
  // overrides stale token values from the immutable deployment environment.
  loadEnv({ path: envFilePath, override: true });
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function requireAnyEnv(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) {
      return value;
    }
  }
  throw new Error(`Missing required environment variable: ${names.join(' or ')}`);
}

function optionalEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function optionalBooleanEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) {
    return fallback;
  }
  return value === '1' || value === 'true' || value === 'yes';
}

function optionalPositiveIntegerEnv(name: string, fallback: number): number {
  const raw = optionalEnv(name);
  if (!raw) {
    return fallback;
  }

  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive whole number`);
  }
  return value;
}

function optionalNonNegativeIntegerEnv(name: string, fallback: number): number {
  const raw = optionalEnv(name);
  if (!raw) {
    return fallback;
  }

  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative whole number`);
  }
  return value;
}

export const botConfig = {
  envFilePath,
  nodeEnv: optionalEnv('NODE_ENV') ?? 'development',
  discordBotInstance: optionalEnv('ARENZYRA_DISCORD_BOT_INSTANCE'),
  discordToken: requireAnyEnv('DISCORD_BOT_TOKEN', 'DISCORD_TOKEN'),
  discordClientId: requireEnv('DISCORD_CLIENT_ID'),
  discordGuildId: optionalEnv('DISCORD_GUILD_ID'),
  messageContentIntent: optionalBooleanEnv('DISCORD_MESSAGE_CONTENT_INTENT', false),
  guildMembersIntent: optionalBooleanEnv('DISCORD_GUILD_MEMBERS_INTENT', false),
  registerGlobalCommands: optionalBooleanEnv(
    'DISCORD_REGISTER_GLOBAL_COMMANDS',
    true,
  ),
  apiBaseUrl: requireEnv('ARENZYRA_API_BASE_URL'),
  apiServiceToken: optionalEnv('ARENZYRA_API_SERVICE_TOKEN'),
  apiToken: optionalEnv('ARENZYRA_API_TOKEN'),
  apiRefreshToken: optionalEnv('ARENZYRA_API_REFRESH_TOKEN'),
  apiEmail: optionalEnv('ARENZYRA_API_EMAIL'),
  apiPassword: optionalEnv('ARENZYRA_API_PASSWORD'),
  apiOrganizationId: optionalEnv('ARENZYRA_API_ORGANIZATION_ID'),
  apiUserAgent: 'Arenzyra Discord Bot',
  apiRequestTimeoutMs: optionalPositiveIntegerEnv(
    'ARENZYRA_API_REQUEST_TIMEOUT_MS',
    10_000,
  ),
  apiMaxIdempotentRetries: optionalNonNegativeIntegerEnv(
    'ARENZYRA_API_MAX_IDEMPOTENT_RETRIES',
    2,
  ),
  stateDir: configuredStateDir,
} as const;

export function validateProductionApiAuth(config: {
  nodeEnv: string;
  apiServiceToken: string | null;
  apiOrganizationId: string | null;
  apiToken: string | null;
  apiRefreshToken: string | null;
  apiEmail: string | null;
  apiPassword: string | null;
}) {
  if (config.nodeEnv !== 'production') return;
  if (!config.apiServiceToken || !config.apiOrganizationId) {
    throw new Error(
      'Production Discord bot requires ARENZYRA_API_SERVICE_TOKEN and ARENZYRA_API_ORGANIZATION_ID.',
    );
  }
  if (
    config.apiToken ||
    config.apiRefreshToken ||
    config.apiEmail ||
    config.apiPassword
  ) {
    throw new Error(
      'Production Discord bot rejects human API credentials, bearer tokens, and refresh-token auth; use only the scoped service token.',
    );
  }
}

validateProductionApiAuth(botConfig);

if (
  botConfig.nodeEnv === 'production' &&
  botConfig.discordBotInstance !== 'production'
) {
  throw new Error(
    'Refusing to start the production Discord bot without ARENZYRA_DISCORD_BOT_INSTANCE=production. Set this only on the single approved production host.',
  );
}

if (botConfig.nodeEnv === 'production' && !botConfig.messageContentIntent) {
  throw new Error(
    'Refusing to start the production Discord bot without DISCORD_MESSAGE_CONTENT_INTENT=true during the hybrid migration. Legacy text commands and channel-native roster, slot-list, result, and IDP workflows still require Message Content intent.',
  );
}

if (
  !botConfig.apiServiceToken &&
  !botConfig.apiToken &&
  !botConfig.apiRefreshToken &&
  !(botConfig.apiEmail && botConfig.apiPassword)
) {
  throw new Error(
    'Configure ARENZYRA_API_SERVICE_TOKEN, ARENZYRA_API_TOKEN, ARENZYRA_API_REFRESH_TOKEN, or ARENZYRA_API_EMAIL/ARENZYRA_API_PASSWORD for backend auth.',
  );
}

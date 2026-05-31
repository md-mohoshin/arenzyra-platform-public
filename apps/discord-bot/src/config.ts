import { config as loadEnv } from 'dotenv';
import path from 'path';

const envFilePath = path.resolve(__dirname, '..', '.env');
loadEnv({ path: envFilePath });

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

export const botConfig = {
  envFilePath,
  discordToken: requireAnyEnv('DISCORD_BOT_TOKEN', 'DISCORD_TOKEN'),
  discordClientId: requireEnv('DISCORD_CLIENT_ID'),
  discordGuildId: optionalEnv('DISCORD_GUILD_ID'),
  messageContentIntent: optionalBooleanEnv('DISCORD_MESSAGE_CONTENT_INTENT', false),
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
} as const;

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

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

function optionalEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

export const botConfig = {
  envFilePath,
  discordToken: requireEnv('DISCORD_TOKEN'),
  discordClientId: requireEnv('DISCORD_CLIENT_ID'),
  discordGuildId: optionalEnv('DISCORD_GUILD_ID'),
  apiBaseUrl: requireEnv('ARENZYRA_API_BASE_URL'),
  apiToken: optionalEnv('ARENZYRA_API_TOKEN'),
  apiRefreshToken: optionalEnv('ARENZYRA_API_REFRESH_TOKEN'),
  apiEmail: optionalEnv('ARENZYRA_API_EMAIL'),
  apiPassword: optionalEnv('ARENZYRA_API_PASSWORD'),
  apiOrganizationId: optionalEnv('ARENZYRA_API_ORGANIZATION_ID'),
  apiUserAgent: 'Arenzyra Discord Bot',
} as const;

if (
  !botConfig.apiToken &&
  !botConfig.apiRefreshToken &&
  !(botConfig.apiEmail && botConfig.apiPassword)
) {
  throw new Error(
    'Configure ARENZYRA_API_TOKEN, ARENZYRA_API_REFRESH_TOKEN, or ARENZYRA_API_EMAIL/ARENZYRA_API_PASSWORD for backend auth.',
  );
}

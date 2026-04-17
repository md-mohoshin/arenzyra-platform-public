import 'dotenv/config';
import { z } from 'zod';

const requiredEnvKeys = [
  'PCOB_SECRET',
  'COLLECTOR_SECRET',
  'JWT_SECRET',
  'SUPERADMIN_EMAIL',
  'SUPERADMIN_PASSWORD',
  'OP_EMAIL',
  'OP_PASSWORD',
] as const;

const envSchema = z.object({
  PCOB_SECRET: z.string().min(10, 'must be at least 10 characters'),
  COLLECTOR_SECRET: z.string().min(10, 'must be at least 10 characters'),
  JWT_SECRET: z.string().min(10, 'must be at least 10 characters'),
  SUPERADMIN_EMAIL: z.string().email('must be a valid email address'),
  SUPERADMIN_PASSWORD: z.string().min(6, 'must be at least 6 characters'),
  OP_EMAIL: z.string().email('must be a valid email address'),
  OP_PASSWORD: z.string().min(6, 'must be at least 6 characters'),
});

export type ApiEnv = z.infer<typeof envSchema>;

export const VALIDATED_ENV_KEYS = requiredEnvKeys;

let cachedEnv: ApiEnv | null = null;

function normalizeEnvValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function buildEnvInput(
  source: NodeJS.ProcessEnv,
): Record<string, string | undefined> {
  return {
    PCOB_SECRET: normalizeEnvValue(source.PCOB_SECRET),
    COLLECTOR_SECRET: normalizeEnvValue(source.COLLECTOR_SECRET),
    JWT_SECRET: normalizeEnvValue(source.JWT_SECRET),
    SUPERADMIN_EMAIL: normalizeEnvValue(source.SUPERADMIN_EMAIL),
    SUPERADMIN_PASSWORD: normalizeEnvValue(source.SUPERADMIN_PASSWORD),
    OP_EMAIL: normalizeEnvValue(source.OP_EMAIL),
    OP_PASSWORD: normalizeEnvValue(source.OP_PASSWORD),
  };
}

function formatEnvIssues(issues: z.ZodIssue[]): string {
  return issues
    .map((issue) => {
      const key = String(issue.path[0] ?? 'ENV');
      const rawValue = process.env[key];
      const message =
        typeof rawValue === 'string' && rawValue.trim().length > 0
          ? issue.message
          : 'is required';
      return `- ${key}: ${message}`;
    })
    .join('\n');
}

export function validateEnv(): ApiEnv {
  if (cachedEnv) {
    return cachedEnv;
  }

  const result = envSchema.safeParse(buildEnvInput(process.env));
  if (!result.success) {
    throw new Error(
      `Environment validation failed:\n${formatEnvIssues(result.error.issues)}`,
    );
  }

  cachedEnv = result.data;
  return cachedEnv;
}

export function isValidatedEnvKey(name: string): name is keyof ApiEnv {
  return VALIDATED_ENV_KEYS.includes(
    name as (typeof VALIDATED_ENV_KEYS)[number],
  );
}

export const env = new Proxy({} as ApiEnv, {
  get(_target, prop) {
    if (typeof prop !== 'string') {
      return undefined;
    }
    return validateEnv()[prop as keyof ApiEnv];
  },
});

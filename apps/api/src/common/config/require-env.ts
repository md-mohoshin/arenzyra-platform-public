import { env, isValidatedEnvKey } from '../../config/env.validation';

export function requireEnv(name: string): string {
  if (isValidatedEnvKey(name)) {
    return env[name];
  }

  const value = process.env[name];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`REQUIRED ENV VARIABLE MISSING: ${name}`);
  }
  return value;
}

import crypto from 'crypto';

export function computeWidgetVersion(payload: unknown): string {
  return crypto
    .createHash('sha1')
    .update(JSON.stringify(payload ?? {}))
    .digest('hex');
}

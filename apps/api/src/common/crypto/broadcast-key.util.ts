import { randomBytes } from 'crypto';

export const generateBroadcastKey = (): string =>
  randomBytes(32).toString('hex');

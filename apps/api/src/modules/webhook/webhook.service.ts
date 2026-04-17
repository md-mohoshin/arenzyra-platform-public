import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import axios from 'axios';
import * as crypto from 'crypto';
import { requireEnv } from '../../common/config/require-env';

type WebhookConfig = {
  enabled: boolean;
  urls: string[];
  timeoutMs: number;
  maxRetries: number;
  backoffMs: number;
  signEnabled: boolean;
  signSecret: string;
};

type QueueItem = {
  url: string;
  body: WebhookPayload;
  attempt: number;
  nextAttempt: number;
  event: string;
};

type WebhookPayload = {
  event: string;
  matchId: string;
  timestamp: number;
  data: unknown;
};

@Injectable()
export class WebhookService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('WebhookService');
  private readonly signEnabled =
    (process.env.WEBHOOK_SIGN_ENABLED ?? 'false') === 'true';
  private readonly cfg: WebhookConfig = {
    enabled: (process.env.WEBHOOKS_ENABLED ?? 'false') === 'true',
    urls: (process.env.WEBHOOK_URLS || process.env.WEBHOOKS_URLS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    timeoutMs: Number(process.env.WEBHOOK_TIMEOUT_MS ?? 2500),
    maxRetries: Number(process.env.WEBHOOK_MAX_RETRIES ?? 3),
    backoffMs: Number(process.env.WEBHOOK_BACKOFF_MS ?? 500),
    signEnabled: this.signEnabled,
    signSecret: this.signEnabled ? requireEnv('WEBHOOK_SIGN_SECRET') : '',
  };

  private queue: QueueItem[] = [];
  private deliveredTs: number[] = [];
  private failedTs: number[] = [];
  private worker: NodeJS.Timeout | null = null;

  onModuleInit() {
    if (!this.cfg.enabled || this.cfg.urls.length === 0) {
      this.logger.log('[WEBHOOK] disabled');
      return;
    }
    this.worker = setInterval(() => {
      void this.tick();
    }, 250);
    this.logger.log('[WEBHOOK] initialized');
  }

  onModuleDestroy() {
    if (this.worker) {
      clearInterval(this.worker);
      this.worker = null;
    }
  }

  isEnabled() {
    return this.cfg.enabled && this.cfg.urls.length > 0;
  }

  enqueue(event: string, matchId: string, data: unknown) {
    if (!this.isEnabled()) return;
    const body: WebhookPayload = {
      event,
      matchId,
      timestamp: Date.now(),
      data,
    };
    const now = Date.now();
    for (const url of this.cfg.urls) {
      this.queue.push({ url, body, attempt: 1, nextAttempt: now, event });
      this.logger.log(`[WEBHOOK] queued event=${event} url=${url}`);
    }
  }

  private async tick() {
    const now = Date.now();
    const items = this.queue.filter((q) => q.nextAttempt <= now);
    this.queue = this.queue.filter((q) => q.nextAttempt > now);
    for (const item of items) {
      await this.send(item);
    }
    this.pruneStats();
  }

  private async send(item: QueueItem) {
    const { url, body, attempt, event } = item;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.cfg.signEnabled && this.cfg.signSecret) {
      const raw = JSON.stringify(body);
      const hmac = crypto
        .createHmac('sha256', this.cfg.signSecret)
        .update(raw)
        .digest('hex');
      headers['X-Signature'] = `sha256=${hmac}`;
    }
    try {
      const res = await axios.post(url, body, {
        timeout: this.cfg.timeoutMs,
        headers,
      });
      this.logger.log(
        `[WEBHOOK] delivered status=${res.status} event=${event}`,
      );
      this.deliveredTs.push(Date.now());
    } catch (err: unknown) {
      const errorObj = err as {
        response?: { status?: number };
        message?: string;
      };
      if (attempt >= this.cfg.maxRetries) {
        this.logger.error(
          `[WEBHOOK] dropped event=${event} url=${url} after retries err=${errorObj?.message || String(err)}`,
        );
        this.failedTs.push(Date.now());
        return;
      }
      const nextDelay = this.cfg.backoffMs * Math.pow(2, attempt - 1);
      const nextAttempt = Date.now() + nextDelay;
      this.logger.warn(
        `[WEBHOOK] failed retry=${attempt} status=${errorObj?.response?.status ?? 'n/a'} event=${event}`,
      );
      this.queue.push({ ...item, attempt: attempt + 1, nextAttempt });
    }
  }

  private pruneStats() {
    const cutoff = Date.now() - 5 * 60 * 1000;
    this.deliveredTs = this.deliveredTs.filter((t) => t >= cutoff);
    this.failedTs = this.failedTs.filter((t) => t >= cutoff);
  }

  status() {
    this.pruneStats();
    return {
      enabled: this.isEnabled(),
      queued: this.queue.length,
      delivered_last_5m: this.deliveredTs.length,
      failed_last_5m: this.failedTs.length,
    };
  }
}

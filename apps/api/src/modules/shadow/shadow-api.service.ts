import { Injectable, Logger } from '@nestjs/common';
import axios, { type AxiosInstance } from 'axios';

type ShadowResponse<T = unknown> = T | null;

@Injectable()
export class ShadowApiService {
  private readonly logger = new Logger('ShadowApi');
  private readonly client: AxiosInstance;
  private readonly baseUrl: string;
  private readonly logRequestDebug: boolean;

  constructor() {
    const baseUrl = this.resolveBaseUrl();
    const timeoutMs = Number(process.env.SHADOW_API_TIMEOUT_MS ?? 5000);
    this.logRequestDebug = process.env.SHADOW_API_DEBUG === 'true';
    this.baseUrl = baseUrl;
    this.client = axios.create({
      baseURL: baseUrl,
      timeout: timeoutMs,
    });
    this.logger.log(`Shadow API base URL=${baseUrl}`);
  }

  async getAllInfo(): Promise<ShadowResponse> {
    return this.get('/getallinfo');
  }

  async getTeamInfo(): Promise<ShadowResponse> {
    return this.get('/getteaminfo');
  }

  async getTeamInfoList(): Promise<ShadowResponse> {
    return this.get('/getteaminfolist');
  }

  async getKillInfo(): Promise<ShadowResponse> {
    return this.get('/getkillinfo');
  }

  async getAliveInfo(): Promise<ShadowResponse> {
    return this.get('/getaliveinfo');
  }

  async getCircleInfo(): Promise<ShadowResponse> {
    return this.get('/getcircleinfo');
  }

  async getTotalPlayerList(): Promise<ShadowResponse> {
    return this.get('/gettotalplayerlist');
  }

  async getObservingPlayer(): Promise<ShadowResponse> {
    return this.get('/getobservingplayer');
  }

  async getTeamBackpackInfo(): Promise<ShadowResponse> {
    return this.get('/getteambackpackinfo');
  }

  private resolveBaseUrl(): string {
    const raw = (
      process.env.SHADOW_API_BASE ||
      process.env.SHADOW_API_URL ||
      process.env.SHADOW_URL ||
      process.env.TELEMETRY_URL ||
      'http://127.0.0.1:5000'
    ).trim();
    return raw.replace(/\/$/, '') || 'http://127.0.0.1:5000';
  }

  private async get<T = unknown>(path: string): Promise<ShadowResponse<T>> {
    const url = `${this.baseUrl}${path}`;
    if (this.logRequestDebug) {
      this.logger.debug(`[ShadowPoller] calling ${url}`);
    }
    try {
      const res = await this.client.get<T>(path);
      return (res?.data as T | undefined) ?? null;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Shadow API request failed for ${url} (GET): ${message}`,
      );
      return null;
    }
  }
}

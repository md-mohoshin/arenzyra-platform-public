import axios, { AxiosError, AxiosInstance } from 'axios';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { botConfig } from '../config';

type AuthSessionResponse = {
  access_token?: string;
  accessToken?: string;
  refresh_token?: string;
  refreshToken?: string;
};

export class BotApiAuthService {
  private readonly authClient: AxiosInstance;
  private readonly serviceToken = botConfig.apiServiceToken;
  private accessToken = botConfig.apiToken;
  private refreshToken = botConfig.apiRefreshToken;
  private refreshPromise: Promise<string> | null = null;

  constructor() {
    this.authClient = axios.create({
      baseURL: botConfig.apiBaseUrl,
      headers: {
        'User-Agent': botConfig.apiUserAgent,
      },
    });
  }

  private get hasLoginCredentials(): boolean {
    return Boolean(botConfig.apiEmail && botConfig.apiPassword);
  }

  usesServiceToken(): boolean {
    return Boolean(this.serviceToken);
  }

  private extractMessage(error: unknown): string {
    if (axios.isAxiosError(error)) {
      const payload = error.response?.data;
      const responseMessage =
        payload && typeof payload === 'object' && 'message' in payload
          ? (payload as { message?: unknown }).message
          : undefined;

      if (typeof responseMessage === 'string') {
        return responseMessage;
      }

      if (Array.isArray(responseMessage)) {
        return responseMessage
          .filter((entry): entry is string => typeof entry === 'string')
          .join(', ');
      }

      return error.message;
    }

    return error instanceof Error ? error.message : 'Unknown auth error';
  }

  private upsertEnvValue(
    source: string,
    key: string,
    value: string | null,
    lineBreak: string,
  ): string {
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    const nextLine = `${key}=${value ?? ''}`;

    if (pattern.test(source)) {
      return source.replace(pattern, nextLine);
    }

    if (!source.trim()) {
      return `${nextLine}${lineBreak}`;
    }

    const suffix = source.endsWith('\n') || source.endsWith('\r\n') ? '' : lineBreak;
    return `${source}${suffix}${nextLine}${lineBreak}`;
  }

  private persistTokens() {
    const lineBreak =
      existsSync(botConfig.envFilePath) &&
      readFileSync(botConfig.envFilePath, 'utf8').includes('\r\n')
        ? '\r\n'
        : '\n';
    const source = existsSync(botConfig.envFilePath)
      ? readFileSync(botConfig.envFilePath, 'utf8')
      : '';

    let nextSource = this.upsertEnvValue(
      source,
      'ARENZYRA_API_TOKEN',
      this.accessToken,
      lineBreak,
    );
    nextSource = this.upsertEnvValue(
      nextSource,
      'ARENZYRA_API_REFRESH_TOKEN',
      this.refreshToken,
      lineBreak,
    );

    writeFileSync(botConfig.envFilePath, nextSource, 'utf8');

    process.env.ARENZYRA_API_TOKEN = this.accessToken ?? '';
    process.env.ARENZYRA_API_REFRESH_TOKEN = this.refreshToken ?? '';
  }

  private consumeSession(response: AuthSessionResponse): string {
    const accessToken = response.accessToken ?? response.access_token ?? null;
    const refreshToken =
      response.refreshToken ?? response.refresh_token ?? this.refreshToken ?? null;

    if (!accessToken) {
      throw new Error('Arenzyra auth response did not include an access token');
    }
    if (!refreshToken) {
      throw new Error('Arenzyra auth response did not include a refresh token');
    }

    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    this.persistTokens();

    return accessToken;
  }

  private async loginWithCredentials(): Promise<string> {
    if (!this.hasLoginCredentials) {
      throw new Error(
        'Arenzyra bot auth cannot log in automatically because ARENZYRA_API_EMAIL and ARENZYRA_API_PASSWORD are missing.',
      );
    }

    try {
      const response = await this.authClient.post<AuthSessionResponse>('/auth/login', {
        email: botConfig.apiEmail,
        password: botConfig.apiPassword,
      });
      return this.consumeSession(response.data);
    } catch (error) {
      throw new Error(`Arenzyra API login failed: ${this.extractMessage(error)}`);
    }
  }

  private async refreshWithToken(): Promise<string> {
    if (!this.refreshToken) {
      throw new Error(
        'Arenzyra bot auth cannot refresh automatically because ARENZYRA_API_REFRESH_TOKEN is missing.',
      );
    }

    try {
      const response = await this.authClient.post<AuthSessionResponse>(
        '/auth/refresh',
        {
          refresh_token: this.refreshToken,
        },
      );
      return this.consumeSession(response.data);
    } catch (error) {
      throw new Error(`Arenzyra API refresh failed: ${this.extractMessage(error)}`);
    }
  }

  private async refreshOrLoginInternal(): Promise<string> {
    if (this.refreshToken) {
      try {
        return await this.refreshWithToken();
      } catch (error) {
        if (!this.hasLoginCredentials) {
          throw error;
        }
      }
    }

    return this.loginWithCredentials();
  }

  async getAccessToken(): Promise<string> {
    if (this.accessToken) {
      return this.accessToken;
    }

    return this.refreshAccessTokenOrLogin();
  }

  async getAuthorizationHeader(): Promise<string> {
    if (this.serviceToken) {
      return `Bot ${this.serviceToken}`;
    }

    return `Bearer ${await this.getAccessToken()}`;
  }

  invalidateAccessToken() {
    if (this.serviceToken) {
      return;
    }
    this.accessToken = null;
    process.env.ARENZYRA_API_TOKEN = '';
  }

  isUnauthorizedError(error: unknown): boolean {
    if (!axios.isAxiosError(error)) {
      return false;
    }

    const status = (error as AxiosError).response?.status ?? null;
    return status === 401 || status === 403;
  }

  async refreshAccessTokenOrLogin(): Promise<string> {
    if (this.serviceToken) {
      return this.serviceToken;
    }

    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.refreshOrLoginInternal();

    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }
}

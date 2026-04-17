import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { MatchStatus } from '@prisma/client';
import { readFile } from 'fs/promises';
import { join } from 'path';
import puppeteer from 'puppeteer';
import type { AuthUser } from '../../common/auth/auth.types';
import { isPresentInMatch } from '../../common/results-presence.util';
import { PrismaService } from '../../db/prisma.service';
import { OrganizationBrandingService } from '../organization-branding/organization-branding.service';
import { ResultsService } from '../results/results.service';
import { SessionsStandingsService } from '../sessions/sessions-standings.service';

const DEFAULT_RENDER_BACKGROUND = '#0b0f14';
const DEFAULT_RENDER_PRIMARY = '#00e5ff';
const DEFAULT_RENDER_TEXT = '#f5f7fb';
const DEFAULT_RENDER_MUTED = '#94a3b8';
const DEFAULT_RENDER_PANEL = 'rgba(11, 15, 20, 0.74)';
const DEFAULT_RENDER_BORDER = 'rgba(255, 255, 255, 0.12)';
const DEFAULT_RENDER_SHADOW = '0 24px 64px rgba(0, 0, 0, 0.45)';
const MATCH_VIEWPORT = { width: 1200, height: 630, deviceScaleFactor: 2 };
const STANDINGS_LIMIT = 10;

type MatchTemplateInput = {
  matchName: string;
  teams: Array<{
    position: number;
    tag: string;
    points: number;
    kills: number;
  }>;
  branding: TemplateBranding;
  footer?: string;
};

type StandingsTemplateInput = {
  sessionName: string;
  teams: Array<{
    rank: number;
    tag: string;
    totalPoints: number;
  }>;
  branding: TemplateBranding;
  footer?: string;
};

type TemplateBranding = {
  primaryColor: string;
  background: string;
  textPrimary: string;
  textMuted: string;
  panel: string;
  border: string;
  shadow: string;
  logoUrl: string | null;
};

@Injectable()
export class RenderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly results: ResultsService,
    private readonly sessionStandings: SessionsStandingsService,
    private readonly organizationBranding: OrganizationBrandingService,
  ) {}

  private templatePath(fileName: string) {
    return [
      join(__dirname, 'templates', fileName),
      join(process.cwd(), 'dist', 'modules', 'render', 'templates', fileName),
      join(process.cwd(), 'src', 'modules', 'render', 'templates', fileName),
    ];
  }

  private async loadTemplate(fileName: string): Promise<string> {
    let lastError: unknown = null;
    for (const candidate of this.templatePath(fileName)) {
      try {
        return await readFile(candidate, 'utf8');
      } catch (error) {
        lastError = error;
      }
    }
    throw new InternalServerErrorException(
      `Failed to load render template "${fileName}": ${String(lastError)}`,
    );
  }

  private escapeHtml(value: string | number | null | undefined): string {
    return `${value ?? ''}`
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private renderTemplate(
    template: string,
    variables: Record<string, string>,
  ): string {
    let html = template;
    for (const [key, value] of Object.entries(variables)) {
      html = html.replaceAll(`{{${key}}}`, value);
    }
    return html;
  }

  private async resolveBranding(params: {
    actor: AuthUser;
    organizationId?: string | null;
    matchId?: string | null;
  }): Promise<TemplateBranding> {
    const branding = await this.organizationBranding.getEffectiveBranding({
      actor: params.actor,
      organizationId: params.organizationId ?? null,
      matchId: params.matchId ?? null,
    });

    return {
      primaryColor: branding.primaryColor || DEFAULT_RENDER_PRIMARY,
      background:
        branding.backgroundCss ||
        branding.backgroundSolid ||
        DEFAULT_RENDER_BACKGROUND,
      textPrimary: branding.textPrimary || DEFAULT_RENDER_TEXT,
      textMuted: branding.textMuted || DEFAULT_RENDER_MUTED,
      panel: branding.panel || DEFAULT_RENDER_PANEL,
      border: branding.border || DEFAULT_RENDER_BORDER,
      shadow: branding.shadow || DEFAULT_RENDER_SHADOW,
      logoUrl: null,
    };
  }

  private buildMatchRows(teams: MatchTemplateInput['teams']): {
    rowsHtml: string;
    footer: string;
  } {
    const rowsHtml = teams
      .map((team) =>
        `
          <div class="row">
            <div class="row-rank">#${this.escapeHtml(team.position)}</div>
            <div class="row-main">
              <div class="row-tag">${this.escapeHtml(team.tag)}</div>
              <div class="row-meta">${this.escapeHtml(team.kills)} kills</div>
            </div>
            <div class="row-points">${this.escapeHtml(team.points)} pts</div>
          </div>
        `.trim(),
      )
      .join('\n');

    return {
      rowsHtml,
      footer: teams.length
        ? `Showing ${teams.length} teams`
        : 'No result rows yet',
    };
  }

  private buildStandingsRows(teams: StandingsTemplateInput['teams']): {
    rowsHtml: string;
    footer: string;
  } {
    const rowsHtml = teams
      .map((team) =>
        `
          <div class="row">
            <div class="row-rank">#${this.escapeHtml(team.rank)}</div>
            <div class="row-main">
              <div class="row-tag">${this.escapeHtml(team.tag)}</div>
              <div class="row-meta">Standing</div>
            </div>
            <div class="row-points">${this.escapeHtml(team.totalPoints)} pts</div>
          </div>
        `.trim(),
      )
      .join('\n');

    return {
      rowsHtml,
      footer: teams.length ? `Showing top ${teams.length}` : 'No standings yet',
    };
  }

  async buildMatchResultHtml(input: MatchTemplateInput): Promise<string> {
    const template = await this.loadTemplate('match-result.template.html');
    const logoHtml = input.branding.logoUrl
      ? `<img class="brand-logo" src="${this.escapeHtml(input.branding.logoUrl)}" alt="Brand logo" />`
      : `<div class="brand-logo brand-logo--empty"></div>`;
    const { rowsHtml, footer } = this.buildMatchRows(input.teams);

    return this.renderTemplate(template, {
      matchName: this.escapeHtml(input.matchName),
      rowsHtml,
      primaryColor: this.escapeHtml(input.branding.primaryColor),
      background: this.escapeHtml(input.branding.background),
      textPrimary: this.escapeHtml(input.branding.textPrimary),
      textMuted: this.escapeHtml(input.branding.textMuted),
      panel: this.escapeHtml(input.branding.panel),
      border: this.escapeHtml(input.branding.border),
      shadow: this.escapeHtml(input.branding.shadow),
      logoHtml,
      footer: this.escapeHtml(input.footer ?? footer),
    });
  }

  async buildStandingsHtml(input: StandingsTemplateInput): Promise<string> {
    const template = await this.loadTemplate('standings.template.html');
    const logoHtml = input.branding.logoUrl
      ? `<img class="brand-logo" src="${this.escapeHtml(input.branding.logoUrl)}" alt="Brand logo" />`
      : `<div class="brand-logo brand-logo--empty"></div>`;
    const { rowsHtml, footer } = this.buildStandingsRows(input.teams);

    return this.renderTemplate(template, {
      sessionName: this.escapeHtml(input.sessionName),
      rowsHtml,
      primaryColor: this.escapeHtml(input.branding.primaryColor),
      background: this.escapeHtml(input.branding.background),
      textPrimary: this.escapeHtml(input.branding.textPrimary),
      textMuted: this.escapeHtml(input.branding.textMuted),
      panel: this.escapeHtml(input.branding.panel),
      border: this.escapeHtml(input.branding.border),
      shadow: this.escapeHtml(input.branding.shadow),
      logoHtml,
      footer: this.escapeHtml(input.footer ?? footer),
    });
  }

  async renderHtmlToImage(html: string): Promise<Buffer> {
    const executablePath =
      process.env.PUPPETEER_EXECUTABLE_PATH?.trim() || undefined;
    const browser = await puppeteer.launch({
      headless: true,
      executablePath,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const page = await browser.newPage();
      await page.setViewport(MATCH_VIEWPORT);
      await page.setContent(html, {
        waitUntil: 'domcontentloaded',
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      const screenshot = await page.screenshot({
        type: 'png',
      });
      return Buffer.isBuffer(screenshot) ? screenshot : Buffer.from(screenshot);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new InternalServerErrorException(
        `Failed to render image: ${message}`,
      );
    } finally {
      await browser.close();
    }
  }

  async renderMatchResultImage(
    actor: AuthUser,
    matchId: string,
  ): Promise<Buffer> {
    const accessibleMatch = await this.results.ensureMatch(actor, matchId);
    const match = await this.prisma.match.findFirst({
      where: {
        id: matchId,
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        organizationId: true,
        status: true,
        slotResults: {
          where: { teamId: { not: null } },
          select: {
            wasPresentInMatch: true,
            placement: true,
            totalKills: true,
            totalPoints: true,
            points: true,
            slotNumber: true,
            team: {
              select: {
                tag: true,
                name: true,
              },
            },
          },
        },
      },
    });

    if (!match) {
      throw new NotFoundException('Match not found');
    }

    const activeTeams = match.slotResults
      .filter((slot) => isPresentInMatch(slot.wasPresentInMatch))
      .map((slot) => ({
        position: slot.placement ?? slot.slotNumber,
        tag:
          slot.team?.tag?.trim() ||
          slot.team?.name?.trim() ||
          `SLOT ${slot.slotNumber}`,
        points: slot.totalPoints ?? slot.points ?? 0,
        kills: slot.totalKills ?? 0,
      }))
      .sort((left, right) => {
        if (left.position !== right.position) {
          return left.position - right.position;
        }
        if (right.points !== left.points) {
          return right.points - left.points;
        }
        return right.kills - left.kills;
      });
    const noShowTeams = match.slotResults
      .filter((slot) => !isPresentInMatch(slot.wasPresentInMatch))
      .map(
        (slot) =>
          slot.team?.tag?.trim() ||
          slot.team?.name?.trim() ||
          `SLOT ${slot.slotNumber}`,
      );

    const branding = await this.resolveBranding({
      actor,
      organizationId: accessibleMatch.organizationId,
      matchId,
    });
    const matchName = match.name?.trim() || `Match ${match.id}`;
    const footerBase =
      match.status === MatchStatus.FINISHED ||
      match.status === MatchStatus.ENDED
        ? 'Final results'
        : 'Live results snapshot';
    const footer =
      noShowTeams.length > 0
        ? `${footerBase} • NO_SHOW: ${noShowTeams.join(', ')}`
        : footerBase;
    const html = await this.buildMatchResultHtml({
      matchName,
      teams: activeTeams,
      branding,
      footer,
    });
    return this.renderHtmlToImage(html);
  }

  async renderSessionStandingsImage(
    actor: AuthUser,
    sessionId: string,
  ): Promise<Buffer> {
    const [standings, session] = await Promise.all([
      this.sessionStandings.getStandings(sessionId, actor),
      this.prisma.session.findFirst({
        where: {
          id: sessionId,
          deletedAt: null,
        },
        select: {
          id: true,
          name: true,
          organizationId: true,
        },
      }),
    ]);

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    const branding = await this.resolveBranding({
      actor,
      organizationId: session.organizationId,
    });
    const html = await this.buildStandingsHtml({
      sessionName: session.name,
      teams: standings.teams.slice(0, STANDINGS_LIMIT).map((team) => ({
        rank: team.rank,
        tag: team.tag?.trim() || team.teamId,
        totalPoints: team.totalPoints,
      })),
      branding,
      footer:
        standings.teams.length > STANDINGS_LIMIT
          ? `Showing top ${STANDINGS_LIMIT} of ${standings.teams.length}`
          : `Showing ${standings.teams.length} teams`,
    });

    return this.renderHtmlToImage(html);
  }
}

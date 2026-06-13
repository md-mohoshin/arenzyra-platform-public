import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  LicenseStatus,
  LiveState,
  MatchStatus,
  OrganizationSubscriptionStatus,
  SessionStatus,
  TournamentStatus,
  TournamentRegistrationStatus,
} from '@prisma/client';
import * as nodemailer from 'nodemailer';
import type { AuthRequest } from '../../common/auth/auth.types';
import type { Actor } from '../../common/auth/jwt.strategy';
import { effectiveOrganizationId } from '../../common/org/org.util';
import {
  getOrganizationPlan,
  ORGANIZATION_PLAN_CATALOG,
} from '../../common/org/organization-plan.util';
import { PrismaService } from '../../db/prisma.service';
import {
  ClientPortalPaymentProofDto,
  ClientPortalSupportRequestDto,
} from './dto/client-portal-request.dto';

const SUPPORT_EMAIL =
  process.env.ARENZYRA_SUPPORT_EMAIL?.trim() ||
  process.env.APPLICATION_NOTIFY_EMAIL?.trim() ||
  process.env.APPLICATION_NOTIFICATION_EMAIL?.trim() ||
  process.env.SUPERADMIN_EMAIL?.trim() ||
  'contact@arenzyra.com';

const ADD_ONS = [
  {
    id: 'extra_discord_server',
    name: 'Extra Discord server',
    priceUsd: '12.99',
    description:
      'Additional server connection for Discord workflow and result API usage.',
  },
];

@Injectable()
export class ClientPortalService {
  private readonly logger = new Logger(ClientPortalService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getPortal(req: AuthRequest) {
    const orgId = this.requireOrganizationId(req);
    const organization = await this.prisma.organization.findFirst({
      where: { id: orgId, deletedAt: null },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        isActive: true,
        accessMode: true,
        planId: true,
        enabledGames: true,
        enabledAddOns: true,
        subscriptionStatus: true,
        trialStartedAt: true,
        trialEndsAt: true,
        paidUntil: true,
        createdAt: true,
        updatedAt: true,
        owner: { select: { id: true, name: true, email: true } },
      },
    });

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    const [
      tournamentsTotal,
      tournamentsActive,
      sessionsTotal,
      sessionsOpen,
      matchesTotal,
      matchesLive,
      teamsTotal,
      playersTotal,
      widgetsTotal,
      widgetInstancesActive,
      discordServers,
      usersTotal,
      registrationsPending,
      activeLicenses,
    ] = await this.prisma.$transaction([
      this.prisma.tournament.count({
        where: { organizationId: orgId, deletedAt: null },
      }),
      this.prisma.tournament.count({
        where: {
          organizationId: orgId,
          deletedAt: null,
          status: TournamentStatus.ACTIVE,
        },
      }),
      this.prisma.session.count({
        where: { organizationId: orgId, deletedAt: null },
      }),
      this.prisma.session.count({
        where: {
          organizationId: orgId,
          deletedAt: null,
          status: {
            in: [SessionStatus.OPEN, SessionStatus.CHECKIN, SessionStatus.LIVE],
          },
        },
      }),
      this.prisma.match.count({
        where: { organizationId: orgId, deletedAt: null },
      }),
      this.prisma.match.count({
        where: {
          organizationId: orgId,
          deletedAt: null,
          OR: [{ status: MatchStatus.LIVE }, { liveState: LiveState.LIVE }],
        },
      }),
      this.prisma.team.count({
        where: { organizationId: orgId, deletedAt: null },
      }),
      this.prisma.player.count({
        where: { organizationId: orgId, deletedAt: null },
      }),
      this.prisma.widget.count({
        where: { organizationId: orgId, deletedAt: null },
      }),
      this.prisma.widgetInstance.count({
        where: { organizationId: orgId, isActive: true },
      }),
      this.prisma.organizationDiscordGuild.count({
        where: { organizationId: orgId, enabled: true },
      }),
      this.prisma.user.count({
        where: { organizationId: orgId, deletedAt: null },
      }),
      this.prisma.tournamentRegistration.count({
        where: {
          organizationId: orgId,
          status: TournamentRegistrationStatus.PENDING,
        },
      }),
      this.prisma.license.count({
        where: {
          organizationId: orgId,
          status: LicenseStatus.ACTIVE,
          expiresAt: { gt: new Date() },
        },
      }),
    ]);

    return {
      organization: {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        status: organization.status,
        isActive: organization.isActive,
        accessMode: organization.accessMode,
        planId: organization.planId,
        enabledGames: organization.enabledGames,
        enabledAddOns: organization.enabledAddOns,
        subscriptionStatus: organization.subscriptionStatus,
        trialStartedAt: organization.trialStartedAt,
        trialEndsAt: organization.trialEndsAt,
        paidUntil: organization.paidUntil,
        createdAt: organization.createdAt,
        updatedAt: organization.updatedAt,
        owner: organization.owner ?? null,
      },
      billing: this.buildBillingSummary(organization),
      currentPlan: getOrganizationPlan(
        organization.planId,
        organization.accessMode,
      ),
      availablePlans: ORGANIZATION_PLAN_CATALOG,
      addOns: ADD_ONS,
      usage: {
        tournaments: { total: tournamentsTotal, active: tournamentsActive },
        events: { total: sessionsTotal, open: sessionsOpen },
        matches: { total: matchesTotal, live: matchesLive },
        teams: { total: teamsTotal },
        players: { total: playersTotal },
        widgets: {
          total: widgetsTotal,
          activeInstances: widgetInstancesActive,
        },
        discordServers: { total: discordServers },
        users: { total: usersTotal },
        pendingRegistrations: { total: registrationsPending },
        activeLicenses: { total: activeLicenses },
      },
      support: {
        email: SUPPORT_EMAIL,
        responseTarget: SUPPORT_EMAIL,
      },
    };
  }

  async sendSupportRequest(
    req: AuthRequest,
    dto: ClientPortalSupportRequestDto,
  ) {
    const portal = await this.getPortal(req);
    await this.sendPortalEmail({
      subject: `Arenzyra support request: ${dto.subject}`,
      heading: 'Client support request',
      actor: req.user,
      organization: portal.organization,
      rows: [
        ['Category', dto.category],
        ['Subject', dto.subject],
        ['Message', dto.message],
      ],
    });

    return { sent: true, sentAt: new Date() };
  }

  async sendPaymentProof(req: AuthRequest, dto: ClientPortalPaymentProofDto) {
    const portal = await this.getPortal(req);
    await this.sendPortalEmail({
      subject: `Arenzyra payment proof: ${portal.organization.name}`,
      heading: 'Manual payment proof',
      actor: req.user,
      organization: portal.organization,
      rows: [
        ['Amount', `${dto.amount} ${dto.currency}`],
        ['Payment method', dto.paymentMethod],
        ['Reference', dto.reference],
        ['Proof link', dto.proofUrl?.trim() || 'Not provided'],
        ['Message', dto.message],
      ],
    });

    return { sent: true, sentAt: new Date() };
  }

  private requireOrganizationId(req: AuthRequest) {
    const orgId = req.orgId ?? effectiveOrganizationId(req.user);
    if (!orgId) {
      throw new ForbiddenException('Organization context missing');
    }
    return orgId;
  }

  private buildBillingSummary(organization: {
    subscriptionStatus: OrganizationSubscriptionStatus;
    trialStartedAt: Date | null;
    trialEndsAt: Date | null;
    paidUntil: Date | null;
  }) {
    const now = Date.now();
    const paidUntilMs = organization.paidUntil?.getTime() ?? 0;
    const trialEndsAtMs = organization.trialEndsAt?.getTime() ?? 0;
    const hasPaidAccess = paidUntilMs > now;
    const trialActive =
      organization.subscriptionStatus ===
        OrganizationSubscriptionStatus.TRIALING && trialEndsAtMs > now;

    if (
      organization.subscriptionStatus === OrganizationSubscriptionStatus.ACTIVE
    ) {
      return {
        status: 'ACTIVE',
        label: 'Paid active',
        description: hasPaidAccess
          ? 'Manual billing is active for this workspace.'
          : 'This workspace is active. Renewal is handled manually by Arenzyra.',
        trialDaysRemaining: null,
        nextAction: 'No action needed right now.',
      };
    }

    if (trialActive) {
      const daysRemaining = Math.max(
        1,
        Math.ceil((trialEndsAtMs - now) / (24 * 60 * 60 * 1000)),
      );
      return {
        status: 'TRIALING',
        label: `${daysRemaining} day${daysRemaining === 1 ? '' : 's'} left`,
        description:
          'Your 7-day trial is active. Send payment proof before the trial ends to continue.',
        trialDaysRemaining: daysRemaining,
        nextAction: 'Continue testing Arenzyra or submit manual payment proof.',
      };
    }

    return {
      status: 'EXPIRED',
      label: 'Action needed',
      description:
        'Trial or billing access is expired. Submit payment proof or contact Arenzyra to continue.',
      trialDaysRemaining: 0,
      nextAction: 'Contact Arenzyra billing.',
    };
  }

  private async sendPortalEmail(params: {
    subject: string;
    heading: string;
    actor: Actor & { email?: string | null };
    organization: { id: string; name: string };
    rows: Array<[string, string]>;
  }) {
    const host = process.env.SMTP_HOST?.trim();
    const user = process.env.SMTP_USER?.trim();
    const pass = process.env.SMTP_PASS?.trim();
    const to = SUPPORT_EMAIL;

    if (!host || !user || !pass || !to) {
      this.logger.warn(
        'Client portal email skipped because SMTP_HOST, SMTP_USER, SMTP_PASS, or recipient email is not configured.',
      );
      throw new ServiceUnavailableException('Support email is not configured');
    }

    const port = Number(process.env.SMTP_PORT ?? 587);
    const secure =
      process.env.SMTP_SECURE?.toLowerCase() === 'true' || port === 465;
    const from = process.env.SMTP_FROM?.trim() || `Arenzyra <${user}>`;
    const submittedAt = new Date().toISOString();

    const rows = [
      ['Organization', params.organization.name],
      ['Organization ID', params.organization.id],
      ['User', params.actor.email ?? params.actor.id],
      ['Submitted', submittedAt],
      ...params.rows,
    ];

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
    });

    await transporter.sendMail({
      from,
      to,
      subject: params.subject,
      text: rows.map(([label, value]) => `${label}: ${value}`).join('\n'),
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827">
          <h2>${escapeHtml(params.heading)}</h2>
          ${rows
            .map(
              ([label, value]) =>
                `<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`,
            )
            .join('')}
        </div>
      `,
    });
  }
}

function escapeHtml(input: string) {
  return input.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

type ApplicationNotification = {
  id: string;
  name: string;
  email: string;
  applicantName: string;
  country?: string | null;
  whatsappNumber?: string | null;
  discordUsername?: string | null;
  websiteUrl?: string | null;
  contactMessage?: string | null;
  requestedPlan?: string | null;
  requestedAddOns?: string | null;
  paymentMethod?: string | null;
  createdAt: Date;
};

@Injectable()
export class ApplicationNotificationService {
  private readonly logger = new Logger(ApplicationNotificationService.name);
  private missingConfigLogged = false;

  async notifyNewApplication(application: ApplicationNotification) {
    const host = process.env.SMTP_HOST?.trim();
    const user = process.env.SMTP_USER?.trim();
    const pass = process.env.SMTP_PASS?.trim();
    const to =
      process.env.APPLICATION_NOTIFY_EMAIL?.trim() ||
      process.env.APPLICATION_NOTIFICATION_EMAIL?.trim() ||
      process.env.SUPERADMIN_EMAIL?.trim();

    if (!host || !user || !pass || !to) {
      if (!this.missingConfigLogged) {
        this.logger.warn(
          'Application email notification skipped because SMTP_HOST, SMTP_USER, SMTP_PASS, or recipient email is not configured.',
        );
        this.missingConfigLogged = true;
      }
      return;
    }

    const port = Number(process.env.SMTP_PORT ?? 587);
    const secure =
      process.env.SMTP_SECURE?.toLowerCase() === 'true' || port === 465;
    const from = process.env.SMTP_FROM?.trim() || `Arenzyra <${user}>`;
    const webOrigin =
      process.env.WEB_APP_ORIGIN?.trim() ||
      process.env.FRONTEND_ORIGIN?.trim() ||
      'https://arenzyra.com';
    const reviewUrl = `${webOrigin.replace(/\/+$/, '')}/super-admin/applications`;

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
    });

    const requestedPlan = application.requestedPlan || 'Not selected';
    const requestedAddOns = application.requestedAddOns || 'None selected';
    const paymentMethod = application.paymentMethod || 'Manual review';
    const country = application.country || 'Not provided';
    const whatsappNumber = application.whatsappNumber || 'Not provided';
    const discordUsername = application.discordUsername || 'Not provided';
    const websiteUrl = application.websiteUrl || 'Not provided';
    const contactMessage = application.contactMessage || 'Not provided';

    await transporter.sendMail({
      from,
      to,
      subject: `New Arenzyra application: ${application.name}`,
      text: [
        `New Arenzyra application: ${application.name}`,
        '',
        `Applicant: ${application.applicantName}`,
        `Email: ${application.email}`,
        `Country: ${country}`,
        `WhatsApp: ${whatsappNumber}`,
        `Discord: ${discordUsername}`,
        `Website/social: ${websiteUrl}`,
        `Plan: ${requestedPlan}`,
        `Add-ons: ${requestedAddOns}`,
        `Payment: ${paymentMethod}`,
        `Message: ${contactMessage}`,
        `Submitted: ${application.createdAt.toISOString()}`,
        '',
        `Review: ${reviewUrl}`,
      ].join('\n'),
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827">
          <h2>New Arenzyra application</h2>
          <p><strong>Organization:</strong> ${escapeHtml(application.name)}</p>
          <p><strong>Applicant:</strong> ${escapeHtml(application.applicantName)}</p>
          <p><strong>Email:</strong> ${escapeHtml(application.email)}</p>
          <p><strong>Country:</strong> ${escapeHtml(country)}</p>
          <p><strong>WhatsApp:</strong> ${escapeHtml(whatsappNumber)}</p>
          <p><strong>Discord:</strong> ${escapeHtml(discordUsername)}</p>
          <p><strong>Website/social:</strong> ${escapeHtml(websiteUrl)}</p>
          <p><strong>Plan:</strong> ${escapeHtml(requestedPlan)}</p>
          <p><strong>Add-ons:</strong> ${escapeHtml(requestedAddOns)}</p>
          <p><strong>Payment:</strong> ${escapeHtml(paymentMethod)}</p>
          <p><strong>Message:</strong> ${escapeHtml(contactMessage)}</p>
          <p><strong>Submitted:</strong> ${application.createdAt.toISOString()}</p>
          <p><a href="${escapeHtml(reviewUrl)}">Review application</a></p>
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

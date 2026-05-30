import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from 'discord.js';
import type { TicketService } from '../services/ticket.service';

export const ticketPanelCommand = {
  data: new SlashCommandBuilder()
    .setName('ticket-panel')
    .setDescription('Post the Arenzyra support ticket panel in this channel'),
  async execute(
    interaction: ChatInputCommandInteraction,
    services: { ticketService: TicketService },
  ) {
    await services.ticketService.postTicketPanel(interaction);
  },
};

import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from 'discord.js';
import type { TicketService } from '../services/ticket.service';

export const ticketCloseCommand = {
  data: new SlashCommandBuilder()
    .setName('ticket-close')
    .setDescription('Close the current Arenzyra support ticket'),
  async execute(
    interaction: ChatInputCommandInteraction,
    services: { ticketService: TicketService },
  ) {
    await services.ticketService.closeTicket(interaction);
  },
};

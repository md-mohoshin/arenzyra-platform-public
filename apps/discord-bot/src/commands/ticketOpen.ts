import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from 'discord.js';
import {
  addTicketTypeChoices,
  type TicketService,
} from '../services/ticket.service';

export const ticketOpenCommand = {
  data: new SlashCommandBuilder()
    .setName('ticket-open')
    .setDescription('Open a private Arenzyra support ticket')
    .addStringOption((option) =>
      addTicketTypeChoices(
        option
          .setName('type')
          .setDescription('Ticket type')
          .setRequired(true),
      ),
    )
    .addStringOption((option) =>
      option
        .setName('summary')
        .setDescription('Short issue summary')
        .setMaxLength(500),
    ),
  async execute(
    interaction: ChatInputCommandInteraction,
    services: { ticketService: TicketService },
  ) {
    await services.ticketService.openTicketFromCommand(interaction);
  },
};

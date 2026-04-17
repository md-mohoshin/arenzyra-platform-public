import { io } from 'socket.io-client';

/**
 * Quick manual checker for realtime ranking events.
 * Usage:
 *   MATCH_ID=match-uuid TOKEN=jwt ts-node scripts/realtime-ranking-demo.ts
 *   MATCH_ID=match-uuid TOURNAMENT_ID=tour-uuid TOKEN=jwt ts-node scripts/realtime-ranking-demo.ts
 */

const matchId =
  process.env.MATCH_ID || process.argv[2] || process.env.npm_config_match;
const tournamentId =
  process.env.TOURNAMENT_ID ||
  process.argv[3] ||
  process.env.npm_config_tournament;
const token = process.env.TOKEN;
const baseUrl = process.env.RT_URL || 'http://localhost:3000/realtime';

if (!matchId) {
  // eslint-disable-next-line no-console
  console.error('Set MATCH_ID env or pass as argv[2]');
  process.exit(1);
}

if (!token) {
  throw new Error('REQUIRED ENV VARIABLE MISSING: TOKEN');
}

const socket = io(baseUrl, {
  auth: { token },
  query: { matchId },
  transports: ['websocket'],
});

socket.on('connect', () => {
  // eslint-disable-next-line no-console
  console.log('connected to realtime');
  if (tournamentId) {
    socket.emit('bind_tournament', { tournamentId });
  }
});

socket.on('match:live-ranking', (payload) => {
  // eslint-disable-next-line no-console
  console.log('match:live-ranking', payload);
});

socket.on('match:status-updated', (payload) => {
  // eslint-disable-next-line no-console
  console.log('match:status-updated', payload);
});

socket.on('tournament:overall-ranking', (payload) => {
  // eslint-disable-next-line no-console
  console.log('tournament:overall-ranking', payload);
});

socket.on('disconnect', (reason) => {
  // eslint-disable-next-line no-console
  console.log('disconnected', reason);
});

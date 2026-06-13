import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role, YoutubeCommentReviewStatus } from '@prisma/client';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import type { Actor } from '../../common/auth/jwt.strategy';
import { Roles } from '../../common/auth/roles.decorator';
import {
  CollectYoutubeGiveawayEntriesDto,
  CompleteYoutubeOAuthDto,
  CreateYoutubeGiveawayDto,
  DetectYoutubeLiveChatDto,
  DrawYoutubeGiveawayDto,
  ReplyToYoutubeLiveChatMessageDto,
  ReplyToYoutubeCommentDto,
  ReviewYoutubeCommentDto,
  StartYoutubeLiveChatDto,
  SyncYoutubeCommentsDto,
  UpdateYoutubeLiveChatSessionDto,
  UpdateYoutubeGiveawayDto,
  UpdateYoutubePlanDto,
  UpsertYoutubeAutomationRuleDto,
  UpsertYoutubeChallengeDto,
  UpsertYoutubeChatCommandDto,
  UpsertYoutubeChatTimerDto,
  UpsertYoutubePollDto,
  YoutubeCreatorCompetitorsQueryDto,
  YoutubeCreatorDashboardQueryDto,
  YoutubeSeoAssistDto,
} from './dto/youtube.dto';
import { YoutubeService } from './youtube.service';

@Controller('organizer/youtube')
@UseGuards(JwtAuthGuard)
@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.ORGANIZER)
export class YoutubeController {
  constructor(private readonly youtube: YoutubeService) {}

  @Get('limits')
  getLimits(@CurrentUser() user: Actor) {
    return this.youtube.getLimitsForActor(user);
  }

  @Get('oauth-url')
  getOAuthUrl(@CurrentUser() user: Actor) {
    return this.youtube.createOAuthUrl(user);
  }

  @Post('oauth-callback')
  completeOAuth(
    @CurrentUser() user: Actor,
    @Body() dto: CompleteYoutubeOAuthDto,
  ) {
    return this.youtube.completeOAuth(user, dto);
  }

  @Get('channels')
  listChannels(@CurrentUser() user: Actor) {
    return this.youtube.listChannels(user);
  }

  @Delete('channels/:channelId')
  disableChannel(
    @CurrentUser() user: Actor,
    @Param('channelId') channelId: string,
  ) {
    return this.youtube.disableChannel(user, channelId);
  }

  @Post('channels/:channelId/sync-comments')
  syncComments(
    @CurrentUser() user: Actor,
    @Param('channelId') channelId: string,
    @Body() dto: SyncYoutubeCommentsDto,
  ) {
    return this.youtube.syncComments(user, channelId, dto);
  }

  @Get('comments')
  listComments(
    @CurrentUser() user: Actor,
    @Query('channelId') channelId?: string,
    @Query('videoId') videoId?: string,
    @Query('reviewStatus') reviewStatus?: YoutubeCommentReviewStatus,
  ) {
    return this.youtube.listComments(user, {
      channelId,
      videoId,
      reviewStatus,
    });
  }

  @Patch('comments/:commentId/review')
  reviewComment(
    @CurrentUser() user: Actor,
    @Param('commentId') commentId: string,
    @Body() dto: ReviewYoutubeCommentDto,
  ) {
    return this.youtube.reviewComment(user, commentId, dto);
  }

  @Post('comments/:commentId/replies')
  replyToComment(
    @CurrentUser() user: Actor,
    @Param('commentId') commentId: string,
    @Body() dto: ReplyToYoutubeCommentDto,
  ) {
    return this.youtube.replyToComment(user, commentId, dto);
  }

  @Get('live-sessions')
  listLiveChatSessions(@CurrentUser() user: Actor) {
    return this.youtube.listLiveChatSessions(user);
  }

  @Get('live-context/matches')
  listLiveContextMatches(@CurrentUser() user: Actor) {
    return this.youtube.listLiveContextMatches(user);
  }

  @Post('live-sessions')
  startLiveChatSession(
    @CurrentUser() user: Actor,
    @Body() dto: StartYoutubeLiveChatDto,
  ) {
    return this.youtube.startLiveChatSession(user, dto);
  }

  @Post('live-sessions/detect')
  detectLiveChatSession(
    @CurrentUser() user: Actor,
    @Body() dto: DetectYoutubeLiveChatDto,
  ) {
    return this.youtube.detectLiveChatSession(user, dto);
  }

  @Patch('live-sessions/:sessionId')
  updateLiveChatSession(
    @CurrentUser() user: Actor,
    @Param('sessionId') sessionId: string,
    @Body() dto: UpdateYoutubeLiveChatSessionDto,
  ) {
    return this.youtube.updateLiveChatSession(user, sessionId, dto);
  }

  @Post('live-sessions/:sessionId/poll')
  pollLiveChatSession(
    @CurrentUser() user: Actor,
    @Param('sessionId') sessionId: string,
  ) {
    return this.youtube.pollLiveChatSession(user, sessionId);
  }

  @Get('live-sessions/:sessionId/messages')
  listLiveChatMessages(
    @CurrentUser() user: Actor,
    @Param('sessionId') sessionId: string,
  ) {
    return this.youtube.listLiveChatMessages(user, sessionId);
  }

  @Post('live-messages/:messageId/replies')
  replyToLiveChatMessage(
    @CurrentUser() user: Actor,
    @Param('messageId') messageId: string,
    @Body() dto: ReplyToYoutubeLiveChatMessageDto,
  ) {
    return this.youtube.replyToLiveChatMessage(user, messageId, dto);
  }

  @Get('creator/dashboard')
  getCreatorDashboard(
    @CurrentUser() user: Actor,
    @Query() query: YoutubeCreatorDashboardQueryDto,
  ) {
    return this.youtube.getCreatorDashboard(user, query);
  }

  @Get('creator/competitors')
  searchCreatorCompetitors(
    @CurrentUser() user: Actor,
    @Query() query: YoutubeCreatorCompetitorsQueryDto,
  ) {
    return this.youtube.searchCreatorCompetitors(user, query);
  }

  @Post('creator/seo')
  generateSeoIdeas(
    @CurrentUser() user: Actor,
    @Body() dto: YoutubeSeoAssistDto,
  ) {
    return this.youtube.generateSeoIdeas(user, dto);
  }

  @Get('automation-rules')
  listAutomationRules(@CurrentUser() user: Actor) {
    return this.youtube.listAutomationRules(user);
  }

  @Post('automation-rules')
  createAutomationRule(
    @CurrentUser() user: Actor,
    @Body() dto: UpsertYoutubeAutomationRuleDto,
  ) {
    return this.youtube.createAutomationRule(user, dto);
  }

  @Patch('automation-rules/:ruleId')
  updateAutomationRule(
    @CurrentUser() user: Actor,
    @Param('ruleId') ruleId: string,
    @Body() dto: UpsertYoutubeAutomationRuleDto,
  ) {
    return this.youtube.updateAutomationRule(user, ruleId, dto);
  }

  @Delete('automation-rules/:ruleId')
  deleteAutomationRule(
    @CurrentUser() user: Actor,
    @Param('ruleId') ruleId: string,
  ) {
    return this.youtube.deleteAutomationRule(user, ruleId);
  }

  @Get('chat-commands')
  listChatCommands(@CurrentUser() user: Actor) {
    return this.youtube.listChatCommands(user);
  }

  @Post('chat-commands')
  createChatCommand(
    @CurrentUser() user: Actor,
    @Body() dto: UpsertYoutubeChatCommandDto,
  ) {
    return this.youtube.createChatCommand(user, dto);
  }

  @Patch('chat-commands/:commandId')
  updateChatCommand(
    @CurrentUser() user: Actor,
    @Param('commandId') commandId: string,
    @Body() dto: UpsertYoutubeChatCommandDto,
  ) {
    return this.youtube.updateChatCommand(user, commandId, dto);
  }

  @Delete('chat-commands/:commandId')
  deleteChatCommand(
    @CurrentUser() user: Actor,
    @Param('commandId') commandId: string,
  ) {
    return this.youtube.deleteChatCommand(user, commandId);
  }

  @Get('chat-timers')
  listChatTimers(@CurrentUser() user: Actor) {
    return this.youtube.listChatTimers(user);
  }

  @Post('chat-timers')
  createChatTimer(
    @CurrentUser() user: Actor,
    @Body() dto: UpsertYoutubeChatTimerDto,
  ) {
    return this.youtube.createChatTimer(user, dto);
  }

  @Patch('chat-timers/:timerId')
  updateChatTimer(
    @CurrentUser() user: Actor,
    @Param('timerId') timerId: string,
    @Body() dto: UpsertYoutubeChatTimerDto,
  ) {
    return this.youtube.updateChatTimer(user, timerId, dto);
  }

  @Delete('chat-timers/:timerId')
  deleteChatTimer(
    @CurrentUser() user: Actor,
    @Param('timerId') timerId: string,
  ) {
    return this.youtube.deleteChatTimer(user, timerId);
  }

  @Get('chat-logs')
  listChatLogs(@CurrentUser() user: Actor) {
    return this.youtube.listChatLogs(user);
  }

  @Get('engagement/viewers')
  listViewerProfiles(@CurrentUser() user: Actor) {
    return this.youtube.listViewerProfiles(user);
  }

  @Get('engagement/polls')
  listPolls(@CurrentUser() user: Actor) {
    return this.youtube.listPolls(user);
  }

  @Post('engagement/polls')
  createPoll(@CurrentUser() user: Actor, @Body() dto: UpsertYoutubePollDto) {
    return this.youtube.createPoll(user, dto);
  }

  @Patch('engagement/polls/:pollId')
  updatePoll(
    @CurrentUser() user: Actor,
    @Param('pollId') pollId: string,
    @Body() dto: UpsertYoutubePollDto,
  ) {
    return this.youtube.updatePoll(user, pollId, dto);
  }

  @Delete('engagement/polls/:pollId')
  deletePoll(@CurrentUser() user: Actor, @Param('pollId') pollId: string) {
    return this.youtube.deletePoll(user, pollId);
  }

  @Get('engagement/challenges')
  listChallenges(@CurrentUser() user: Actor) {
    return this.youtube.listChallenges(user);
  }

  @Post('engagement/challenges')
  createChallenge(
    @CurrentUser() user: Actor,
    @Body() dto: UpsertYoutubeChallengeDto,
  ) {
    return this.youtube.createChallenge(user, dto);
  }

  @Patch('engagement/challenges/:challengeId')
  updateChallenge(
    @CurrentUser() user: Actor,
    @Param('challengeId') challengeId: string,
    @Body() dto: UpsertYoutubeChallengeDto,
  ) {
    return this.youtube.updateChallenge(user, challengeId, dto);
  }

  @Delete('engagement/challenges/:challengeId')
  deleteChallenge(
    @CurrentUser() user: Actor,
    @Param('challengeId') challengeId: string,
  ) {
    return this.youtube.deleteChallenge(user, challengeId);
  }

  @Get('giveaways')
  listGiveaways(@CurrentUser() user: Actor) {
    return this.youtube.listGiveaways(user);
  }

  @Post('giveaways')
  createGiveaway(
    @CurrentUser() user: Actor,
    @Body() dto: CreateYoutubeGiveawayDto,
  ) {
    return this.youtube.createGiveaway(user, dto);
  }

  @Patch('giveaways/:giveawayId')
  updateGiveaway(
    @CurrentUser() user: Actor,
    @Param('giveawayId') giveawayId: string,
    @Body() dto: UpdateYoutubeGiveawayDto,
  ) {
    return this.youtube.updateGiveaway(user, giveawayId, dto);
  }

  @Post('giveaways/:giveawayId/collect')
  collectGiveawayEntries(
    @CurrentUser() user: Actor,
    @Param('giveawayId') giveawayId: string,
    @Body() dto: CollectYoutubeGiveawayEntriesDto,
  ) {
    return this.youtube.collectGiveawayEntries(user, giveawayId, dto);
  }

  @Post('giveaways/:giveawayId/draw')
  drawGiveawayWinners(
    @CurrentUser() user: Actor,
    @Param('giveawayId') giveawayId: string,
    @Body() dto: DrawYoutubeGiveawayDto,
  ) {
    return this.youtube.drawGiveawayWinners(user, giveawayId, dto);
  }

  @Get('giveaways/:giveawayId/export')
  exportGiveaway(
    @CurrentUser() user: Actor,
    @Param('giveawayId') giveawayId: string,
  ) {
    return this.youtube.exportGiveaway(user, giveawayId);
  }
}

@Controller('super/youtube')
@UseGuards(JwtAuthGuard)
@Roles(Role.SUPER_ADMIN)
export class SuperYoutubeController {
  constructor(private readonly youtube: YoutubeService) {}

  @Get('organizations')
  listSettings(@CurrentUser() user: Actor) {
    return this.youtube.listSuperSettings(user);
  }

  @Patch('organizations/:organizationId')
  updateSettings(
    @CurrentUser() user: Actor,
    @Param('organizationId') organizationId: string,
    @Body() dto: UpdateYoutubePlanDto,
  ) {
    return this.youtube.updateSuperSettings(user, organizationId, dto);
  }
}

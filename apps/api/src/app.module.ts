import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { PlatformAdminModule } from './modules/platform-admin/platform-admin.module';
import { PlayersModule } from './modules/players/players.module';
import { TeamsModule } from './modules/teams/teams.module';
import { TournamentsModule } from './modules/tournaments/tournaments.module';
import { StagesModule } from './modules/stages/stages.module';
import { GroupsModule } from './modules/groups/groups.module';
import { MatchesModule } from './modules/matches/matches.module';
import { TournamentTeamsModule } from './modules/tournament-teams/tournament-teams.module';
import { IngestModule } from './modules/ingest/ingest.module';
import { ScoringModule } from './modules/scoring/scoring.module';
import { LiveModule } from './modules/live/live.module';
import { ProductionModule } from './modules/production/production.module';
import { AuditModule } from './modules/audit/audit.module';
import { PrismaModule } from './db/prisma.module';
import { AdminModule } from './modules/admin/admin.module';
import { OrgFeaturesModule } from './modules/features/org-features.module';
import { PcobModule } from './modules/pcob/pcob.module';
import { MapsModule } from './modules/maps/maps.module';
import { RealtimeModule as LegacyRealtimeModule } from './realtime/realtime.module';
import { RealtimeTransportModule } from './modules/realtime/realtime.module';
import { OverlayModule } from './modules/overlay/overlay.module';
import { FeedModule } from './modules/feed/feed.module';
import { ExportModule } from './modules/export/export.module';
import { ObserverModule } from './modules/observer/observer.module';
import { WebhookModule } from './modules/webhook/webhook.module';
import { MatchControlModule } from './modules/match-control/match-control.module';
import { LiveFeedModule } from './modules/live-feed/live-feed.module';
import { LiveSyncModule } from './modules/live-sync/live-sync.module';
import { ResultsModule } from './modules/results/results.module';
import { MediaModule } from './modules/media/media.module';
import { GamesModule } from './modules/games/games.module';
import { AdaptersModule } from './modules/adapters/adapters.module';
import { ScoreboardModule } from './modules/scoreboard/scoreboard.module';
import { RulesetsModule } from './modules/rulesets/rulesets.module';
import { GameAdaptersModule } from './modules/game-adapters/game-adapters.module';
import { WidgetsModule } from './modules/widgets/widgets.module';
import { OrganizationBrandingModule } from './modules/organization-branding/organization-branding.module';
import { OrganizationDiscordModule } from './modules/organization-discord/organization-discord.module';
import { VisualAssetsModule } from './modules/visual-assets/visual-assets.module';
import { OrganizationFeatureModule } from './modules/organization-feature/organization-feature.module';
import { SuperModule } from './modules/super/super.module';
import { StandingsModule } from './modules/standings/standings.module';
import { BroadcastModule } from './modules/broadcast/broadcast.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { SuperAdminMiddleware } from './common/auth/super-admin.middleware';
import { OrgScopeInterceptor } from './common/org/org-scope.interceptor';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { OrgScopeModule } from './common/org/org-scope.module';
import { OrganizerTournamentsModule } from './modules/organizer-tournaments/organizer-tournaments.module';
import { TournamentSponsorsModule } from './modules/tournament-sponsors/tournament-sponsors.module';
import { EventBusModule } from './modules/event-bus/event-bus.module';
import { LauncherModule } from './modules/launcher/launcher.module';
import { TelemetryModule } from './modules/telemetry/telemetry.module';
import { SuperAdminModule } from './modules/super-admin/super-admin.module';
import { TournamentRegistrationModule } from './modules/tournament-registration/tournament-registration.module';
import { SessionsModule } from './modules/sessions/sessions.module';
import { SessionSponsorsModule } from './modules/session-sponsors/session-sponsors.module';
import { TeamBansModule } from './modules/team-bans/team-bans.module';
import { RenderModule } from './modules/render/render.module';
import { ResultBackupsModule } from './modules/result-backups/result-backups.module';
import { ControlAutoV2Module } from './modules/control-auto-v2/control-auto-v2.module';
import { AiCasterModule } from './modules/ai-caster/ai-caster.module';
import { ClientPortalModule } from './modules/client-portal/client-portal.module';
import { YoutubeModule } from './modules/youtube/youtube.module';

@Module({
  imports: [
    PrismaModule,
    EventBusModule,
    TelemetryModule,
    OrgScopeModule,
    AuthModule,
    PlatformAdminModule,
    TeamsModule,
    PlayersModule,
    TournamentsModule,
    TournamentRegistrationModule,
    SessionsModule,
    SessionSponsorsModule,
    TeamBansModule,
    RenderModule,
    ResultBackupsModule,
    ControlAutoV2Module,
    AiCasterModule,
    ClientPortalModule,
    YoutubeModule,
    StagesModule,
    GroupsModule,
    MatchesModule,
    TournamentTeamsModule,
    IngestModule,
    ScoringModule,
    LiveModule,
    ProductionModule,
    SuperModule,
    SuperAdminModule,
    AdminModule,
    OrgFeaturesModule,
    AuditModule,
    PcobModule,
    MapsModule,
    LegacyRealtimeModule,
    RealtimeTransportModule,
    OverlayModule,
    FeedModule,
    ExportModule,
    ObserverModule,
    WebhookModule,
    MatchControlModule,
    LiveFeedModule,
    LiveSyncModule,
    ResultsModule,
    MediaModule,
    GamesModule,
    AdaptersModule,
    ScoreboardModule,
    RulesetsModule,
    GameAdaptersModule,
    WidgetsModule,
    OrganizationBrandingModule,
    OrganizationDiscordModule,
    VisualAssetsModule,
    OrganizationFeatureModule,
    OrganizerTournamentsModule,
    StandingsModule,
    TournamentSponsorsModule,
    BroadcastModule,
    UploadsModule,
    LauncherModule,
  ],
  controllers: [],
  providers: [{ provide: APP_INTERCEPTOR, useClass: OrgScopeInterceptor }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(SuperAdminMiddleware).forRoutes('*');
  }
}

import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const siteSettings = sqliteTable('site_settings', {
  id: text('id').primaryKey(),
  eventName: text('event_name').notNull(),
  eventSubtitle: text('event_subtitle').notNull(),
  eventMeta: text('event_meta').notNull(),
  logoUrl: text('logo_url').notNull(),
  coBrandLogoUrl: text('co_brand_logo_url').notNull(),
  organizerLogoUrl: text('organizer_logo_url').notNull().default('/brand/logo_smansage.png'),
  sponsorsJson: text('sponsors_json').notNull().default('[]'),
  tvPin: text('tv_pin').notNull().default('4426'),
  accentColor: text('accent_color').notNull().default('#E09D17'),
  seoDescription: text('seo_description').notNull().default(''),
  socialImageUrl: text('social_image_url').notNull().default(''),
  publicDocsEnabled: integer('public_docs_enabled', { mode: 'boolean' }).notNull().default(true),
  publicTvEnabled: integer('public_tv_enabled', { mode: 'boolean' }).notNull().default(false),
  docSettingsJson: text('doc_settings_json').notNull().default('{}'),
});

export const masterCourts = sqliteTable('master_courts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  shortCode: text('short_code').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  isEnabled: integer('is_enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at').notNull(),
});

export const roles = sqliteTable('roles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  permissionsJson: text('permissions_json').notNull().default('[]'),
  isSystem: integer('is_system', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull(),
});

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull().default('panitia'),
  permissionsJson: text('permissions_json'),
  createdAt: integer('created_at').notNull(),
});

export const tournaments = sqliteTable('tournaments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  isEnabled: integer('is_enabled', { mode: 'boolean' }).notNull().default(true),
  status: text('status', { enum: ['draft', 'active', 'finished'] }).notNull().default('active'),
  format: text('format', { enum: ['knockout', 'pool_knockout'] }).notNull().default('knockout'),
  poolCount: integer('pool_count').notNull().default(4),
  advancePerPool: integer('advance_per_pool').notNull().default(2),
  bestOf: integer('best_of').notNull().default(3),
  regularSetPoints: integer('regular_set_points').notNull().default(25),
  decidingSetPoints: integer('deciding_set_points').notNull().default(15),
  useDeuce: integer('use_deuce', { mode: 'boolean' }).notNull().default(true),
  hasThirdPlace: integer('has_third_place', { mode: 'boolean' }).notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: integer('created_at').notNull(),
});

export const masterTeams = sqliteTable('master_teams', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  shortCode: text('short_code').notNull(),
  school: text('school').notNull().default(''),
  level: text('level', { enum: ['smp', 'sma', 'kab_kota', 'umum'] })
    .notNull()
    .default('umum'),
  logoUrl: text('logo_url'),
  color: text('color').notNull().default('#E09D17'),
  defaultCoachName: text('default_coach_name').notNull().default(''),
  defaultManagerName: text('default_manager_name').notNull().default(''),
  defaultJerseyColors: text('default_jersey_colors').notNull().default('[]'),
  createdAt: integer('created_at').notNull(),
});

export const teams = sqliteTable('teams', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tournamentId: integer('tournament_id')
    .notNull()
    .references(() => tournaments.id, { onDelete: 'cascade' }),
  masterTeamId: integer('master_team_id').references(() => masterTeams.id, {
    onDelete: 'set null',
  }),
  squadLabel: text('squad_label').notNull().default(''),
  isSeeded: integer('is_seeded', { mode: 'boolean' }).notNull().default(false),
  name: text('name').notNull(),
  shortCode: text('short_code').notNull(),
  school: text('school').notNull().default(''),
  logoUrl: text('logo_url'),
  color: text('color').notNull().default('#E09D17'),
  seed: integer('seed').notNull().default(0),
  poolName: text('pool_name'),
  coachName: text('coach_name').notNull().default(''),
  managerName: text('manager_name').notNull().default(''),
  jerseyColors: text('jersey_colors').notNull().default('[]'),
});

export const matches = sqliteTable('matches', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tournamentId: integer('tournament_id')
    .notNull()
    .references(() => tournaments.id, { onDelete: 'cascade' }),
  round: integer('round').notNull(),
  matchIndex: integer('match_index').notNull(),
  bracketType: text('bracket_type', { enum: ['main', 'third_place', 'pool'] })
    .notNull()
    .default('main'),
  poolName: text('pool_name'),
  stageLabel: text('stage_label'),
  teamAId: integer('team_a_id').references(() => teams.id, { onDelete: 'set null' }),
  teamBId: integer('team_b_id').references(() => teams.id, { onDelete: 'set null' }),
  winnerId: integer('winner_id').references(() => teams.id, { onDelete: 'set null' }),
  nextMatchId: integer('next_match_id'),
  nextMatchSlot: text('next_match_slot', { enum: ['A', 'B'] }),
  loserNextMatchId: integer('loser_next_match_id'),
  loserNextMatchSlot: text('loser_next_match_slot', { enum: ['A', 'B'] }),
  status: text('status', { enum: ['scheduled', 'live', 'finished', 'bye'] }).notNull().default('scheduled'),
  setsWonA: integer('sets_won_a').notNull().default(0),
  setsWonB: integer('sets_won_b').notNull().default(0),
  currentSet: integer('current_set').notNull().default(1),
  servingTeam: text('serving_team', { enum: ['A', 'B'] }),
  courtName: text('court_name').notNull().default('Court 1'),
  scheduledAt: text('scheduled_at'),
  bestOf: integer('best_of'),
  regularSetPoints: integer('regular_set_points'),
  decidingSetPoints: integer('deciding_set_points'),
  useDeuce: integer('use_deuce', { mode: 'boolean' }),
  matchCode: text('match_code'),
});

export const matchSets = sqliteTable('match_sets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  matchId: integer('match_id')
    .notNull()
    .references(() => matches.id, { onDelete: 'cascade' }),
  setNumber: integer('set_number').notNull(),
  scoreA: integer('score_a').notNull().default(0),
  scoreB: integer('score_b').notNull().default(0),
  timeoutsA: integer('timeouts_a').notNull().default(0),
  timeoutsB: integer('timeouts_b').notNull().default(0),
  subsA: integer('subs_a').notNull().default(0),
  subsB: integer('subs_b').notNull().default(0),
  isFinished: integer('is_finished', { mode: 'boolean' }).notNull().default(false),
  winnerId: integer('winner_id'),
  startedAt: integer('started_at'),
  endedAt: integer('ended_at'),
  lineupAJson: text('lineup_a_json').notNull().default('[]'),
  lineupBJson: text('lineup_b_json').notNull().default('[]'),
});

export const matchReports = sqliteTable('match_reports', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  matchId: integer('match_id')
    .notNull()
    .references(() => matches.id, { onDelete: 'cascade' }),
  uploadedBy: text('uploaded_by').notNull(),
  imagePath: text('image_path').notNull(),
  mediaJson: text('media_json').notNull().default('[]'),
  caption: text('caption').notNull().default(''),
  scoreSnapshot: text('score_snapshot').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const tvScreens = sqliteTable('tv_screens', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  mode: text('mode', {
    enum: ['single', 'split', 'bracket', 'standby', 'auto_rotate'],
  })
    .notNull()
    .default('single'),
  courtId: integer('court_id').references(() => masterCourts.id, { onDelete: 'set null' }),
  targetMatchId: integer('target_match_id').references(() => matches.id, {
    onDelete: 'set null',
  }),
  secondaryMatchId: integer('secondary_match_id').references(() => matches.id, {
    onDelete: 'set null',
  }),
  bracketTournamentId: integer('bracket_tournament_id').references(() => tournaments.id, {
    onDelete: 'set null',
  }),
  bannerPreset: text('banner_preset', {
    enum: ['tm', 'warmup', 'break', 'upcoming', 'custom'],
  })
    .notNull()
    .default('tm'),
  bannerTitle: text('banner_title').notNull().default('TECHNICAL MEETING & DRAWING'),
  bannerSubtitle: text('banner_subtitle')
    .notNull()
    .default('SMANSAGE VOLLEYBALL COMPETITION 2026'),
  bannerBadge: text('banner_badge').notNull().default('LIVE DRAWING'),
  bannerNoticeText: text('banner_notice_text').notNull().default(''),
  showClock: integer('show_clock', { mode: 'boolean' }).notNull().default(true),
  showSponsors: integer('show_sponsors', { mode: 'boolean' }).notNull().default(true),
  customBannerUrl: text('custom_banner_url'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const obsOverlays = sqliteTable('obs_overlays', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  accessToken: text('access_token').notNull(),
  layoutPreset: text('layout_preset', {
    enum: ['scorebug_corner', 'lower_third', 'match_intro', 'timeout_break', 'winner_card'],
  })
    .notNull()
    .default('lower_third'),
  themeMode: text('theme_mode', { enum: ['dark', 'light', 'glass'] })
    .notNull()
    .default('dark'),
  matchId: integer('match_id').references(() => matches.id, { onDelete: 'set null' }),
  courtName: text('court_name').notNull().default(''),
  autoFollowCourt: integer('auto_follow_court', { mode: 'boolean' }).notNull().default(true),
  showSponsorTicker: integer('show_sponsor_ticker', { mode: 'boolean' }).notNull().default(true),
  showSetHistory: integer('show_set_history', { mode: 'boolean' }).notNull().default(true),
  showTimeoutSub: integer('show_timeout_sub', { mode: 'boolean' }).notNull().default(true),
  isVisible: integer('is_visible', { mode: 'boolean' }).notNull().default(true),
  customBadgeText: text('custom_badge_text').notNull().default('LIVE BROADCAST'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const teamPlayers = sqliteTable('team_players', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  teamId: integer('team_id').references(() => teams.id, { onDelete: 'cascade' }),
  masterTeamId: integer('master_team_id').references(() => masterTeams.id, {
    onDelete: 'cascade',
  }),
  jerseyNumber: integer('jersey_number').notNull(),
  name: text('name').notNull(),
  role: text('role', { enum: ['player', 'captain', 'libero'] })
    .notNull()
    .default('player'),
  createdAt: integer('created_at').notNull(),
});

export const webhooks = sqliteTable('webhooks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  url: text('url').notNull(),
  secret: text('secret').notNull().default(''),
  platform: text('platform', { enum: ['generic', 'discord', 'telegram'] })
    .notNull()
    .default('generic'),
  eventsJson: text('events_json')
    .notNull()
    .default('["match_started","set_confirmed","match_finished"]'),
  isEnabled: integer('is_enabled', { mode: 'boolean' }).notNull().default(true),
  lastStatus: integer('last_status'),
  lastError: text('last_error'),
  lastTriggeredAt: integer('last_triggered_at'),
  createdAt: integer('created_at').notNull(),
});

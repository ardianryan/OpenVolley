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
});

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['admin', 'panitia', 'media'] }).notNull().default('panitia'),
  createdAt: integer('created_at').notNull(),
});

export const tournaments = sqliteTable('tournaments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  isEnabled: integer('is_enabled', { mode: 'boolean' }).notNull().default(true),
  status: text('status', { enum: ['draft', 'active', 'finished'] }).notNull().default('active'),
  bestOf: integer('best_of').notNull().default(3),
  regularSetPoints: integer('regular_set_points').notNull().default(25),
  decidingSetPoints: integer('deciding_set_points').notNull().default(15),
  useDeuce: integer('use_deuce', { mode: 'boolean' }).notNull().default(true),
  hasThirdPlace: integer('has_third_place', { mode: 'boolean' }).notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: integer('created_at').notNull(),
});

export const teams = sqliteTable('teams', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tournamentId: integer('tournament_id')
    .notNull()
    .references(() => tournaments.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  shortCode: text('short_code').notNull(),
  school: text('school').notNull().default(''),
  logoUrl: text('logo_url'),
  color: text('color').notNull().default('#E09D17'),
  seed: integer('seed').notNull().default(0),
});

export const matches = sqliteTable('matches', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tournamentId: integer('tournament_id')
    .notNull()
    .references(() => tournaments.id, { onDelete: 'cascade' }),
  round: integer('round').notNull(),
  matchIndex: integer('match_index').notNull(),
  bracketType: text('bracket_type', { enum: ['main', 'third_place'] }).notNull().default('main'),
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
});

export const matchSets = sqliteTable('match_sets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  matchId: integer('match_id')
    .notNull()
    .references(() => matches.id, { onDelete: 'cascade' }),
  setNumber: integer('set_number').notNull(),
  scoreA: integer('score_a').notNull().default(0),
  scoreB: integer('score_b').notNull().default(0),
  isFinished: integer('is_finished', { mode: 'boolean' }).notNull().default(false),
  winnerId: integer('winner_id'),
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

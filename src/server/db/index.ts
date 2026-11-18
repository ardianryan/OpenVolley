import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { mkdirSync } from 'node:fs';
import * as schema from './schema';

const isTest = process.env.NODE_ENV === 'test';
const dbPath = process.env.DB_PATH || (isTest ? ':memory:' : './data/openvolley.db');

if (dbPath !== ':memory:') {
  mkdirSync('./data', { recursive: true });
}

export const sqlite = new Database(dbPath);
sqlite.exec('PRAGMA journal_mode = WAL;');
sqlite.exec('PRAGMA foreign_keys = ON;');

export const db = drizzle(sqlite, { schema });

function getColumnSet(tableName: string): Set<string> {
  const cols = sqlite.query(`PRAGMA table_info('${tableName}')`).all() as Array<{ name: string }>;
  return new Set(cols.map((c) => c.name));
}

export function initDatabase() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS site_settings (
      id TEXT PRIMARY KEY,
      event_name TEXT NOT NULL,
      event_subtitle TEXT NOT NULL,
      event_meta TEXT NOT NULL,
      logo_url TEXT NOT NULL,
      co_brand_logo_url TEXT NOT NULL,
      organizer_logo_url TEXT NOT NULL DEFAULT '/brand/logo_smansage.png',
      sponsors_json TEXT NOT NULL DEFAULT '[]',
      tv_pin TEXT NOT NULL DEFAULT '4426',
      accent_color TEXT NOT NULL DEFAULT '#E09D17',
      seo_description TEXT NOT NULL DEFAULT '',
      social_image_url TEXT NOT NULL DEFAULT '',
      public_docs_enabled INTEGER NOT NULL DEFAULT 1,
      doc_settings_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'panitia',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tournaments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'active',
      format TEXT NOT NULL DEFAULT 'knockout',
      pool_count INTEGER NOT NULL DEFAULT 4,
      advance_per_pool INTEGER NOT NULL DEFAULT 2,
      best_of INTEGER NOT NULL DEFAULT 3,
      regular_set_points INTEGER NOT NULL DEFAULT 25,
      deciding_set_points INTEGER NOT NULL DEFAULT 15,
      use_deuce INTEGER NOT NULL DEFAULT 1,
      has_third_place INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      short_code TEXT NOT NULL,
      school TEXT NOT NULL DEFAULT '',
      logo_url TEXT,
      color TEXT NOT NULL DEFAULT '#E09D17',
      seed INTEGER NOT NULL DEFAULT 0,
      pool_name TEXT,
      coach_name TEXT NOT NULL DEFAULT '',
      manager_name TEXT NOT NULL DEFAULT '',
      jersey_colors TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
      round INTEGER NOT NULL,
      match_index INTEGER NOT NULL,
      bracket_type TEXT NOT NULL DEFAULT 'main',
      pool_name TEXT,
      stage_label TEXT,
      team_a_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
      team_b_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
      winner_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
      next_match_id INTEGER,
      next_match_slot TEXT,
      loser_next_match_id INTEGER,
      loser_next_match_slot TEXT,
      status TEXT NOT NULL DEFAULT 'scheduled',
      sets_won_a INTEGER NOT NULL DEFAULT 0,
      sets_won_b INTEGER NOT NULL DEFAULT 0,
      current_set INTEGER NOT NULL DEFAULT 1,
      serving_team TEXT,
      court_name TEXT NOT NULL DEFAULT 'Court 1',
      scheduled_at TEXT,
      best_of INTEGER,
      regular_set_points INTEGER,
      deciding_set_points INTEGER,
      use_deuce INTEGER
    );

    CREATE TABLE IF NOT EXISTS match_sets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
      set_number INTEGER NOT NULL,
      score_a INTEGER NOT NULL DEFAULT 0,
      score_b INTEGER NOT NULL DEFAULT 0,
      timeouts_a INTEGER NOT NULL DEFAULT 0,
      timeouts_b INTEGER NOT NULL DEFAULT 0,
      subs_a INTEGER NOT NULL DEFAULT 0,
      subs_b INTEGER NOT NULL DEFAULT 0,
      is_finished INTEGER NOT NULL DEFAULT 0,
      winner_id INTEGER
    );

    CREATE TABLE IF NOT EXISTS match_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
      uploaded_by TEXT NOT NULL,
      image_path TEXT NOT NULL,
      media_json TEXT NOT NULL DEFAULT '[]',
      caption TEXT NOT NULL DEFAULT '',
      score_snapshot TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);

  // Safe idempotent column migrations for existing databases
  const settingColNames = getColumnSet('site_settings');
  if (!settingColNames.has('organizer_logo_url')) {
    sqlite.exec("ALTER TABLE site_settings ADD COLUMN organizer_logo_url TEXT NOT NULL DEFAULT '/brand/logo_smansage.png';");
  }
  if (!settingColNames.has('sponsors_json')) {
    sqlite.exec("ALTER TABLE site_settings ADD COLUMN sponsors_json TEXT NOT NULL DEFAULT '[]';");
  }
  if (!settingColNames.has('tv_pin')) {
    sqlite.exec("ALTER TABLE site_settings ADD COLUMN tv_pin TEXT NOT NULL DEFAULT '4426';");
  }
  if (!settingColNames.has('seo_description')) {
    sqlite.exec("ALTER TABLE site_settings ADD COLUMN seo_description TEXT NOT NULL DEFAULT '';");
  }
  if (!settingColNames.has('social_image_url')) {
    sqlite.exec("ALTER TABLE site_settings ADD COLUMN social_image_url TEXT NOT NULL DEFAULT '';");
  }
  if (!settingColNames.has('public_docs_enabled')) {
    sqlite.exec('ALTER TABLE site_settings ADD COLUMN public_docs_enabled INTEGER NOT NULL DEFAULT 1;');
  }
  if (!settingColNames.has('doc_settings_json')) {
    sqlite.exec("ALTER TABLE site_settings ADD COLUMN doc_settings_json TEXT NOT NULL DEFAULT '{}';");
  }

  const tournamentColNames = getColumnSet('tournaments');
  if (!tournamentColNames.has('format')) {
    sqlite.exec("ALTER TABLE tournaments ADD COLUMN format TEXT NOT NULL DEFAULT 'knockout';");
  }
  if (!tournamentColNames.has('pool_count')) {
    sqlite.exec('ALTER TABLE tournaments ADD COLUMN pool_count INTEGER NOT NULL DEFAULT 4;');
  }
  if (!tournamentColNames.has('advance_per_pool')) {
    sqlite.exec('ALTER TABLE tournaments ADD COLUMN advance_per_pool INTEGER NOT NULL DEFAULT 2;');
  }

  const teamColNames = getColumnSet('teams');
  if (!teamColNames.has('pool_name')) {
    sqlite.exec('ALTER TABLE teams ADD COLUMN pool_name TEXT;');
  }
  if (!teamColNames.has('coach_name')) {
    sqlite.exec("ALTER TABLE teams ADD COLUMN coach_name TEXT NOT NULL DEFAULT '';");
  }
  if (!teamColNames.has('manager_name')) {
    sqlite.exec("ALTER TABLE teams ADD COLUMN manager_name TEXT NOT NULL DEFAULT '';");
  }
  if (!teamColNames.has('jersey_colors')) {
    sqlite.exec("ALTER TABLE teams ADD COLUMN jersey_colors TEXT NOT NULL DEFAULT '[]';");
  }

  const matchColNames = getColumnSet('matches');
  if (!matchColNames.has('best_of')) sqlite.exec('ALTER TABLE matches ADD COLUMN best_of INTEGER;');
  if (!matchColNames.has('regular_set_points')) sqlite.exec('ALTER TABLE matches ADD COLUMN regular_set_points INTEGER;');
  if (!matchColNames.has('deciding_set_points')) sqlite.exec('ALTER TABLE matches ADD COLUMN deciding_set_points INTEGER;');
  if (!matchColNames.has('use_deuce')) sqlite.exec('ALTER TABLE matches ADD COLUMN use_deuce INTEGER;');
  if (!matchColNames.has('pool_name')) sqlite.exec('ALTER TABLE matches ADD COLUMN pool_name TEXT;');
  if (!matchColNames.has('stage_label')) sqlite.exec('ALTER TABLE matches ADD COLUMN stage_label TEXT;');

  const setColNames = getColumnSet('match_sets');
  if (!setColNames.has('timeouts_a')) sqlite.exec('ALTER TABLE match_sets ADD COLUMN timeouts_a INTEGER NOT NULL DEFAULT 0;');
  if (!setColNames.has('timeouts_b')) sqlite.exec('ALTER TABLE match_sets ADD COLUMN timeouts_b INTEGER NOT NULL DEFAULT 0;');
  if (!setColNames.has('subs_a')) sqlite.exec('ALTER TABLE match_sets ADD COLUMN subs_a INTEGER NOT NULL DEFAULT 0;');
  if (!setColNames.has('subs_b')) sqlite.exec('ALTER TABLE match_sets ADD COLUMN subs_b INTEGER NOT NULL DEFAULT 0;');

  const reportColNames = getColumnSet('match_reports');
  if (!reportColNames.has('media_json')) {
    sqlite.exec("ALTER TABLE match_reports ADD COLUMN media_json TEXT NOT NULL DEFAULT '[]';");
  }
}

export async function seedDefaults() {
  initDatabase();

  const existingSettings = await db.query.siteSettings.findFirst();
  if (!existingSettings) {
    await db.insert(schema.siteSettings).values({
      id: 'default',
      eventName: 'Smansage Volleyball Competition',
      eventSubtitle: 'AVERSA • Dies Natalis 44 SMA Negeri 1 Gedeg',
      eventMeta: '1982 – 2026 • Mojokerto',
      logoUrl: '/brand/svc-crest-color.svg',
      coBrandLogoUrl: '/brand/aversa-standalone-color.svg',
      organizerLogoUrl: '/brand/logo_smansage.png',
      sponsorsJson: '[]',
      tvPin: '4426',
      accentColor: '#E09D17',
      seoDescription:
        'Portal Resmi Live Score, Bagan Turnamen, Buletin Resmi, dan Galeri Pertandingan Smansage Volleyball Competition (AVERSA • Dies Natalis 44 SMA Negeri 1 Gedeg).',
      socialImageUrl: '',
      publicDocsEnabled: true,
      docSettingsJson: '{}',
    });
  } else if (existingSettings.logoUrl === '/brand/svc-standalone-color.svg') {
    sqlite.exec(
      "UPDATE site_settings SET logo_url = '/brand/svc-crest-color.svg' WHERE id = 'default' AND logo_url = '/brand/svc-standalone-color.svg';"
    );
  }

  const existingAdmin = await db.query.users.findFirst();
  if (!existingAdmin) {
    const defaultAdminPass = process.env.ADMIN_DEFAULT_PASSWORD || 'admin123';
    const hash = await Bun.password.hash(defaultAdminPass);
    const now = Date.now();
    await db.insert(schema.users).values([
      {
        username: 'admin',
        name: 'Admin SVC',
        passwordHash: hash,
        role: 'admin',
        createdAt: now,
      },
      {
        username: 'panitia',
        name: 'Panitia Lapangan',
        passwordHash: await Bun.password.hash('panitia123'),
        role: 'panitia',
        createdAt: now,
      },
      {
        username: 'media',
        name: 'Tim Media AVERSA',
        passwordHash: await Bun.password.hash('media123'),
        role: 'media',
        createdAt: now,
      },
    ]);
  }

  const existingTournament = await db.query.tournaments.findFirst();
  if (!existingTournament && !isTest) {
    const now = Date.now();
    await db.insert(schema.tournaments).values([
      {
        name: 'Kategori Putra',
        slug: 'putra',
        isEnabled: true,
        status: 'active',
        format: 'knockout',
        bestOf: 3,
        regularSetPoints: 25,
        decidingSetPoints: 15,
        useDeuce: true,
        hasThirdPlace: true,
        sortOrder: 1,
        createdAt: now,
      },
      {
        name: 'Kategori Putri',
        slug: 'putri',
        isEnabled: true,
        status: 'active',
        format: 'knockout',
        bestOf: 3,
        regularSetPoints: 25,
        decidingSetPoints: 15,
        useDeuce: true,
        hasThirdPlace: true,
        sortOrder: 2,
        createdAt: now,
      },
    ]);
  }
}

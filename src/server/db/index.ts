import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import {
  inferTeamLevelFromName,
  isPlaceholderDrawSlotName,
} from '../../shared/fivb-draw';
import { DEFAULT_SYSTEM_ROLES, PERMISSION_KEYS } from '../../shared/rbac';
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
      public_tv_enabled INTEGER NOT NULL DEFAULT 0,
      doc_settings_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      permissions_json TEXT NOT NULL DEFAULT '[]',
      is_system INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'panitia',
      permissions_json TEXT,
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

    CREATE TABLE IF NOT EXISTS master_teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      short_code TEXT NOT NULL,
      school TEXT NOT NULL DEFAULT '',
      level TEXT NOT NULL DEFAULT 'umum',
      logo_url TEXT,
      color TEXT NOT NULL DEFAULT '#E09D17',
      default_coach_name TEXT NOT NULL DEFAULT '',
      default_manager_name TEXT NOT NULL DEFAULT '',
      default_jersey_colors TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
      master_team_id INTEGER REFERENCES master_teams(id) ON DELETE SET NULL,
      squad_label TEXT NOT NULL DEFAULT '',
      is_seeded INTEGER NOT NULL DEFAULT 0,
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

    CREATE TABLE IF NOT EXISTS master_courts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      short_code TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tv_screens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      mode TEXT NOT NULL DEFAULT 'single',
      court_id INTEGER REFERENCES master_courts(id) ON DELETE SET NULL,
      target_match_id INTEGER REFERENCES matches(id) ON DELETE SET NULL,
      secondary_match_id INTEGER REFERENCES matches(id) ON DELETE SET NULL,
      bracket_tournament_id INTEGER REFERENCES tournaments(id) ON DELETE SET NULL,
      banner_preset TEXT NOT NULL DEFAULT 'tm',
      banner_title TEXT NOT NULL DEFAULT 'TECHNICAL MEETING & DRAWING',
      banner_subtitle TEXT NOT NULL DEFAULT 'SMANSAGE VOLLEYBALL COMPETITION 2026',
      banner_badge TEXT NOT NULL DEFAULT 'LIVE DRAWING',
      banner_notice_text TEXT NOT NULL DEFAULT '',
      show_clock INTEGER NOT NULL DEFAULT 1,
      show_sponsors INTEGER NOT NULL DEFAULT 1,
      custom_banner_url TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS obs_overlays (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      access_token TEXT NOT NULL,
      layout_preset TEXT NOT NULL DEFAULT 'lower_third',
      theme_mode TEXT NOT NULL DEFAULT 'dark',
      match_id INTEGER REFERENCES matches(id) ON DELETE SET NULL,
      court_name TEXT NOT NULL DEFAULT '',
      auto_follow_court INTEGER NOT NULL DEFAULT 1,
      show_sponsor_ticker INTEGER NOT NULL DEFAULT 1,
      show_set_history INTEGER NOT NULL DEFAULT 1,
      show_timeout_sub INTEGER NOT NULL DEFAULT 1,
      is_visible INTEGER NOT NULL DEFAULT 1,
      custom_badge_text TEXT NOT NULL DEFAULT 'LIVE BROADCAST',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS team_players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
      master_team_id INTEGER REFERENCES master_teams(id) ON DELETE CASCADE,
      jersey_number INTEGER NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'player',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS webhooks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      secret TEXT NOT NULL DEFAULT '',
      platform TEXT NOT NULL DEFAULT 'generic',
      events_json TEXT NOT NULL DEFAULT '["match_started","set_confirmed","match_finished"]',
      is_enabled INTEGER NOT NULL DEFAULT 1,
      last_status INTEGER,
      last_error TEXT,
      last_triggered_at INTEGER,
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
  if (!settingColNames.has('public_tv_enabled')) {
    sqlite.exec('ALTER TABLE site_settings ADD COLUMN public_tv_enabled INTEGER NOT NULL DEFAULT 0;');
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
  if (!teamColNames.has('master_team_id')) {
    sqlite.exec(
      'ALTER TABLE teams ADD COLUMN master_team_id INTEGER REFERENCES master_teams(id) ON DELETE SET NULL;'
    );
  }
  if (!teamColNames.has('squad_label')) {
    sqlite.exec("ALTER TABLE teams ADD COLUMN squad_label TEXT NOT NULL DEFAULT '';");
  }
  if (!teamColNames.has('is_seeded')) {
    sqlite.exec('ALTER TABLE teams ADD COLUMN is_seeded INTEGER NOT NULL DEFAULT 0;');
  }

  const matchColNames = getColumnSet('matches');
  if (!matchColNames.has('best_of')) sqlite.exec('ALTER TABLE matches ADD COLUMN best_of INTEGER;');
  if (!matchColNames.has('regular_set_points')) sqlite.exec('ALTER TABLE matches ADD COLUMN regular_set_points INTEGER;');
  if (!matchColNames.has('deciding_set_points')) sqlite.exec('ALTER TABLE matches ADD COLUMN deciding_set_points INTEGER;');
  if (!matchColNames.has('use_deuce')) sqlite.exec('ALTER TABLE matches ADD COLUMN use_deuce INTEGER;');
  if (!matchColNames.has('pool_name')) sqlite.exec('ALTER TABLE matches ADD COLUMN pool_name TEXT;');
  if (!matchColNames.has('stage_label')) sqlite.exec('ALTER TABLE matches ADD COLUMN stage_label TEXT;');
  if (!matchColNames.has('match_code')) sqlite.exec('ALTER TABLE matches ADD COLUMN match_code TEXT;');

  const setColNames = getColumnSet('match_sets');
  if (!setColNames.has('timeouts_a')) sqlite.exec('ALTER TABLE match_sets ADD COLUMN timeouts_a INTEGER NOT NULL DEFAULT 0;');
  if (!setColNames.has('timeouts_b')) sqlite.exec('ALTER TABLE match_sets ADD COLUMN timeouts_b INTEGER NOT NULL DEFAULT 0;');
  if (!setColNames.has('subs_a')) sqlite.exec('ALTER TABLE match_sets ADD COLUMN subs_a INTEGER NOT NULL DEFAULT 0;');
  if (!setColNames.has('subs_b')) sqlite.exec('ALTER TABLE match_sets ADD COLUMN subs_b INTEGER NOT NULL DEFAULT 0;');
  if (!setColNames.has('started_at')) sqlite.exec('ALTER TABLE match_sets ADD COLUMN started_at INTEGER;');
  if (!setColNames.has('ended_at')) sqlite.exec('ALTER TABLE match_sets ADD COLUMN ended_at INTEGER;');
  if (!setColNames.has('lineup_a_json')) sqlite.exec("ALTER TABLE match_sets ADD COLUMN lineup_a_json TEXT NOT NULL DEFAULT '[]';");
  if (!setColNames.has('lineup_b_json')) sqlite.exec("ALTER TABLE match_sets ADD COLUMN lineup_b_json TEXT NOT NULL DEFAULT '[]';");

  const reportColNames = getColumnSet('match_reports');
  if (!reportColNames.has('media_json')) {
    sqlite.exec("ALTER TABLE match_reports ADD COLUMN media_json TEXT NOT NULL DEFAULT '[]';");
  }

  const userColNames = getColumnSet('users');
  if (!userColNames.has('permissions_json')) {
    sqlite.exec('ALTER TABLE users ADD COLUMN permissions_json TEXT;');
  }

  seedDefaultRoles();
  backfillMasterTeamsFromExisting();
  backfillMasterCourtsAndTvScreens();
  backfillObsOverlays();
}

function backfillObsOverlays() {
  const existing = sqlite.query('SELECT id FROM obs_overlays LIMIT 1').all();
  if (existing.length > 0) return;
  const now = Date.now();
  const token = randomBytes(12).toString('hex');
  sqlite
    .prepare(
      `INSERT INTO obs_overlays
       (name, slug, access_token, layout_preset, theme_mode, court_name, auto_follow_court, show_sponsor_ticker, show_set_history, show_timeout_sub, is_visible, custom_badge_text, created_at, updated_at)
       VALUES (?, ?, ?, 'lower_third', 'dark', '', 1, 1, 1, 1, 1, 'LIVE BROADCAST', ?, ?)`
    )
    .run('Stream Utama', 'stream-utama', token, now, now);
}

function seedDefaultRoles() {
  const now = Date.now();
  const stmt = sqlite.prepare(
    `INSERT OR IGNORE INTO roles (slug, name, description, permissions_json, is_system, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  for (const r of DEFAULT_SYSTEM_ROLES) {
    stmt.run(
      r.slug,
      r.name,
      r.description,
      JSON.stringify(r.permissions),
      r.isSystem ? 1 : 0,
      now
    );
  }
  // Keep system 'admin' role synced with all canonical permission keys on upgrade
  sqlite
    .prepare("UPDATE roles SET permissions_json = ? WHERE slug = 'admin' AND is_system = 1")
    .run(JSON.stringify([...PERMISSION_KEYS]));
}

function backfillMasterCourtsAndTvScreens() {
  const now = Date.now();

  // Ensure any court_name already used by matches exists in master_courts
  const usedCourts = sqlite
    .query("SELECT DISTINCT TRIM(court_name) AS name FROM matches WHERE TRIM(court_name) != ''")
    .all() as Array<{ name: string }>;

  const existingCourts = sqlite
    .query('SELECT id, name FROM master_courts ORDER BY sort_order ASC, id ASC')
    .all() as Array<{ id: number; name: string }>;
  const existingNames = new Set(existingCourts.map((c) => c.name.trim().toLowerCase()));

  const insertCourt = sqlite.prepare(
    'INSERT OR IGNORE INTO master_courts (name, short_code, sort_order, is_enabled, created_at) VALUES (?, ?, ?, 1, ?)'
  );

  let nextOrder = existingCourts.length + 1;
  if (existingCourts.length === 0 && usedCourts.length === 0) {
    insertCourt.run('Lapangan 1', 'LAP 1', 1, now);
    insertCourt.run('Lapangan 2', 'LAP 2', 2, now);
    existingNames.add('lapangan 1');
    existingNames.add('lapangan 2');
    nextOrder = 3;
  } else {
    for (const row of usedCourts) {
      const clean = row.name.trim();
      if (!clean || existingNames.has(clean.toLowerCase())) continue;
      const code = clean.slice(0, 8).toUpperCase();
      insertCourt.run(clean, code, nextOrder++, now);
      existingNames.add(clean.toLowerCase());
    }
    // Always guarantee at least Lapangan 2 exists if only 1 court was created
    if (existingNames.size === 1 && !existingNames.has('lapangan 2') && !existingNames.has('court 2')) {
      insertCourt.run('Lapangan 2', 'LAP 2', nextOrder++, now);
    }
  }

  // Ensure default TV screen profiles exist when tv_screens is empty
  const existingTv = sqlite.query('SELECT COUNT(*) AS cnt FROM tv_screens').get() as {
    cnt: number;
  };
  if (existingTv.cnt === 0) {
    const firstCourt = sqlite
      .query('SELECT id FROM master_courts ORDER BY sort_order ASC, id ASC LIMIT 1')
      .get() as { id: number } | null;

    const insertTv = sqlite.prepare(
      `INSERT OR IGNORE INTO tv_screens (
        name, slug, mode, court_id, banner_preset, banner_title, banner_subtitle,
        banner_badge, banner_notice_text, show_clock, show_sponsors, sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?)`
    );

    insertTv.run(
      'TV Lapangan 1',
      'lapangan-1',
      'single',
      firstCourt?.id ?? null,
      'upcoming',
      'PERTANDINGAN SEGERA DIMULAI',
      'SMANSAGE VOLLEYBALL COMPETITION 2026',
      'LAPANGAN 1',
      'Selamat datang di Arena Pertandingan • Junjung Tinggi Sportivitas',
      1,
      now,
      now
    );

    insertTv.run(
      'Proyektor Bagan TM & Lobby',
      'lobby-tm',
      'standby',
      null,
      'tm',
      'TECHNICAL MEETING & DRAWING',
      'SMANSAGE VOLLEYBALL COMPETITION 2026',
      'STANDBY TM',
      'Mohon para Manajer & Pelatih tim peserta bersiap di Ruang Technical Meeting',
      2,
      now,
      now
    );
  }
}

function backfillMasterTeamsFromExisting() {
  const unlinkedRows = sqlite
    .query(
      `SELECT id, name, short_code, school, logo_url, color, coach_name, manager_name, jersey_colors
       FROM teams
       WHERE master_team_id IS NULL
       ORDER BY id ASC`
    )
    .all() as Array<{
    id: number;
    name: string;
    short_code: string;
    school: string;
    logo_url: string | null;
    color: string;
    coach_name: string;
    manager_name: string;
    jersey_colors: string;
  }>;

  if (unlinkedRows.length === 0) return;

  const findMasterStmt = sqlite.prepare(
    `SELECT id, logo_url FROM master_teams
     WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) AND LOWER(TRIM(school)) = LOWER(TRIM(?))
     LIMIT 1`
  );
  const insertMasterStmt = sqlite.prepare(
    `INSERT INTO master_teams (
      name, short_code, school, level, logo_url, color,
      default_coach_name, default_manager_name, default_jersey_colors, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const updateMasterLogoStmt = sqlite.prepare(
    'UPDATE master_teams SET logo_url = ? WHERE id = ? AND (logo_url IS NULL OR logo_url = "")'
  );
  const linkTeamStmt = sqlite.prepare('UPDATE teams SET master_team_id = ? WHERE id = ?');

  const now = Date.now();
  for (const row of unlinkedRows) {
    if (isPlaceholderDrawSlotName(row.name)) continue;
    const existing = findMasterStmt.get(row.name, row.school || '') as {
      id: number;
      logo_url: string | null;
    } | null;

    let masterId: number;
    if (existing) {
      masterId = existing.id;
      if (!existing.logo_url && row.logo_url) {
        updateMasterLogoStmt.run(row.logo_url, masterId);
      }
    } else {
      const inferredLevel = inferTeamLevelFromName(row.name, row.school);
      const res = insertMasterStmt.run(
        row.name.trim(),
        row.short_code || 'TIM',
        (row.school || '').trim(),
        inferredLevel,
        row.logo_url,
        row.color || '#E09D17',
        row.coach_name || '',
        row.manager_name || '',
        row.jersey_colors || '[]',
        now
      );
      masterId = Number(res.lastInsertRowid);
    }

    linkTeamStmt.run(masterId, row.id);
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
      publicTvEnabled: false,
      docSettingsJson: '{}',
    });
  } else if (existingSettings.logoUrl === '/brand/svc-standalone-color.svg') {
    sqlite.exec(
      "UPDATE site_settings SET logo_url = '/brand/svc-crest-color.svg' WHERE id = 'default' AND logo_url = '/brand/svc-standalone-color.svg';"
    );
  }

  const existingAdmin = await db.query.users.findFirst();

  // Automatic S3 migration for local team logos when S3 storage is enabled
  const s3Endpoint = process.env.S3_ENDPOINT;
  const s3Bucket = process.env.S3_BUCKET;
  if (process.env.NODE_ENV !== 'test' && s3Endpoint && s3Bucket) {
    const s3Prefix = (process.env.S3_PREFIX || '').replace(/^\/+|\/+$/g, '');
    const s3PublicBase = (
      process.env.S3_PUBLIC_URL || `${s3Endpoint}/${s3Bucket}`
    ).replace(/\/+$/, '');
    const targetBase = s3Prefix
      ? `${s3PublicBase}/${s3Prefix}/logos/`
      : `${s3PublicBase}/logos/`;

    const localLogoRows = sqlite
      .query("SELECT id, logo_url FROM master_teams WHERE logo_url LIKE '/uploads/logos/%'")
      .all() as Array<{ id: number; logo_url: string }>;

    for (const row of localLogoRows) {
      const filename = row.logo_url.replace('/uploads/logos/', '');
      const newUrl = `${targetBase}${filename}`;
      sqlite.run('UPDATE master_teams SET logo_url = ? WHERE id = ?', [newUrl, row.id]);
      sqlite.run('UPDATE teams SET logo_url = ? WHERE logo_url = ?', [newUrl, row.logo_url]);
    }
  }
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

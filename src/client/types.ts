import type { MasterTeamLevel } from '../shared/fivb-draw';
import type { PermissionKey } from '../shared/rbac';

export interface SponsorItem {
  id: string;
  name: string;
  logoUrl: string;
  darkLogoUrl?: string;
  category: 'sponsor' | 'media_partner';
  boxed?: boolean;
}

export interface JerseyColorItem {
  label: string;
  hex: string;
}

export interface OfficialDocSettings {
  bulletinNumber?: string;
  bulletinEdition?: string;
  venueName?: string;
  publishedDate?: string;
  coverImageUrl?: string;
  referee1Default?: string;
  referee2Default?: string;
  committeeChair?: string;
}

export interface SiteSettings {
  id: string;
  eventName: string;
  eventSubtitle: string;
  eventMeta: string;
  logoUrl: string;
  coBrandLogoUrl: string;
  organizerLogoUrl?: string;
  sponsorsJson?: string;
  tvPin?: string;
  accentColor: string;
  seoDescription?: string;
  socialImageUrl?: string;
  publicDocsEnabled?: boolean;
  publicTvEnabled?: boolean;
  docSettingsJson?: string;
}

export interface MasterCourt {
  id: number;
  name: string;
  shortCode: string;
  sortOrder: number;
  isEnabled: boolean;
  createdAt?: number;
}

export type TvScreenMode = 'single' | 'split' | 'bracket' | 'standby' | 'auto_rotate';
export type TvBannerPreset = 'tm' | 'warmup' | 'break' | 'upcoming' | 'custom';

export interface TvScreen {
  id: number;
  name: string;
  slug: string;
  mode: TvScreenMode;
  courtId?: number | null;
  targetMatchId?: number | null;
  secondaryMatchId?: number | null;
  bracketTournamentId?: number | null;
  bannerPreset: TvBannerPreset;
  bannerTitle: string;
  bannerSubtitle: string;
  bannerBadge: string;
  bannerNoticeText: string;
  showClock: boolean;
  showSponsors: boolean;
  customBannerUrl?: string | null;
  sortOrder: number;
  createdAt?: number;
  updatedAt?: number;
}

export type ObsLayoutPreset =
  | 'scorebug_corner'
  | 'lower_third'
  | 'match_intro'
  | 'timeout_break'
  | 'winner_card'
  | 'lineup_roster'
  | 'standby_schedule';

export type ObsTransitionPreset =
  | 'broadcast_wipe'
  | 'slide_edge'
  | 'zoom_pop'
  | 'fade_smooth'
  | 'cut';

export type ObsThemeMode = 'dark' | 'light' | 'glass';

export interface ObsSceneMappingEntry {
  obsSceneName?: string;
  obsTransitionName?: string;
}

export type ObsSceneMapping = Partial<Record<ObsLayoutPreset, ObsSceneMappingEntry>>;

export interface ObsOverlay {
  id: number;
  name: string;
  slug: string;
  accessToken: string;
  layoutPreset: ObsLayoutPreset;
  transitionPreset: ObsTransitionPreset;
  themeMode: ObsThemeMode;
  matchId?: number | null;
  courtName: string;
  autoFollowCourt: boolean;
  showSponsorTicker: boolean;
  showBrandBug: boolean;
  showSetHistory: boolean;
  showTimeoutSub: boolean;
  isVisible: boolean;
  customBadgeText: string;
  sceneMappingJson: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface TeamPlayer {
  id: number;
  teamId: number | null;
  masterTeamId: number | null;
  jerseyNumber: number;
  name: string;
  role: 'player' | 'captain' | 'libero';
  createdAt?: number;
}

export interface WebhookItem {
  id: number;
  name: string;
  url: string;
  secret: string;
  hasSecret?: boolean;
  platform: 'generic' | 'discord' | 'telegram';
  eventsJson: string;
  isEnabled: boolean;
  lastStatus?: number | null;
  lastError?: string | null;
  lastTriggeredAt?: number | null;
  createdAt: number;
}

export interface AuthUser {
  id: number;
  username: string;
  name: string;
  role: string;
  roleName?: string;
  permissions?: PermissionKey[];
  customPermissions?: PermissionKey[] | null;
  hasCustomPermissions?: boolean;
}

export interface RoleDefinition {
  id: number;
  slug: string;
  name: string;
  description: string;
  permissions: PermissionKey[];
  isSystem: boolean;
  userCount?: number;
  createdAt?: number;
}

export interface Tournament {
  id: number;
  name: string;
  slug: string;
  isEnabled: boolean;
  status: 'draft' | 'active' | 'finished';
  format?: 'knockout' | 'pool_knockout';
  poolCount?: number;
  advancePerPool?: number;
  bestOf: number;
  regularSetPoints: number;
  decidingSetPoints: number;
  useDeuce: boolean;
  hasThirdPlace: boolean;
  sortOrder: number;
}

export interface MasterTeam {
  id: number;
  name: string;
  shortCode: string;
  school: string;
  level: MasterTeamLevel;
  logoUrl: string | null;
  color: string;
  defaultCoachName: string;
  defaultManagerName: string;
  defaultJerseyColors: string;
  createdAt?: number;
}

export interface Team {
  id: number;
  tournamentId: number;
  masterTeamId?: number | null;
  squadLabel?: string;
  isSeeded?: boolean;
  name: string;
  shortCode: string;
  school: string;
  logoUrl: string | null;
  color: string;
  seed: number;
  poolName?: string | null;
  coachName?: string;
  managerName?: string;
  jerseyColors?: string;
}

export interface DrawSlotBroadcastPayload {
  tournamentId: number;
  teamId: number;
  masterTeamId: number | null;
  slotNumber: number;
  poolName?: string | null;
  teamName: string;
  school: string;
  logoUrl: string | null;
  cleared?: boolean;
  timestamp: number;
}

export interface MatchSet {
  id: number;
  matchId: number;
  setNumber: number;
  scoreA: number;
  scoreB: number;
  timeoutsA?: number;
  timeoutsB?: number;
  subsA?: number;
  subsB?: number;
  isFinished: boolean;
  winnerId: number | null;
}

export interface Match {
  id: number;
  tournamentId: number;
  round: number;
  matchIndex: number;
  bracketType: 'main' | 'third_place' | 'pool';
  poolName?: string | null;
  stageLabel?: string | null;
  teamAId: number | null;
  teamBId: number | null;
  winnerId: number | null;
  nextMatchId: number | null;
  nextMatchSlot: 'A' | 'B' | null;
  loserNextMatchId: number | null;
  loserNextMatchSlot: 'A' | 'B' | null;
  status: 'scheduled' | 'live' | 'finished' | 'bye';
  setsWonA: number;
  setsWonB: number;
  currentSet: number;
  servingTeam: 'A' | 'B' | null;
  courtName: string;
  scheduledAt: string | null;
  bestOf?: number | null;
  regularSetPoints?: number | null;
  decidingSetPoints?: number | null;
  useDeuce?: boolean | null;
  matchCode?: string | null;
  sets: MatchSet[];
  undoCount?: number;
  pendingDecision?: {
    setNumber: number;
    scoreA: number;
    scoreB: number;
    leadingSide: 'A' | 'B';
    willWinMatch: boolean;
  };
}

export interface MatchReport {
  id: number;
  matchId: number;
  uploadedBy: string;
  imagePath: string;
  mediaJson?: string;
  caption: string;
  scoreSnapshot: string;
  createdAt: number;
}

export interface OverviewData {
  settings: SiteSettings;
  masterTeams?: MasterTeam[];
  masterCourts?: MasterCourt[];
  tvScreens?: TvScreen[];
  tournaments: Tournament[];
  teams: Team[];
  matches: Match[];
  reports: MatchReport[];
}

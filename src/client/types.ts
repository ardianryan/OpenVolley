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
  docSettingsJson?: string;
}

export interface AuthUser {
  id: number;
  username: string;
  name: string;
  role: 'admin' | 'panitia' | 'media';
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

export interface Team {
  id: number;
  tournamentId: number;
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
  tournaments: Tournament[];
  teams: Team[];
  matches: Match[];
  reports: MatchReport[];
}

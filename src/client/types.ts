export interface SponsorItem {
  id: string;
  name: string;
  logoUrl: string;
  darkLogoUrl?: string;
  category: 'sponsor' | 'media_partner';
  boxed?: boolean;
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
}

export interface MatchSet {
  id: number;
  matchId: number;
  setNumber: number;
  scoreA: number;
  scoreB: number;
  isFinished: boolean;
  winnerId: number | null;
}

export interface Match {
  id: number;
  tournamentId: number;
  round: number;
  matchIndex: number;
  bracketType: 'main' | 'third_place';
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

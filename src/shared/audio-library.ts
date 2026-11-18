export type AudioCategory = 'live' | 'final' | 'upcoming' | 'highlight' | 'ceremony' | 'ambient';
export type TemplateAudioTarget = 'live' | 'final' | 'upcoming' | 'highlight' | 'champion';

export interface AudioTrackMeta {
  id: string;
  title: string;
  vibe: string;
  bpm: number;
  categories: AudioCategory[];
  highStakes?: boolean;
  url: string;
}

const S3_AUDIO_BASE = 'https://is3-storage.smage.my.id/svc-media/audio';

export const AUDIO_TRACKS: AudioTrackMeta[] = [
  // LIVE MATCH POOL
  {
    id: 'above-the-net',
    title: 'Above the Net',
    vibe: 'Broadcast Electronic Trap',
    bpm: 128,
    categories: ['live'],
    url: `${S3_AUDIO_BASE}/above-the-net.mp3`,
  },
  {
    id: 'gravity-defying',
    title: 'Gravity Defying',
    vibe: 'Drum & Bass • Liquid Sport',
    bpm: 170,
    categories: ['live', 'highlight'],
    url: `${S3_AUDIO_BASE}/gravity-defying.mp3`,
  },
  {
    id: 'sudden-death',
    title: 'Sudden Death',
    vibe: 'Phonk • Sport Bass House',
    bpm: 126,
    categories: ['live'],
    url: `${S3_AUDIO_BASE}/sudden-death.mp3`,
  },
  {
    id: 'match-point',
    title: 'Match Point',
    vibe: 'Afro-Pop • Samba Sport Groove',
    bpm: 118,
    categories: ['live', 'highlight'],
    url: `${S3_AUDIO_BASE}/match-point.mp3`,
  },
  {
    id: 'the-final-possession',
    title: 'The Final Possession',
    vibe: 'Hybrid Orchestral + Hip-Hop (Clutch)',
    bpm: 92,
    categories: ['live'],
    highStakes: true,
    url: `${S3_AUDIO_BASE}/the-final-possession.mp3`,
  },

  // FINISHED SCORE / VICTORY POOL
  {
    id: 'the-final-stretch',
    title: 'The Final Stretch',
    vibe: 'Stadium Pop-Rock Victory',
    bpm: 118,
    categories: ['final'],
    url: `${S3_AUDIO_BASE}/the-final-stretch.mp3`,
  },
  {
    id: 'before-we-touch-the-sky',
    title: 'Before We Touch the Sky',
    vibe: 'Progressive House • Festival Euphoria',
    bpm: 126,
    categories: ['final'],
    url: `${S3_AUDIO_BASE}/before-we-touch-the-sky.mp3`,
  },
  {
    id: 'under-the-floodlights',
    title: 'Under the Floodlights',
    vibe: 'Indie Pop-Rock • Youth Anthem',
    bpm: 122,
    categories: ['final'],
    url: `${S3_AUDIO_BASE}/under-the-floodlights.mp3`,
  },
  {
    id: 'the-fourth-quarter-lead',
    title: 'The Fourth Quarter Lead',
    vibe: 'Brass Funk • Victory Swagger',
    bpm: 112,
    categories: ['final'],
    url: `${S3_AUDIO_BASE}/the-fourth-quarter-lead.mp3`,
  },
  {
    id: 'the-eleventh-round',
    title: 'The Eleventh Round',
    vibe: 'Cinematic Piano & Strings (Comeback)',
    bpm: 104,
    categories: ['final'],
    highStakes: true,
    url: `${S3_AUDIO_BASE}/the-eleventh-round.mp3`,
  },

  // UPCOMING MATCH POOL
  {
    id: 'before-the-siren',
    title: 'Before the Siren',
    vibe: 'Suspenseful Sport Teaser',
    bpm: 110,
    categories: ['upcoming'],
    url: `${S3_AUDIO_BASE}/before-the-siren.mp3`,
  },
  {
    id: 'before-the-final-whistle',
    title: 'Before the Final Whistle',
    vibe: 'Arena Entrance • Final Clash',
    bpm: 95,
    categories: ['upcoming'],
    highStakes: true,
    url: `${S3_AUDIO_BASE}/before-the-final-whistle.mp3`,
  },
  {
    id: 'tunnel-walk',
    title: 'Tunnel Walk',
    vibe: 'Warm-Up & Pre-Match Chill',
    bpm: 96,
    categories: ['upcoming'],
    url: `${S3_AUDIO_BASE}/tunnel-walk.mp3`,
  },

  // HIGHLIGHT POOL
  {
    id: 'the-golden-mile',
    title: 'The Golden Mile',
    vibe: 'Funk-House • Nu-Disco Rally',
    bpm: 124,
    categories: ['highlight'],
    url: `${S3_AUDIO_BASE}/the-golden-mile.mp3`,
  },
  {
    id: 'midfield-rush',
    title: 'Midfield Rush',
    vibe: 'Rhythmic Electro-Pop Groove',
    bpm: 116,
    categories: ['highlight'],
    url: `${S3_AUDIO_BASE}/midfield-rush.mp3`,
  },

  // CEREMONY & AMBIENT EXTRAS (Manual Mode)
  {
    id: 'the-golden-banner',
    title: 'The Golden Banner',
    vibe: 'Opening Ceremony • AVERSA 44',
    bpm: 122,
    categories: ['ceremony'],
    url: `${S3_AUDIO_BASE}/the-golden-banner.mp3`,
  },
  {
    id: 'the-weight-of-gold',
    title: 'The Weight of Gold',
    vibe: 'Podium & Trophy Ceremony',
    bpm: 100,
    categories: ['ceremony'],
    url: `${S3_AUDIO_BASE}/the-weight-of-gold.mp3`,
  },
  {
    id: 'twelve-o-clock-approach',
    title: 'Twelve O Clock Approach',
    vibe: 'Minimalist Portal Ambience',
    bpm: 102,
    categories: ['ambient'],
    url: `${S3_AUDIO_BASE}/twelve-o-clock-approach.mp3`,
  },
];

export function getTracksForTemplate(template: TemplateAudioTarget): AudioTrackMeta[] {
  if (template === 'champion') {
    return AUDIO_TRACKS.filter(
      (t) => t.categories.includes('ceremony') || (t.categories.includes('final') && t.highStakes)
    );
  }
  return AUDIO_TRACKS.filter((t) => t.categories.includes(template));
}

/**
 * Smart Auto-Pick: picks a random track matching the template without repeating
 * the previous track, and favors high-stakes tracks during tight/decisive matches.
 */
export function pickSmartRandomTrack(
  template: TemplateAudioTarget,
  opts?: {
    excludeId?: string | null;
    isHighStakes?: boolean;
    rng?: () => number;
  }
): AudioTrackMeta {
  const pool = getTracksForTemplate(template);
  const candidates =
    pool.length > 1 && opts?.excludeId
      ? pool.filter((t) => t.id !== opts.excludeId)
      : pool;

  const rand = opts?.rng ?? Math.random;

  if (opts?.isHighStakes) {
    const weighted = candidates.filter((t) => t.highStakes);
    if (weighted.length > 0 && rand() < 0.65) {
      return weighted[Math.floor(rand() * weighted.length)];
    }
  }

  return candidates[Math.floor(rand() * candidates.length)] ?? AUDIO_TRACKS[0];
}

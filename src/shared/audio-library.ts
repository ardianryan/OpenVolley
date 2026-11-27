export type AudioCategory = 'live' | 'final' | 'upcoming' | 'highlight' | 'ceremony' | 'ambient';
export type TemplateAudioTarget = 'live' | 'final' | 'upcoming' | 'highlight' | 'champion' | 'schedule_day';

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
  {
    id: 'ace-serve',
    title: 'Ace Serve',
    vibe: 'Cheerful Electro-Pop • Stadium Hype',
    bpm: 128,
    categories: ['live'],
    url: `${S3_AUDIO_BASE}/ace-serve.mp3`,
  },
  {
    id: 'jump-and-block',
    title: 'Jump & Block',
    vibe: 'Upbeat Future Funk • Sport House',
    bpm: 134,
    categories: ['live'],
    url: `${S3_AUDIO_BASE}/jump-and-block.mp3`,
  },
  {
    id: 'set-point-rush',
    title: 'Set Point Rush',
    vibe: 'Uplifting Big Room Sport Anthem',
    bpm: 130,
    categories: ['live'],
    highStakes: true,
    url: `${S3_AUDIO_BASE}/set-point-rush.mp3`,
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
  {
    id: 'victory-lap',
    title: 'Victory Lap',
    vibe: 'Sunny Stadium Pop-Rock Celebration',
    bpm: 124,
    categories: ['final'],
    url: `${S3_AUDIO_BASE}/victory-lap.mp3`,
  },
  {
    id: 'confetti-pop',
    title: 'Confetti Pop',
    vibe: 'Cheerful Festival Progressive House',
    bpm: 126,
    categories: ['final'],
    url: `${S3_AUDIO_BASE}/confetti-pop.mp3`,
  },
  {
    id: 'high-five-anthem',
    title: 'High Five Anthem',
    vibe: 'Feel-Good Funk-Pop Victory Groove',
    bpm: 120,
    categories: ['final'],
    url: `${S3_AUDIO_BASE}/high-five-anthem.mp3`,
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
  {
    id: 'warmup-rhythm',
    title: 'Warmup Rhythm & Spikes',
    vibe: 'Jersey Club • Fast Spike Drills',
    bpm: 130,
    categories: ['upcoming'],
    url: `${S3_AUDIO_BASE}/warmup-rhythm.mp3`,
  },
  {
    id: 'rivalry-countdown',
    title: 'Rivalry Countdown',
    vibe: 'Hybrid Cinematic Trap • Derby Clash',
    bpm: 105,
    categories: ['upcoming'],
    highStakes: true,
    url: `${S3_AUDIO_BASE}/rivalry-countdown.mp3`,
  },
  {
    id: 'morning-court-kickoff',
    title: 'Morning Court Kickoff',
    vibe: 'Nu-Disco & Funk Pop • Day Kickoff',
    bpm: 118,
    categories: ['upcoming', 'ambient'],
    url: `${S3_AUDIO_BASE}/morning-court-kickoff.mp3`,
  },
  {
    id: 'arena-pulse',
    title: 'Arena Pulse & Hype',
    vibe: 'Dark Electro Cyber Sport • Anticipation',
    bpm: 124,
    categories: ['upcoming'],
    url: `${S3_AUDIO_BASE}/arena-pulse.mp3`,
  },
  {
    id: 'locker-room-focus',
    title: 'Locker Room Focus',
    vibe: 'Lo-Fi Chill Drill • Tactical Determination',
    bpm: 92,
    categories: ['upcoming'],
    url: `${S3_AUDIO_BASE}/locker-room-focus.mp3`,
  },
  {
    id: 'court-warmup',
    title: 'Court Warmup',
    vibe: 'Upbeat Nu-Disco • Fresh Morning Kickoff',
    bpm: 122,
    categories: ['upcoming'],
    url: `${S3_AUDIO_BASE}/court-warmup.mp3`,
  },
  {
    id: 'hype-tunnel',
    title: 'Hype Tunnel',
    vibe: 'Bright Stadium Brass & March Entrance',
    bpm: 126,
    categories: ['upcoming'],
    highStakes: true,
    url: `${S3_AUDIO_BASE}/hype-tunnel.mp3`,
  },
  {
    id: 'ready-set-spike',
    title: 'Ready Set Spike',
    vibe: 'Cheerful Jersey Club • Youth Sport Dance',
    bpm: 128,
    categories: ['upcoming'],
    url: `${S3_AUDIO_BASE}/ready-set-spike.mp3`,
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
  {
    id: 'spike-montage',
    title: 'Spike Montage',
    vibe: 'High-Energy Future Bass Highlight',
    bpm: 132,
    categories: ['highlight'],
    url: `${S3_AUDIO_BASE}/spike-montage.mp3`,
  },
  {
    id: 'net-crusher',
    title: 'Net Crusher',
    vibe: 'Big Beat Sport Guitar & Breakbeat',
    bpm: 140,
    categories: ['highlight'],
    url: `${S3_AUDIO_BASE}/net-crusher.mp3`,
  },
  {
    id: 'rally-fever',
    title: 'Rally Fever',
    vibe: 'Sunny Latin-Funk House Groove',
    bpm: 125,
    categories: ['highlight'],
    url: `${S3_AUDIO_BASE}/rally-fever.mp3`,
  },
  {
    id: 'super-rally-bounce',
    title: 'Super Rally Bounce',
    vibe: 'Playful Electro-Swing • Sport Funk',
    bpm: 128,
    categories: ['highlight'],
    url: `${S3_AUDIO_BASE}/super-rally-bounce.mp3`,
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
    id: 'bracket-ascend',
    title: 'Bracket Ascend',
    vibe: 'Cinematic Broadcast • Bracket Reveal',
    bpm: 114,
    categories: ['ceremony'],
    url: `${S3_AUDIO_BASE}/bracket-ascend.mp3`,
  },
  {
    id: 'crown-of-the-court',
    title: 'Crown of the Court',
    vibe: 'Triumphant Brass • Trophy Podium',
    bpm: 108,
    categories: ['ceremony'],
    url: `${S3_AUDIO_BASE}/crown-of-the-court.mp3`,
  },
  {
    id: 'arena-opening-parade',
    title: 'Arena Opening Parade',
    vibe: 'Grand Opening Ceremony Anthem',
    bpm: 120,
    categories: ['ceremony'],
    url: `${S3_AUDIO_BASE}/arena-opening-parade.mp3`,
  },
  {
    id: 'bracket-parade',
    title: 'Bracket Parade',
    vibe: 'Bright Triumphant Bracket Showcase',
    bpm: 120,
    categories: ['ceremony'],
    url: `${S3_AUDIO_BASE}/bracket-parade.mp3`,
  },
  {
    id: 'golden-trophy-smile',
    title: 'Golden Trophy Smile',
    vibe: 'Joyful Sunny Podium Celebration',
    bpm: 118,
    categories: ['ceremony'],
    url: `${S3_AUDIO_BASE}/golden-trophy-smile.mp3`,
  },
  {
    id: 'festival-kickoff',
    title: 'Festival Kickoff',
    vibe: 'Cheerful School Sports Festival Theme',
    bpm: 124,
    categories: ['ceremony'],
    url: `${S3_AUDIO_BASE}/festival-kickoff.mp3`,
  },
  {
    id: 'twelve-o-clock-approach',
    title: 'Twelve O Clock Approach',
    vibe: 'Minimalist Portal Ambience',
    bpm: 102,
    categories: ['ambient'],
    url: `${S3_AUDIO_BASE}/twelve-o-clock-approach.mp3`,
  },
  {
    id: 'court-breeze',
    title: 'Court Breeze',
    vibe: 'Upbeat Corporate Lo-Fi Funk • Schedule',
    bpm: 112,
    categories: ['ambient'],
    url: `${S3_AUDIO_BASE}/court-breeze.mp3`,
  },
  {
    id: 'sponsor-lounge',
    title: 'Sponsor Lounge',
    vibe: 'Tropical House & Nu-Disco • Booth Promo',
    bpm: 116,
    categories: ['ambient'],
    url: `${S3_AUDIO_BASE}/sponsor-lounge.mp3`,
  },
  {
    id: 'arena-bulletin',
    title: 'Arena Bulletin',
    vibe: 'Crisp Tech-House Broadcast Ticker',
    bpm: 105,
    categories: ['ambient'],
    url: `${S3_AUDIO_BASE}/arena-bulletin.mp3`,
  },
  {
    id: 'bright-bulletin',
    title: 'Bright Bulletin',
    vibe: 'Cheerful Tech-Pop • Rules & Announcement',
    bpm: 114,
    categories: ['ambient'],
    url: `${S3_AUDIO_BASE}/bright-bulletin.mp3`,
  },
  {
    id: 'sunny-schedule',
    title: 'Sunny Schedule',
    vibe: 'Bright Pop-Funk • Daily Match Schedule',
    bpm: 116,
    categories: ['ambient'],
    url: `${S3_AUDIO_BASE}/sunny-schedule.mp3`,
  },
  {
    id: 'sponsor-party',
    title: 'Sponsor Party',
    vibe: 'Happy Steel-Drum Tropical House • Outro',
    bpm: 118,
    categories: ['ambient'],
    url: `${S3_AUDIO_BASE}/sponsor-party.mp3`,
  },
];

export function getTracksForTemplate(template: TemplateAudioTarget): AudioTrackMeta[] {
  if (template === 'champion') {
    return AUDIO_TRACKS.filter(
      (t) => t.categories.includes('ceremony') || (t.categories.includes('final') && t.highStakes)
    );
  }
  if (template === 'schedule_day') {
    return AUDIO_TRACKS.filter(
      (t) => t.categories.includes('upcoming') || t.categories.includes('ambient')
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

import { sanitizeAssetUrl, sanitizeHexColor } from '../../shared/sanitize';
import type { Team } from '../types';

interface TeamAvatarProps {
  team?: Team | null;
  size?: 'sm' | 'md' | 'lg';
}

export function TeamAvatar({ team, size = 'md' }: TeamAvatarProps) {
  const dims =
    size === 'sm'
      ? 'h-7 w-7 text-[10px]'
      : size === 'lg'
        ? 'h-12 w-12 text-sm'
        : 'h-9 w-9 text-xs';

  if (!team) {
    return (
      <div
        className={`${dims} flex shrink-0 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-100 font-bold text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400`}
      >
        TBD
      </div>
    );
  }

  const safeLogo = team.logoUrl ? sanitizeAssetUrl(team.logoUrl) : '';
  if (safeLogo) {
    return (
      <img
        src={safeLogo}
        alt={team.name}
        className={`${dims} shrink-0 rounded-lg border border-slate-200 bg-white object-contain p-0.5 dark:border-slate-700 dark:bg-slate-900`}
      />
    );
  }

  return (
    <div
      className={`${dims} flex shrink-0 items-center justify-center rounded-lg font-display font-bold tracking-wider text-white shadow-sm`}
      style={{ backgroundColor: sanitizeHexColor(team.color, '#E09D17') }}
    >
      {team.shortCode.slice(0, 4)}
    </div>
  );
}

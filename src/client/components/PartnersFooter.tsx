import { sanitizeAssetUrl } from '../../shared/sanitize';
import type { SiteSettings, SponsorItem } from '../types';

interface PartnersFooterProps {
  settings?: SiteSettings | null;
  compact?: boolean;
  hasMobileBottomNav?: boolean;
}

export function PartnersFooter({
  settings,
  compact = false,
  hasMobileBottomNav = false,
}: PartnersFooterProps) {
  const sponsorList: SponsorItem[] = (() => {
    try {
      return JSON.parse(settings?.sponsorsJson || '[]');
    } catch {
      return [];
    }
  })();

  // Unified Top-3 Principal Tier (#1..#3 largest) + Supporting Tier (#4+)
  const principalItems = sponsorList.slice(0, 3);
  const supportingItems = sponsorList.slice(3);

  const renderLogoItem = (item: SponsorItem, isPrincipal: boolean) => {
    const sizeClass = compact
      ? isPrincipal
        ? 'h-11 max-w-[190px]'
        : 'h-7 max-w-[130px]'
      : isPrincipal
        ? 'h-14 max-w-[220px] sm:h-20 sm:max-w-[260px]'
        : 'h-9 max-w-[145px] sm:h-11 sm:max-w-[170px]';

    const safeLight = sanitizeAssetUrl(item.logoUrl);
    const safeDark = sanitizeAssetUrl(item.darkLogoUrl || item.logoUrl);
    if (!safeLight) return null;

    return (
      <span key={item.id} className="inline-flex items-center">
        <img
          src={safeLight}
          alt={item.name}
          title={item.name}
          className={`${sizeClass} object-contain dark:hidden ${
            item.boxed ? 'rounded-lg bg-white p-1.5 shadow-sm' : ''
          }`}
        />
        <img
          src={safeDark || safeLight}
          alt={item.name}
          title={item.name}
          className={`hidden ${sizeClass} object-contain dark:block ${
            item.boxed && !item.darkLogoUrl
              ? 'rounded-lg bg-white p-1.5 shadow-sm'
              : ''
          }`}
        />
      </span>
    );
  };

  return (
    <footer
      className={`relative mt-auto overflow-hidden border-t border-slate-200/80 bg-white/90 backdrop-blur-md dark:border-slate-800/80 dark:bg-slate-950 ${
        compact
          ? 'py-3'
          : hasMobileBottomNav
            ? 'pt-7 pb-24 sm:py-7'
            : 'py-7'
      }`}
    >
      {!compact && (
        <img
          src="/brand/svc-spiker-official.svg"
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-2 right-4 h-36 w-36 object-contain opacity-10"
        />
      )}

      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-5 px-4 md:flex-row md:gap-6">
        {/* Organizer Identity: Stacked on mobile (Logos -> Event Text), inline on md+ */}
        <div
          className={`flex items-center ${
            compact
              ? 'flex-row gap-3.5'
              : 'w-full flex-col gap-3 text-center md:w-auto md:flex-row md:gap-4 md:text-left'
          }`}
        >
          {/* Stack 1: SMANSAGE, SVC & AVERSA Logos */}
          <div className="flex flex-wrap items-center justify-center gap-3.5 sm:gap-4">
            <img
              src={settings?.organizerLogoUrl || '/brand/logo_smansage.png'}
              alt="SMANSAGE"
              className={compact ? 'h-9 w-9 object-contain' : 'h-11 w-11 object-contain sm:h-12 sm:w-12'}
            />
            <img
              src={settings?.logoUrl || '/brand/svc-crest-color.svg'}
              alt="SVC"
              className={compact ? 'h-9 w-9 object-contain' : 'h-11 w-11 object-contain sm:h-12 sm:w-12'}
            />
            <img
              src={settings?.coBrandLogoUrl || '/brand/aversa-standalone-color.svg'}
              alt="AVERSA"
              className={
                compact
                  ? 'h-7 w-auto max-w-[110px] object-contain'
                  : 'h-8 w-auto max-w-[130px] object-contain sm:h-11 sm:max-w-[140px]'
              }
            />
          </div>

          {/* Stack 2: Event Title & Subtitle */}
          <div
            className={
              compact
                ? 'border-l border-slate-200 pl-3.5 dark:border-slate-800'
                : 'space-y-0.5 md:border-l md:border-slate-200 md:pl-4 dark:md:border-slate-800'
            }
          >
            <p className="font-display text-sm font-extrabold uppercase tracking-wider text-slate-900 dark:text-white sm:text-base">
              {settings?.eventName || 'Smansage Volleyball Competition'}
            </p>
            <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
              {settings?.eventSubtitle || 'AVERSA • Dies Natalis 44 SMA Negeri 1 Gedeg'} •{' '}
              <span className="font-semibold text-amber-800 dark:text-amber-400">
                {settings?.eventMeta || '1982 - 2026 • Mojokerto'}
              </span>
            </p>
          </div>
        </div>

        {/* Stack 3: Unified Priority-Ordered Sponsors & Media Partners (Top 3 Largest) */}
        {sponsorList.length > 0 && (
          <div
            className={`flex flex-col items-center md:items-end ${
              compact
                ? 'gap-1.5'
                : 'w-full gap-3 border-t border-slate-200/70 pt-5 dark:border-slate-800/70 md:w-auto md:border-t-0 md:pt-0'
            }`}
          >
            <span className="text-[11px] font-extrabold uppercase tracking-widest text-amber-800 dark:text-amber-400">
              Supported By &amp; Media Partner
            </span>

            <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-5 md:justify-end">
              {principalItems.map((item) => renderLogoItem(item, true))}
            </div>

            {supportingItems.length > 0 && (
              <div className="flex flex-wrap items-center justify-center gap-3.5 opacity-95 md:justify-end">
                {supportingItems.map((item) => renderLogoItem(item, false))}
              </div>
            )}
          </div>
        )}
      </div>
    </footer>
  );
}

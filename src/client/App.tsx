import { Suspense, lazy, useEffect, useState } from 'react';
import {
  isKnownSpaPath,
  normalizePathname,
  parseExplicitErrorRoute,
} from '../shared/routes';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ErrorPage } from './components/ErrorPage';
import { PublicPortal } from './pages/PublicPortal';

const ArenaTvDisplay = lazy(() =>
  import('./pages/ArenaTvDisplay').then((m) => ({ default: m.ArenaTvDisplay }))
);
const ObsOverlayDisplay = lazy(() =>
  import('./pages/ObsOverlayDisplay').then((m) => ({ default: m.ObsOverlayDisplay }))
);
const BackOffice = lazy(() =>
  import('./pages/BackOffice').then((m) => ({ default: m.BackOffice }))
);

export function App() {
  const [pathname, setPathname] = useState(() =>
    typeof window !== 'undefined' ? window.location.pathname : '/'
  );

  useEffect(() => {
    const onPop = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const cleanPath = normalizePathname(pathname);
  const explicitError = parseExplicitErrorRoute(cleanPath);

  return (
    <ErrorBoundary>
      {explicitError !== null ? (
        <ErrorPage code={explicitError} />
      ) : !isKnownSpaPath(cleanPath) ? (
        <ErrorPage code={404} />
      ) : cleanPath === '/tv' ? (
        <Suspense fallback={<div className="min-h-screen bg-[#070A12]" />}>
          <ArenaTvDisplay />
        </Suspense>
      ) : cleanPath === '/obs' ? (
        <Suspense fallback={<div className="min-h-screen bg-transparent" />}>
          <ObsOverlayDisplay />
        </Suspense>
      ) : cleanPath.startsWith('/back-office') ? (
        <Suspense fallback={<div className="min-h-screen bg-slate-50 dark:bg-slate-950" />}>
          <BackOffice />
        </Suspense>
      ) : (
        <PublicPortal />
      )}
    </ErrorBoundary>
  );
}

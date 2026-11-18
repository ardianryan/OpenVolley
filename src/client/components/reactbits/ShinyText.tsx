import type { ReactNode } from 'react';

interface ShinyTextProps {
  children: ReactNode;
  className?: string;
  speedSec?: number;
}

/**
 * ReactBits-inspired ShinyText component (https://reactbits.dev)
 * Renders text with an animated metallic specular highlight sweeping smoothly across letters.
 */
export function ShinyText({
  children,
  className = '',
  speedSec = 3.2,
}: ShinyTextProps) {
  return (
    <span
      className={`inline-block bg-clip-text text-transparent ${className}`}
      style={{
        backgroundImage:
          'linear-gradient(115deg, #F5C538 0%, #F5C538 38%, #FFFFFF 50%, #F5C538 62%, #E09D17 100%)',
        backgroundSize: '240% 100%',
        animation: `rbShinySweep ${speedSec}s linear infinite`,
      }}
    >
      <style>{`
        @keyframes rbShinySweep {
          0% { background-position: 180% 0; }
          100% { background-position: -60% 0; }
        }
      `}</style>
      {children}
    </span>
  );
}

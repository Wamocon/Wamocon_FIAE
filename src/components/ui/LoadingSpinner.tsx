'use client';

interface LoadingSpinnerProps {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

export function LoadingSpinner({
  size = 'md',
  className = '',
}: LoadingSpinnerProps) {
  const sizeMap: Record<string, number> = {
    xs: 18,
    sm: 26,
    md: 38,
    lg: 54,
    xl: 80,
  };

  const px = sizeMap[size] ?? 38;
  const isCompact = size === 'xs' || size === 'sm';

  return (
    <div
      className={`relative inline-flex items-center justify-center ${className}`}
      style={{ width: px, height: px }}
      role="status"
      aria-label="Loading"
    >
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Faint background rings */}
        <circle
          cx="50"
          cy="50"
          r="42"
          stroke="hsl(var(--accent) / 0.06)"
          strokeWidth="1.5"
        />
        {!isCompact && (
          <circle
            cx="50"
            cy="50"
            r="28"
            stroke="hsl(var(--accent) / 0.04)"
            strokeWidth="1"
          />
        )}

        {/* Outer arc – clockwise, gradient trailing glow */}
        <circle
          cx="50"
          cy="50"
          r="42"
          stroke="hsl(var(--accent))"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray="66 198"
          className="wmc-loader-arc1"
          style={{ filter: 'drop-shadow(0 0 6px hsl(var(--accent) / 0.5))' }}
        />

        {!isCompact && (
          <>
            {/* Middle arc – counter-clockwise */}
            <circle
              cx="50"
              cy="50"
              r="28"
              stroke="hsl(var(--accent) / 0.55)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray="35 141"
              className="wmc-loader-arc2"
              style={{
                filter: 'drop-shadow(0 0 4px hsl(var(--accent) / 0.3))',
              }}
            />

            {/* Inner arc – clockwise fast */}
            <circle
              cx="50"
              cy="50"
              r="16"
              stroke="hsl(var(--accent) / 0.35)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray="15 86"
              className="wmc-loader-arc3"
              style={{
                filter: 'drop-shadow(0 0 3px hsl(var(--accent) / 0.15))',
              }}
            />
          </>
        )}

        {/* Orbiting particle – outer ring */}
        <circle
          cx="50"
          cy="92"
          r="3"
          fill="hsl(var(--accent))"
          className="wmc-loader-particle1"
          style={{ filter: 'drop-shadow(0 0 6px hsl(var(--accent) / 0.8))' }}
        />

        {!isCompact && (
          /* Orbiting particle – middle ring (reversed) */
          <circle
            cx="78"
            cy="50"
            r="2"
            fill="hsl(var(--accent) / 0.7)"
            className="wmc-loader-particle2"
            style={{ filter: 'drop-shadow(0 0 4px hsl(var(--accent) / 0.5))' }}
          />
        )}

        {/* Center pulsing core */}
        <circle
          cx="50"
          cy="50"
          r={isCompact ? 3 : 5}
          fill="hsl(var(--accent))"
          className="wmc-loader-core"
          style={{ filter: 'drop-shadow(0 0 10px hsl(var(--accent) / 0.6))' }}
        />
      </svg>

      <style>{`
        .wmc-loader-arc1 {
          transform-origin: 50px 50px;
          animation: wmc-orbit 1.8s linear infinite;
        }
        .wmc-loader-arc2 {
          transform-origin: 50px 50px;
          animation: wmc-orbit-rev 1.3s linear infinite;
        }
        .wmc-loader-arc3 {
          transform-origin: 50px 50px;
          animation: wmc-orbit 0.9s linear infinite;
        }
        .wmc-loader-particle1 {
          transform-origin: 50px 50px;
          animation: wmc-orbit 2.4s linear infinite;
        }
        .wmc-loader-particle2 {
          transform-origin: 50px 50px;
          animation: wmc-orbit-rev 1.7s linear infinite;
        }
        .wmc-loader-core {
          transform-origin: 50px 50px;
          animation: wmc-core-pulse 2s ease-in-out infinite;
        }
        @keyframes wmc-orbit {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes wmc-orbit-rev {
          from { transform: rotate(0deg); }
          to   { transform: rotate(-360deg); }
        }
        @keyframes wmc-core-pulse {
          0%, 100% { opacity: 0.35; transform: scale(0.7); }
          50%      { opacity: 1;    transform: scale(1.3); }
        }
      `}</style>
    </div>
  );
}

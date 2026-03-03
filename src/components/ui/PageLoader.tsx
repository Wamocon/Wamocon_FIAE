'use client';

import { LoadingSpinner } from './LoadingSpinner';

interface PageLoaderProps {
  /** Spinner size */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Use min-h-screen for layout-level loading */
  fullScreen?: boolean;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Centered loading spinner for page-level or section-level loading states.
 * Language-agnostic — uses only a visual spinner, no text.
 */
export function PageLoader({
  size = 'lg',
  fullScreen = false,
  className = '',
}: PageLoaderProps) {
  return (
    <div
      className={`flex items-center justify-center ${
        fullScreen ? 'bg-background min-h-screen' : 'min-h-75'
      } ${className}`}
    >
      <LoadingSpinner size={size} />
    </div>
  );
}

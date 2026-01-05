'use client';

import { useTheme } from '@/contexts/ThemeContext';
import { Sun, Moon } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ThemeToggleProps {
  variant?: 'default' | 'outline' | 'ghost' | 'icon';
  showLabel?: boolean;
  className?: string;
}

export function ThemeToggle({ variant = 'outline', showLabel = false, className = '' }: ThemeToggleProps) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  if (variant === 'icon') {
    return (
      <button
        onClick={toggleTheme}
        className={`rounded-lg p-2 transition-all duration-200 hover:bg-accent/10 ${className}`}
        aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      >
        {isDark ? (
          <Sun className="h-5 w-5 text-yellow-500" />
        ) : (
          <Moon className="h-5 w-5 text-slate-700" />
        )}
      </button>
    );
  }

  return (
    <Button
      onClick={toggleTheme}
      variant={variant}
      className={`flex items-center gap-2 border-red-600 text-red-600 hover:bg-red-600 hover:text-foreground dark:border-red-500 dark:text-red-500 dark:hover:bg-red-500 ${className}`}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {isDark ? (
        <Sun className="h-4 w-4" />
      ) : (
        <Moon className="h-4 w-4" />
      )}
      {showLabel && (
        <span className="hidden sm:inline">
          {isDark ? 'Light' : 'Dark'}
        </span>
      )}
    </Button>
  );
}

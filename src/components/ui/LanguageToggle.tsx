'use client';

import { useLanguage } from '@/contexts/LanguageContext';
import { Languages } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface LanguageToggleProps {
  variant?: 'default' | 'outline' | 'ghost' | 'icon';
  showLabel?: boolean;
  className?: string;
}

export function LanguageToggle({ variant = 'outline', showLabel = false, className = '' }: LanguageToggleProps) {
  const { language, setLanguage, t } = useLanguage();
  const isGerman = language === 'de';

  const toggleLanguage = () => {
    setLanguage(isGerman ? 'en' : 'de');
  };

  const switchLabel = isGerman ? t('common.switchToEnglish') : t('common.switchToGerman');

  if (variant === 'icon') {
    return (
      <button
        onClick={toggleLanguage}
        className={`rounded-lg p-2 transition-all duration-200 hover:bg-accent/10 ${className}`}
        aria-label={switchLabel}
        title={switchLabel}
      >
        <div className="relative">
          <Languages className="h-5 w-5 text-muted-foreground" />
          <span className="absolute -bottom-0.5 -right-0.5 text-[10px] font-bold text-accent">
            {language.toUpperCase()}
          </span>
        </div>
      </button>
    );
  }

  return (
    <Button
      onClick={toggleLanguage}
      variant={variant}
      className={`flex items-center gap-2 ${className}`}
      aria-label={switchLabel}
    >
      <Languages className="h-4 w-4" />
      {showLabel && (
        <span className="hidden sm:inline">
          {isGerman ? 'EN' : 'DE'}
        </span>
      )}
    </Button>
  );
}

'use client';

import { useLanguage } from '@/contexts/LanguageContext';
import { Languages } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface LanguageToggleProps {
  variant?: 'default' | 'outline' | 'ghost' | 'icon';
  showLabel?: boolean;
  className?: string;
}

export function LanguageToggle({
  variant = 'outline',
  showLabel = false,
  className = '',
}: LanguageToggleProps) {
  const { language, setLanguage, t } = useLanguage();
  const isGerman = language === 'de';

  const toggleLanguage = () => {
    setLanguage(isGerman ? 'en' : 'de');
  };

  const switchLabel = isGerman
    ? t('common.switchToEnglish')
    : t('common.switchToGerman');

  if (variant === 'icon') {
    return (
      <button
        onClick={toggleLanguage}
        className={`hover:bg-accent/10 flex items-center gap-1 rounded-lg p-2 transition-all duration-200 ${className}`}
        aria-label={switchLabel}
        title={switchLabel}
      >
        <Languages className="text-muted-foreground h-5 w-5" />
        <span className="text-foreground/80 text-xs font-semibold">
          {language.toUpperCase()}
        </span>
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
        <span className="hidden sm:inline">{isGerman ? 'EN' : 'DE'}</span>
      )}
    </Button>
  );
}

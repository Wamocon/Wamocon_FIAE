'use client';

import Link from 'next/link';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { LanguageToggle } from '@/components/ui/LanguageToggle';
import { CatalogSelection } from '@/components/catalog/CatalogSelection';
import { useLanguage } from '@/contexts/LanguageContext';

// Public selection of the training occupations before the login.
export default function AusbildungPage() {
  const { t } = useLanguage();
  return (
    <div className="bg-background relative min-h-screen p-4">
      <div className="absolute top-4 right-4 z-20 flex items-center gap-2">
        <LanguageToggle variant="icon" />
        <ThemeToggle variant="icon" />
      </div>
      <main className="mx-auto max-w-5xl py-20">
        <h1 className="text-foreground mb-2 text-3xl font-bold">
          {t('catalogs.title')}
        </h1>
        <p className="text-muted-foreground mb-8 max-w-2xl text-sm">
          {t('catalogs.subtitle')}
        </p>
        <CatalogSelection />
        <Link href="/" className="mt-10 inline-block text-sm underline">
          {t('catalogs.backHome')}
        </Link>
      </main>
    </div>
  );
}

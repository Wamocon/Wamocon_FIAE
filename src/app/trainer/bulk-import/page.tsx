'use client';

import { useLanguage } from '@/contexts/LanguageContext';
import { BulkImportUploader } from '@/components/trainer/BulkImportUploader';

export default function BulkImportPage() {
  const { t } = useLanguage();

  return (
    <div className="bg-background min-h-full p-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6">
          <h1 className="text-foreground mb-2 text-3xl font-bold">
            {t('bulk.title')}
          </h1>
          <p className="text-muted-foreground">
            {t('bulk.description')}
          </p>
        </div>

        <BulkImportUploader />
      </div>
    </div>
  );
}

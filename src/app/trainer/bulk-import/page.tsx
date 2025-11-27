'use client';

import { BulkImportUploader } from '@/components/trainer/BulkImportUploader';

export default function BulkImportPage() {
  return (
    <div className="bg-background min-h-screen p-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6">
          <h1 className="text-foreground mb-2 text-3xl font-bold">
            Bulk Import
          </h1>
          <p className="text-muted-foreground">
            Importieren Sie mehrere Kurse, Enabler und Use Cases gleichzeitig
          </p>
        </div>

        <BulkImportUploader />
      </div>
    </div>
  );
}

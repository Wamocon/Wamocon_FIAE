'use client';

import { AccessGate } from '@/components/admin/content-upload/AccessGate';
import { NewRunForm } from '@/components/admin/content-upload/NewRunForm';

/** A new run with its upload (docs/ki-upload-konzept.md 7.1, screen 2). */
export default function NewContentUploadPage() {
  return (
    <AccessGate>
      <NewRunForm />
    </AccessGate>
  );
}

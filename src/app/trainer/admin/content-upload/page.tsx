'use client';

import { AccessGate } from '@/components/admin/content-upload/AccessGate';
import { RunsOverview } from '@/components/admin/content-upload/RunsOverview';

/** The runs of the content upload (docs/ki-upload-konzept.md 7.1, screen 1). */
export default function ContentUploadPage() {
  return (
    <AccessGate>
      <RunsOverview />
    </AccessGate>
  );
}

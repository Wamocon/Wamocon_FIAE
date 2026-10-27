'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useLanguage } from '@/contexts/LanguageContext';
import { AccessGate } from '@/components/admin/content-upload/AccessGate';
import { ReviewView } from '@/components/admin/content-upload/ReviewView';

// What a run id looks like. Anything else is no run: it never reaches a request path
// (a link with a crafted segment must not make the browser call another route with
// the token of the person).
const RUN_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The review list of one run (docs/ki-upload-konzept.md 7.1, screens 3 to 5). */
export default function ContentUploadRunPage() {
  const { t } = useLanguage();
  const params = useParams<{ runId: string }>();
  const runId = Array.isArray(params?.runId) ? params.runId[0] : params?.runId;
  return (
    <AccessGate>
      {runId && RUN_ID.test(runId) ? (
        <ReviewView key={runId} runId={runId} />
      ) : (
        <div className="mx-auto max-w-3xl space-y-4 p-6">
          <p
            role="alert"
            className="text-foreground rounded-2xl border border-blue-500 bg-blue-500/10 p-4 text-sm"
          >
            {t('contentUpload.review.notFound')}
          </p>
          <Link
            href="/trainer/admin/content-upload"
            className="text-muted text-sm underline"
          >
            {t('contentUpload.backToRuns')}
          </Link>
        </div>
      )}
    </AccessGate>
  );
}

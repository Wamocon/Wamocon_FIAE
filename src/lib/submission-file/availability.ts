// Whether the file of a submission may be used in this deployment.
//
// The private bucket `submission-files` is created by the owner. Until the owner has
// decided on types, size and retention (docs/abgabe-datei.md), the feature follows the
// rule of the content upload: on in a Vercel preview deployment (on the Preview schema)
// and in a local, non-production run, off in Production and in every unknown
// environment. A route that is off answers 404 like a route that does not exist.

import { NextResponse } from 'next/server';
import {
  evaluateAvailability,
  type UploadAvailability,
} from '@/lib/content-upload/staging/config';
import { IS_PREVIEW_SCHEMA } from '@/lib/db-schema';

export function submissionFileAvailability(): UploadAvailability {
  return evaluateAvailability({
    vercelEnv: process.env.VERCEL_ENV,
    nodeEnv: process.env.NODE_ENV,
    previewSchema: IS_PREVIEW_SCHEMA,
  });
}

export const isSubmissionFileEnabled = (): boolean =>
  submissionFileAvailability().enabled;

/** 404 for a deployment where the feature is off, null when it may run. */
export function submissionFileDisabledResponse(): NextResponse | null {
  return isSubmissionFileEnabled()
    ? null
    : NextResponse.json(
        {
          error:
            'The file of a submission is not available in this environment.',
        },
        { status: 404 }
      );
}

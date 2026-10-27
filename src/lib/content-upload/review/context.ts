// What the routes of the review run on: the staging services plus the review
// repository over the database of the app. Created on first use, so loading a
// route never needs a connection. Tests replace this module with the in-memory
// versions.

import db from '@/db';
import { PgReviewRepo } from '@/lib/content-upload/review/repo-pg';
import type { ReviewRepo } from '@/lib/content-upload/review/repo';
import type { ReviewDeps } from '@/lib/content-upload/review/service';
import { uploadDeps } from '@/lib/content-upload/staging/context';

let repo: ReviewRepo | undefined;

export function getReviewRepo(): ReviewRepo {
  repo ??= new PgReviewRepo(db as any);
  return repo;
}

export function reviewDeps(): ReviewDeps {
  return { ...uploadDeps(), review: getReviewRepo() };
}

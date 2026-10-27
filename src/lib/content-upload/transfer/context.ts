// What the routes of the transfer run on: the pool of the app for single statements,
// reserved connections of the same pool for the engines, the staging bucket for the
// bytes and the document bucket for originals. Everything is created on first use,
// so loading a route needs no connection and no key. Tests replace this module.

import db from '@/db';
import { connectionHost } from '@/lib/content-import/apply/target';
import type { Queryable } from '@/lib/content-import/apply/pg-db';
import {
  fromPostgresJs,
  type PostgresJsLike,
} from '@/lib/content-upload/connection';
import { maxFileBytesFor } from '@/lib/content-upload/staging/config';
import { getUploadStorage } from '@/lib/content-upload/staging/context';
import { createContentBucket } from '@/lib/content-upload/transfer/content-bucket';
import type { TransferDeps } from '@/lib/content-upload/transfer/run';
import {
  PgTransferStore,
  queryableOfPool,
  type PostgresJsPool,
} from '@/lib/content-upload/transfer/store';

type PostgresClient = PostgresJsLike & PostgresJsPool;

/** The postgres-js client behind Drizzle (src/db/index.ts: prepare false, pool of 10). */
function postgresClient(): PostgresClient {
  return (db as unknown as { $client: PostgresClient }).$client;
}

/** Single statements on the pool, for the rollback text and its checks. */
export function poolQueryable(): Queryable {
  return queryableOfPool(postgresClient());
}

export function transferDeps(): TransferDeps {
  const client = postgresClient();
  return {
    store: new PgTransferStore(queryableOfPool(client)),
    connections: fromPostgresJs(client),
    readBytes: file =>
      getUploadStorage().download(file.storagePath, maxFileBytesFor(file.ext)),
    host: connectionHost(process.env.DB_CONNECTION_STRING ?? ''),
    contentBucket: () => createContentBucket(),
  };
}

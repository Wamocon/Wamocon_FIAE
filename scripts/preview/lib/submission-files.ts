/**
 * The uploaded files of the hand-ins of one trainee (bucket submission-files, folder
 * preview/<organization>/<trainee>/...). A reset removes them, because a file hangs on the
 * pair trainee and use case by its folder, not by a database row: without this a use case
 * would still show an attachment after the reset.
 *
 * Only the Preview folder of the given trainee is ever read or removed. Every path is
 * checked against that folder before a request leaves.
 */
import { BUCKET, traineeFolder } from './test-progress';

interface Entry {
  name: string;
  id: string | null;
}

export interface StorageAccess {
  url: string;
  key: string;
}

const MAX_DEPTH = 4;

async function listOnce(
  access: StorageAccess,
  prefix: string
): Promise<Entry[]> {
  const res = await fetch(`${access.url}/storage/v1/object/list/${BUCKET}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${access.key}`,
      apikey: access.key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prefix, limit: 1000, offset: 0 }),
  });
  if (!res.ok) throw new Error(`Storage list answered ${res.status}.`);
  return (await res.json()) as Entry[];
}

/** All object paths below the folder of the trainee (a folder entry has no id). */
export async function listTraineeFiles(
  access: StorageAccess,
  organizationId: string,
  traineeId: string
): Promise<string[]> {
  const root = traineeFolder(organizationId, traineeId);
  const files: string[] = [];
  const walk = async (prefix: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH)
      throw new Error('The folder is deeper than expected.');
    for (const entry of await listOnce(access, prefix)) {
      const path = `${prefix}/${entry.name}`;
      if (entry.id === null || entry.id === undefined) {
        await walk(path, depth + 1);
      } else {
        files.push(path);
      }
    }
  };
  await walk(root, 0);
  return files;
}

export async function removeTraineeFiles(
  access: StorageAccess,
  organizationId: string,
  traineeId: string,
  paths: readonly string[]
): Promise<void> {
  const root = `${traineeFolder(organizationId, traineeId)}/`;
  for (const p of paths) {
    if (!p.startsWith(root)) {
      throw new Error('A path is outside the folder of the trainee, stopped.');
    }
  }
  for (let i = 0; i < paths.length; i += 100) {
    const res = await fetch(`${access.url}/storage/v1/object/${BUCKET}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${access.key}`,
        apikey: access.key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prefixes: paths.slice(i, i + 100) }),
    });
    if (!res.ok) throw new Error(`Storage remove answered ${res.status}.`);
  }
}

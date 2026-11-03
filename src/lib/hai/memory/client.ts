/**
 * HAI memory, browser side: the calls of the chat card and of the profile section.
 *
 * Every call goes through authFetch (the bearer token of the session). The person
 * is the session, nothing here names a user. A failed call is returned as a result
 * with a stable code, never thrown, so a card or a section can say what happened.
 *
 * @module lib/hai/memory/client
 */

import { authFetch } from '@/lib/authFetch';

export type MemoryKind =
  | 'preference'
  | 'learning_style'
  | 'learning_state'
  | 'weakness';

export interface MemoryEntryDto {
  id: string;
  catalogId: string;
  kind: MemoryKind;
  source: 'stated' | 'derived';
  status: 'proposed' | 'active';
  content: string;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
}

export interface MemoryOccupationDto {
  id: string;
  code: string;
  title: string;
  entries: MemoryEntryDto[];
}

export interface MemoryOverview {
  available: boolean;
  enabled: boolean;
  occupations: MemoryOccupationDto[];
}

export type MemoryCallResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string; reason?: string };

const JSON_HEADERS = { 'Content-Type': 'application/json' };

/** Runs one request (made with authFetch by the caller) and shapes the result. */
async function call<T>(
  request: () => Promise<Response>
): Promise<MemoryCallResult<T>> {
  try {
    const response = await request();
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    if (response.ok) return { ok: true, data: body as T };
    const failure = (body ?? {}) as { code?: unknown; reason?: unknown };
    return {
      ok: false,
      status: response.status,
      code: typeof failure.code === 'string' ? failure.code : 'FAILED',
      ...(typeof failure.reason === 'string' ? { reason: failure.reason } : {}),
    };
  } catch {
    return { ok: false, status: 0, code: 'NETWORK' };
  }
}

/** The own memory, per occupation. `available: false` while the feature is off. */
export function fetchMemory(): Promise<MemoryCallResult<MemoryOverview>> {
  return call<MemoryOverview>(() =>
    authFetch('/api/hai/memory', { cache: 'no-store' })
  );
}

/** The answer to the question of the HAI: yes (with a changed text, if any) or no. */
export function decideMemory(
  id: string,
  decision: 'confirm' | 'reject',
  content?: string
): Promise<MemoryCallResult<{ entry: MemoryEntryDto }>> {
  return call(() =>
    authFetch(`/api/hai/memory/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify(
        content === undefined ? { decision } : { decision, content }
      ),
    })
  );
}

/** Changes the text of an own entry. */
export function editMemory(
  id: string,
  content: string
): Promise<MemoryCallResult<{ entry: MemoryEntryDto }>> {
  return call(() =>
    authFetch(`/api/hai/memory/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ content }),
    })
  );
}

/** Deletes one own entry. */
export function deleteMemory(
  id: string
): Promise<MemoryCallResult<{ deleted: true }>> {
  return call(() =>
    authFetch(`/api/hai/memory/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
  );
}

/** Deletes all own entries. */
export function deleteAllMemory(): Promise<
  MemoryCallResult<{ deleted: number }>
> {
  return call(() => authFetch('/api/hai/memory', { method: 'DELETE' }));
}

/** Switches the memory on or off for the person. */
export function setMemoryEnabled(
  enabled: boolean
): Promise<MemoryCallResult<{ enabled: boolean }>> {
  return call(() =>
    authFetch('/api/hai/memory', {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ enabled }),
    })
  );
}

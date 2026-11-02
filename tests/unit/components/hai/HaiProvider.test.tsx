import React from 'react';
import { act, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import {
  HaiProvider,
  actionErrorKey,
  useHai,
} from '@/components/hai/HaiProvider';
import { authFetch } from '@/lib/authFetch';

// The HAI routes take the person from the Bearer token, so the provider has to
// call them through authFetch (which adds the token) and must not send the
// user id any more. A plain fetch would answer 401 and break the HAI chat.

jest.mock('@/lib/authFetch', () => ({
  __esModule: true,
  authFetch: jest.fn(),
}));

const authFetchMock = authFetch as unknown as jest.Mock<
  (url: string, init?: RequestInit) => Promise<unknown>
>;
const plainFetch = jest.fn();

function okJson(body: unknown) {
  return { ok: true, json: async () => body };
}

/** A streaming body that ends right away (an empty answer). */
function emptyStream() {
  return {
    ok: true,
    body: {
      getReader: () => ({
        read: async () => ({ done: true, value: undefined }),
        cancel: async () => undefined,
      }),
    },
  };
}

let hai: ReturnType<typeof useHai>;
function Probe() {
  hai = useHai();
  return null;
}

function urls() {
  return authFetchMock.mock.calls.map(([url]) => String(url));
}

function callTo(path: string, method?: string) {
  return authFetchMock.mock.calls.find(
    ([url, init]) =>
      String(url).startsWith(path) &&
      (init?.method ?? 'GET') === (method ?? 'GET')
  );
}

describe('HaiProvider calls the HAI routes with the session token', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authFetchMock.mockImplementation(async url =>
      String(url).startsWith('/api/hai/chat') ? emptyStream() : okJson({})
    );
    (global as any).fetch = plainFetch;
    renderWithProviders(
      <HaiProvider userId="user-1">
        <Probe />
      </HaiProvider>
    );
  });

  it('sends the chat message (streaming) through authFetch without a userId', async () => {
    await act(async () => {
      await hai.sendMessage('Hallo HAI');
    });
    const call = callTo('/api/hai/chat', 'POST')!;
    expect(call).toBeDefined();
    expect(call[0]).toBe('/api/hai/chat');
    const init = call[1]!;
    expect(JSON.parse(String(init.body))).toMatchObject({
      message: 'Hallo HAI',
      stream: true,
    });
    expect(init.signal).toBeDefined();
    expect(plainFetch).not.toHaveBeenCalled();
  });

  it('sends no voice flag for a typed question and voice true for a spoken one', async () => {
    await act(async () => {
      await hai.sendMessage('Getippt');
      await hai.sendMessage('Gesprochen', { voice: true });
      await hai.sendMessage('Nicht wahr', { voice: false });
    });
    const bodies = authFetchMock.mock.calls
      .filter(([url]) => String(url) === '/api/hai/chat')
      .map(([, init]) => JSON.parse(String(init!.body)));
    expect(bodies).toHaveLength(3);
    expect(bodies[0]).not.toHaveProperty('voice');
    expect(bodies[1]).toMatchObject({ message: 'Gesprochen', voice: true });
    expect(bodies[2]).not.toHaveProperty('voice');
  });

  it('loads, searches, renames, deletes and opens sessions through authFetch', async () => {
    await act(async () => {
      await hai.refreshSessions();
      await hai.searchSessions('lernen');
      await hai.loadSession('s-1');
      await hai.renameSession('s-1', 'Neu');
      await hai.deleteSession('s-1');
      await hai.updateMessage('m-1', 'Text');
    });
    expect(urls()).toEqual(
      expect.arrayContaining([
        '/api/hai/session?includeArchived=true&limit=50',
        '/api/hai/session?search=lernen&limit=20',
        '/api/hai/session?sessionId=s-1',
        '/api/hai/session',
        '/api/hai/chat',
      ])
    );
    expect(callTo('/api/hai/session', 'PATCH')).toBeDefined();
    expect(callTo('/api/hai/session?sessionId=s-1', 'DELETE')).toBeDefined();
    expect(callTo('/api/hai/chat', 'PATCH')).toBeDefined();
    for (const url of urls()) expect(url).not.toMatch(/userId/);
    expect(plainFetch).not.toHaveBeenCalled();
  });

  it('refreshes the sessions on its own after mounting, with the token', async () => {
    jest.useFakeTimers();
    try {
      renderWithProviders(
        <HaiProvider userId="user-2">
          <Probe />
        </HaiProvider>
      );
      await act(async () => {
        jest.advanceTimersByTime(3500);
      });
      await waitFor(() =>
        expect(urls()).toContain(
          '/api/hai/session?includeArchived=true&limit=50'
        )
      );
      expect(plainFetch).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});

// ============================================================================
// The reason of a failed call in plain words (src/lib/hai/denial.ts): the chat
// route answers 403 or 429 with a stable code, and the person reads why instead
// of a general error. A failure of the server stays the general message.
// ============================================================================

function failing(status: number, body: unknown) {
  return {
    ok: false,
    status,
    json: async () => body,
    clone() {
      return this;
    },
  };
}

describe('HaiProvider names the reason of a failed chat call', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global as any).fetch = plainFetch;
  });

  async function sendWith(response: unknown, options?: { voice?: boolean }) {
    authFetchMock.mockImplementation(async url =>
      String(url).startsWith('/api/hai/chat') ? response : okJson({})
    );
    renderWithProviders(
      <HaiProvider userId="user-1">
        <Probe />
      </HaiProvider>
    );
    await act(async () => {
      await hai.sendMessage('Hallo HAI', options);
    });
    await waitFor(() => expect(hai.messages.at(-1)?.role).toBe('assistant'));
    return hai.messages.at(-1)?.content ?? '';
  }

  it.each([
    [
      'ORGANISATION_PLAN: the plan has no HAI',
      failing(403, { error: 'x', code: 'PRO_REQUIRED' }),
      /nicht enthalten.*Organisation oder Plan/,
    ],
    [
      'FREIGABE: the account waits for the release',
      failing(403, { error: 'Forbidden', code: 'AWAITING_ACTIVATION' }),
      /wartet noch auf die Freigabe/,
    ],
    [
      'SCHALTER_AUS: the voice assistant is off for the organization',
      failing(403, { error: 'x', code: 'VOICE_DISABLED' }),
      /Sprachassistent ist für deine Organisation ausgeschaltet.*Schalter der Organisation/,
    ],
    [
      'a 403 without a known code',
      failing(403, { error: 'x' }),
      /nicht freigeschaltet.*Freigabe oder deine Rolle/,
    ],
    [
      'too many requests',
      failing(429, { error: 'x', code: 'RATE_LIMITED' }),
      /sehr viele Anfragen.*kein Problem mit deinen Rechten/,
    ],
    [
      'a message that is too long',
      failing(400, { error: 'x' }),
      /leer oder zu lang.*5000 Zeichen/,
    ],
  ])('%s', async (_name, response, text) => {
    const content = await sendWith(response);
    expect(content).toMatch(text);
    expect(content).not.toMatch(/Ups, da ist etwas schiefgelaufen/);
  });

  it('a spoken question of an organization without voice gets the reason too', async () => {
    const content = await sendWith(
      failing(403, { error: 'x', code: 'VOICE_DISABLED' }),
      { voice: true }
    );
    expect(content).toMatch(/ausgeschaltet/);
    expect(content).toMatch(/schreiben/);
  });

  it.each([500, 502, 503])(
    'a failure of the server (%s) is never shown as a missing right',
    async status => {
      const content = await sendWith(failing(status, { error: 'x' }));
      expect(content).toMatch(/Ups, da ist etwas schiefgelaufen/);
      expect(content).not.toMatch(
        /Rolle|freigeschaltet|Freigabe|Plan|ausgeschaltet|Berechtigung/
      );
    }
  );

  it('an unreadable body falls back to the status alone', async () => {
    const content = await sendWith({
      ok: false,
      status: 403,
      json: async () => {
        throw new Error('no json');
      },
    });
    expect(content).toMatch(/nicht freigeschaltet/);
  });
});

describe('actionErrorKey names the reason of a failed action', () => {
  it.each([
    [403, { denial: 'ROLLE' }, 'role'],
    [403, { denial: 'BERUF' }, 'occupation'],
    [403, { denial: 'GESPERRT' }, 'locked'],
    [403, { denial: 'ZUSTAENDIGKEIT' }, 'notResponsible'],
    [403, { code: 'PRO_REQUIRED' }, 'plan'],
    [403, { code: 'AWAITING_ACTIVATION' }, 'awaitingActivation'],
    [404, { denial: 'UMFANG' }, 'notFound'],
    [403, {}, 'forbidden'],
    [403, null, 'forbidden'],
    [404, undefined, 'notFound'],
    [400, { denial: 'ROLLE' }, 'invalid'],
    [409, {}, 'conflict'],
    [503, {}, 'unavailable'],
    [500, { denial: 'ROLLE' }, 'generic'],
  ])('%s %j is %s', (status, body, key) => {
    expect(actionErrorKey(status, body as never)).toBe(key);
  });
});

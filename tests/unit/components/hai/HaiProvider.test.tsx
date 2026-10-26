import React from 'react';
import { act, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import { HaiProvider, useHai } from '@/components/hai/HaiProvider';
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

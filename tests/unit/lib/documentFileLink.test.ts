/**
 * @jest-environment jsdom
 */
import { describe, expect, it, jest } from '@jest/globals';

import { isDocumentId, openDocumentFile } from '@/lib/documentFileLink';

// A source of the HAI chat cannot carry a signed address and a plain link cannot
// send the bearer token. The click asks the route of the document and opens the
// answer in a tab that was opened at once (a popup after an await is blocked).

const DOC = 'dddddddd-0000-4000-8000-000000000001';

function fakeWindow() {
  const win = {
    opener: {} as unknown,
    location: { href: '' },
    close: jest.fn(),
  };
  return win as unknown as Window & {
    location: { href: string };
    close: jest.Mock;
  };
}

const answer = (body: unknown, ok = true) =>
  (async () => ({ ok, json: async () => body }) as unknown as Response) as (
    path: string
  ) => Promise<Response>;

describe('isDocumentId', () => {
  it('accepts a uuid only', () => {
    expect(isDocumentId(DOC)).toBe(true);
    for (const value of ['', 'abc', '../x', `${DOC}/x`, null, 3]) {
      expect(isDocumentId(value)).toBe(false);
    }
  });
});

describe('openDocumentFile', () => {
  it('asks the route and opens the signed address in the tab it opened first', async () => {
    const win = fakeWindow();
    const paths: string[] = [];
    const opened = await openDocumentFile(DOC, 'https://old/x.pdf', {
      openWindow: () => win,
      fetchFile: async path => {
        paths.push(path);
        return answer({ url: 'https://proj.supabase.co/sign/x?token=1' })(path);
      },
    });
    expect(opened).toBe(true);
    expect(paths).toEqual([`/api/documents/${DOC}/file`]);
    expect(win.location.href).toBe('https://proj.supabase.co/sign/x?token=1');
    expect(win.opener).toBeNull();
  });

  it('falls back to the stored web address when the route gives none (public bucket)', async () => {
    for (const fetchFile of [
      answer({}, false),
      answer({ url: 'javascript:alert(1)' }),
      answer({ url: 5 }),
      async () => {
        throw new Error('offline');
      },
    ]) {
      const win = fakeWindow();
      const opened = await openDocumentFile(DOC, 'https://old/x.pdf', {
        openWindow: () => win,
        fetchFile,
      });
      expect(opened).toBe(true);
      expect(win.location.href).toBe('https://old/x.pdf');
    }
  });

  it('closes the tab and opens nothing when there is no web address at all', async () => {
    const win = fakeWindow();
    const opened = await openDocumentFile(DOC, undefined, {
      openWindow: () => win,
      fetchFile: answer({}, false),
    });
    expect(opened).toBe(false);
    expect(win.close).toHaveBeenCalled();
    expect(win.location.href).toBe('');

    // a stored address that is no web address is never opened either
    const second = fakeWindow();
    expect(
      await openDocumentFile(DOC, 'private://content/a.pdf', {
        openWindow: () => second,
        fetchFile: answer({}, false),
      })
    ).toBe(false);
    expect(second.location.href).toBe('');
  });

  it('does nothing for an id that is no document id, and opens no tab', async () => {
    const openWindow = jest.fn(() => fakeWindow());
    expect(await openDocumentFile('../x', 'https://a/b', { openWindow })).toBe(
      false
    );
    expect(openWindow).not.toHaveBeenCalled();
  });
});

describe('openDocumentFile when the tab was blocked', () => {
  it('tries once more with the address, and never replaces the current page', async () => {
    const opened: string[] = [];
    const result = await openDocumentFile(DOC, undefined, {
      openWindow: () => null,
      openLater: url => {
        opened.push(url);
        return fakeWindow();
      },
      fetchFile: answer({ url: 'https://proj.supabase.co/sign/x?token=1' }),
    });
    expect(result).toBe(true);
    expect(opened).toEqual(['https://proj.supabase.co/sign/x?token=1']);
  });

  it('reports false when that is blocked too', async () => {
    const result = await openDocumentFile(DOC, 'https://old/x.pdf', {
      openWindow: () => null,
      openLater: () => null,
      fetchFile: answer({}, false),
    });
    expect(result).toBe(false);
  });

  it('still navigates a tab whose opener cannot be changed', async () => {
    const win = fakeWindow();
    Object.defineProperty(win, 'opener', {
      get: () => ({}),
      set: () => {
        throw new Error('locked');
      },
    });
    const result = await openDocumentFile(DOC, 'https://old/x.pdf', {
      openWindow: () => win,
      fetchFile: answer({}, false),
    });
    expect(result).toBe(true);
    expect(win.location.href).toBe('https://old/x.pdf');
  });
});

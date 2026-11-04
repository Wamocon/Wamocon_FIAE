import React, { useState } from 'react';
import { act, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import { HaiProvider, useHai } from '@/components/hai/HaiProvider';
import { resetUiActionExecutor } from '@/components/hai/uiActionExecutor';
import { authFetch } from '@/lib/authFetch';

// The provider hands the event `uiAction` of the chat answer to the executor:
// a checked event fills the form of the page, a spoken turn only shows it and
// waits for a typed "ja", an invalid event does nothing. The provider never
// sends a form: the only calls to the server are the chat calls.

jest.mock('@/lib/authFetch', () => ({
  __esModule: true,
  authFetch: jest.fn(),
}));
jest.mock('@/components/ui/MarkdownText', () => ({
  __esModule: true,
  MarkdownText: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
jest.mock('next/navigation', () => ({
  ...(jest.requireActual('next/navigation') as object),
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
    back: jest.fn(),
    forward: jest.fn(),
    refresh: jest.fn(),
  }),
  usePathname: () => '/trainee/profile',
  useSearchParams: () => new URLSearchParams(),
}));

const authFetchMock = authFetch as unknown as jest.Mock<
  (url: string, init?: RequestInit) => Promise<unknown>
>;

let hai: ReturnType<typeof useHai>;
function Probe() {
  hai = useHai();
  return null;
}

function Page() {
  const [name, setName] = useState('Alter Name');
  return (
    <main>
      <input
        data-hai-form="profile_name"
        data-hai-field="fullName"
        type="text"
        value={name}
        onChange={e => setName(e.target.value)}
      />
      <output data-testid="state">{name}</output>
    </main>
  );
}

const UI_ACTION = {
  tool: 'fill_form',
  form: 'profile_name',
  fields: [{ id: 'fullName', value: 'Max Mustermann' }],
  mode: 'apply',
};

const chatCalls = () =>
  authFetchMock.mock.calls.filter(([url]) => String(url) === '/api/hai/chat');

function answerWith(uiAction: unknown, text = 'Ich trage den Namen ein.') {
  let call = 0;
  authFetchMock.mockImplementation(async url => {
    if (String(url) === '/api/hai/chat') {
      call += 1;
      return {
        ok: true,
        json: async () => ({
          sessionId: 's1',
          response: call === 1 ? text : 'Antwort',
          citations: [],
          uiAction: call === 1 ? uiAction : undefined,
        }),
      };
    }
    return { ok: true, json: async () => ({}) };
  });
}

function mount() {
  return renderWithProviders(
    <HaiProvider userId="u1">
      <Probe />
      <Page />
    </HaiProvider>
  );
}

beforeAll(() => {
  Element.prototype.scrollIntoView = jest.fn();
});

beforeEach(() => {
  jest.clearAllMocks();
  resetUiActionExecutor();
  window.localStorage.clear();
  window.history.pushState({}, '', '/trainee/profile');
});

describe('the event uiAction in the chat answer', () => {
  it('fills the form of the page and shows the bar', async () => {
    answerWith(UI_ACTION);
    mount();
    await act(async () => {
      await hai.sendMessage('Trag bitte meinen Namen im Profil ein');
    });
    expect(screen.getByTestId('state').textContent).toBe('Max Mustermann');
    expect(
      screen.getByTestId('hai-ui-action-bar').getAttribute('data-status')
    ).toBe('applied');
    // only the chat call went out: the form was not sent anywhere
    expect(
      authFetchMock.mock.calls.every(([url]) =>
        String(url).startsWith('/api/hai/')
      )
    ).toBe(true);
  });

  it('does nothing for an event that does not pass the register', async () => {
    answerWith({
      tool: 'fill_form',
      form: 'profile_name',
      fields: [{ id: 'email', value: 'a@b.de' }],
      mode: 'apply',
    });
    mount();
    await act(async () => {
      await hai.sendMessage('Trag bitte meinen Namen im Profil ein');
    });
    expect(screen.getByTestId('state').textContent).toBe('Alter Name');
    expect(
      screen.getByTestId('hai-ui-action-bar').getAttribute('data-status')
    ).toBe('notice');
  });

  it('does nothing and shows nothing without an event', async () => {
    answerWith(undefined, 'Eine normale Antwort');
    mount();
    await act(async () => {
      await hai.sendMessage('Was ist ein Primärschlüssel?');
    });
    expect(screen.getByTestId('state').textContent).toBe('Alter Name');
    expect(screen.queryByTestId('hai-ui-action-bar')).toBeNull();
  });

  it('steps the large chat aside so the filled page is visible', async () => {
    answerWith(UI_ACTION);
    mount();
    act(() => hai.setViewMode('full'));
    await act(async () => {
      await hai.sendMessage('Trag bitte meinen Namen im Profil ein');
    });
    expect(hai.viewMode).toBe('widget');
  });

  it('does not fill when the person left the page meanwhile', async () => {
    answerWith(UI_ACTION);
    mount();
    window.history.pushState({}, '', '/trainee/dashboard');
    await act(async () => {
      await hai.sendMessage('Trag bitte meinen Namen im Profil ein');
    });
    expect(screen.getByTestId('state').textContent).toBe('Alter Name');
  });
});

describe('a spoken turn: shown first, entered after a typed "ja"', () => {
  const CONFIRM = { ...UI_ACTION, mode: 'confirm' };

  it('enters nothing at first, a typed "ja" enters it without a call to the server', async () => {
    answerWith(CONFIRM);
    mount();
    await act(async () => {
      await hai.sendMessage('Trag bitte meinen Namen im Profil ein', {
        voice: true,
      });
    });
    expect(screen.getByTestId('state').textContent).toBe('Alter Name');
    expect(
      screen.getByTestId('hai-ui-action-bar').getAttribute('data-status')
    ).toBe('pending');
    const calls = chatCalls().length;
    await act(async () => {
      await hai.sendMessage('ja');
    });
    expect(screen.getByTestId('state').textContent).toBe('Max Mustermann');
    expect(chatCalls().length).toBe(calls);
  });

  it('a spoken "ja" enters nothing (it goes to the server like any question)', async () => {
    answerWith(CONFIRM);
    mount();
    await act(async () => {
      await hai.sendMessage('Trag bitte meinen Namen im Profil ein', {
        voice: true,
      });
    });
    await act(async () => {
      await hai.sendMessage('ja', { voice: true });
    });
    expect(screen.getByTestId('state').textContent).toBe('Alter Name');
  });

  it('a typed "nein" or another question drops the pending entry, a later "ja" enters nothing', async () => {
    answerWith(CONFIRM);
    mount();
    await act(async () => {
      await hai.sendMessage('Trag bitte meinen Namen im Profil ein', {
        voice: true,
      });
    });
    await act(async () => {
      await hai.sendMessage('Was ist ein Primärschlüssel?');
    });
    expect(screen.queryByTestId('hai-ui-action-bar')).toBeNull();
    await act(async () => {
      await hai.sendMessage('ja');
    });
    expect(screen.getByTestId('state').textContent).toBe('Alter Name');
  });
});

import React, { useEffect, useState } from 'react';
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import {
  describe,
  it,
  expect,
  beforeAll,
  afterEach,
  jest,
} from '@jest/globals';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import { HaiButton } from '@/components/hai/HaiButton';
import { HaiChat } from '@/components/hai/HaiChat';
import { HaiQuizModeProvider } from '@/components/hai/HaiQuizMode';
import { SidebarProvider, useSidebar } from '@/contexts/SidebarContext';
import { SessionContext } from '@/components/hai/voice-mode/voiceSessionContext';
import { TRAINEE_HAI_STEPS, TRAINER_HAI_STEPS } from '@/lib/tour-steps';

// The HAI at the bottom right: the round symbol (HaiButton) is the handle of the
// chat panel. A click slides the panel in from the right, another click (or the
// close button, or Esc) slides it back. The page behind stays usable: no dark
// layer, no focus trap. The navigation is at the left, so the two never meet.

// A small double of the chat provider: the panel and the symbol only need the
// view mode and a few no-ops, the real provider is tested elsewhere.
jest.mock('@/components/hai/HaiProvider', () => {
  const ReactActual = jest.requireActual('react') as typeof import('react');
  const Ctx = ReactActual.createContext<unknown>(null);
  return {
    __esModule: true,
    HaiCtx: Ctx,
    useHai: () => ReactActual.useContext(Ctx),
  };
});
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { HaiCtx } = require('@/components/hai/HaiProvider') as {
  HaiCtx: React.Context<unknown>;
};

jest.mock('next/image', () => ({
  __esModule: true,
  default: (props: { src: string; alt: string }) => (
    <span data-testid="shark" data-src={props.src} />
  ),
}));

// the markdown renderer is an ES module that Jest does not transform
jest.mock('@/components/ui/MarkdownText', () => ({
  __esModule: true,
  MarkdownText: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

type Mode = 'hidden' | 'widget' | 'full';

function HaiDouble({
  children,
  initial = 'hidden',
}: {
  children: React.ReactNode;
  initial?: Mode;
}) {
  const [viewMode, setViewMode] = useState<Mode>(initial);
  const value = {
    viewMode,
    setViewMode,
    toggleChat: () => setViewMode(v => (v === 'hidden' ? 'widget' : 'hidden')),
    messages: [],
    sendMessage: jest.fn(),
    stopGeneration: jest.fn(),
    isLoading: false,
    streamingMessageId: null,
    context: {},
    newSession: jest.fn(),
  };
  return <HaiCtx.Provider value={value}>{children}</HaiCtx.Provider>;
}

function OpenSidebar() {
  const sidebar = useSidebar();
  useEffect(() => {
    sidebar.open();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

const voiceSession = (view: 'open' | 'closed') =>
  ({
    view,
    available: true,
    closeMode: jest.fn(),
    openMode: jest.fn(),
    voice: { available: false },
  }) as never;

function mount(
  options: {
    initial?: Mode;
    sidebar?: boolean;
    session?: 'open' | 'closed';
  } = {}
) {
  const content = (
    <>
      <button type="button">page button</button>
      <HaiButton />
      <HaiChat />
    </>
  );
  return renderWithProviders(
    <SidebarProvider>
      {options.sidebar && <OpenSidebar />}
      <HaiQuizModeProvider>
        <HaiDouble initial={options.initial}>
          {options.session ? (
            <SessionContext.Provider value={voiceSession(options.session)}>
              {content}
            </SessionContext.Provider>
          ) : (
            content
          )}
        </HaiDouble>
      </HaiQuizModeProvider>
    </SidebarProvider>
  );
}

const handle = () =>
  document.querySelector<HTMLElement>('[data-hai-handle]') as HTMLElement;
const anchor = () =>
  document.querySelector<HTMLElement>(
    '[data-tour="hai-button"]'
  ) as HTMLElement;
const panel = () => screen.queryByTestId('hai-chat-panel');

beforeAll(() => {
  // jsdom does not scroll: the chat scrolls its last message into view
  Element.prototype.scrollIntoView = jest.fn();
});

const originalMatchMedia = window.matchMedia;
afterEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: originalMatchMedia,
  });
});

describe('the HAI symbol sits at the bottom right', () => {
  it('is fixed at the bottom right and not at the left, over the page but under dialogs (z-40)', () => {
    mount();
    const classes = anchor().className;
    expect(classes).toContain('fixed');
    expect(classes).toContain('bottom-4');
    expect(classes).toContain('right-4');
    expect(classes).toContain('sm:bottom-6');
    expect(classes).toContain('sm:right-6');
    expect(classes).not.toMatch(/(^|\s)(sm:|lg:)?left-/);
    expect(classes).toContain('z-40');
    // the safe area of a phone (notch, home bar)
    expect(classes).toContain('safe-area-inset-bottom');
  });

  it('is the target of the platform tour (data-tour), and the tour opens its tooltip to the left', () => {
    mount();
    expect(document.querySelectorAll('[data-tour="hai-button"]')).toHaveLength(
      1
    );
    expect(handle().closest('[data-tour="hai-button"]')).not.toBeNull();
    for (const step of [...TRAINEE_HAI_STEPS, ...TRAINER_HAI_STEPS]) {
      expect(step.targetSelector).toBe('[data-tour="hai-button"]');
      expect(step.placement).toBe('left');
    }
  });

  it('does not move for the navigation (it is at the left): the anchor stays in the corner when the navigation is kept open', async () => {
    mount({ sidebar: true });
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });
    expect(anchor().className).not.toMatch(/(^|\s)(sm:|md:|lg:)?left-/);
    expect(anchor().className).toContain('right-4');
  });

  it('shows its tooltip to the left of the symbol (the page is to its left)', () => {
    mount();
    const tooltip = screen.getByText('Frag HAI');
    expect(tooltip.className).toContain('right-full');
    expect(tooltip.className).not.toContain('left-full');
  });
});

describe('the chat panel slides in from the right', () => {
  it('is closed at the start and opens with a click on the symbol', async () => {
    mount();
    expect(panel()).toBeNull();
    expect(handle().getAttribute('aria-expanded')).toBe('false');
    expect(handle().getAttribute('aria-label')).toBe('HAI öffnen');

    fireEvent.click(handle());
    await waitFor(() => expect(panel()).not.toBeNull());
    expect(handle().getAttribute('aria-expanded')).toBe('true');
    expect(handle().getAttribute('aria-controls')).toBe(panel()!.id);
    expect(handle().getAttribute('aria-label')).toBe('Schließen');
  });

  it('closes again with a second click on the symbol', async () => {
    mount();
    fireEvent.click(handle());
    await waitFor(() => expect(panel()).not.toBeNull());
    fireEvent.click(handle());
    await waitFor(() => expect(panel()).toBeNull());
    expect(handle().getAttribute('aria-expanded')).toBe('false');
  });

  it('is anchored at the right edge: right-0, full height under the page header, 420 px wide from md up, the full width on a phone', async () => {
    mount({ initial: 'widget' });
    const classes = panel()!.className;
    expect(panel()!.getAttribute('data-side')).toBe('right');
    expect(classes).toContain('right-0');
    expect(classes).not.toMatch(/(^|\s)(md:|lg:)?left-/);
    // under the page header (h-16), down to the bottom
    expect(classes).toContain('top-16');
    expect(classes).toContain('md:bottom-0');
    // a phone: a sheet over the full width that leaves a strip for the symbol
    expect(classes).toContain('w-full');
    expect(classes).toContain('bottom-24');
    // desktop: 420 px
    expect(classes).toContain('md:w-[420px]');
    // z-40 like the symbol: under dialogs and viewers (z-50)
    expect(classes).toContain('z-40');
  });

  it('does not give way to the navigation (it is at the left): no offset when it is kept open', async () => {
    mount({ initial: 'widget', sidebar: true });
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });
    expect(panel()!.className).not.toMatch(/(^|\s)(md:|lg:)?left-/);
    expect(panel()!.className).toContain('right-0');
  });

  it('is an overlay: no dark layer, no blur, no dialog, the page behind stays usable', () => {
    mount({ initial: 'widget' });
    // no full-screen layer at all
    expect(document.querySelector('.fixed.inset-0')).toBeNull();
    expect(document.querySelector('[class*="backdrop"]')).toBeNull();
    expect(document.querySelector('[class*="bg-black/"]')).toBeNull();
    // a landmark of the page, not a modal
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(panel()!.getAttribute('aria-modal')).toBeNull();
    expect(screen.getByRole('complementary', { name: 'HAI Chat' })).toBe(
      panel()
    );
    // and the page button behind is reachable by Tab and click
    const pageButton = screen.getByRole('button', { name: 'page button' });
    expect(pageButton.closest('[inert]')).toBeNull();
    pageButton.focus();
    expect(document.activeElement).toBe(pageButton);
  });

  it('keeps the symbol visible and clickable while open: it rides on the left edge of the panel', async () => {
    mount();
    expect(anchor().className).not.toContain('md:-translate-x-[420px]');
    fireEvent.click(handle());
    await waitFor(() => expect(panel()).not.toBeNull());
    // the symbol moves with the panel (420 px to the left, from md up)
    expect(anchor().className).toContain('md:-translate-x-[420px]');
    expect(anchor().getAttribute('data-panel')).toBe('open');
    // a small arrow shows that a click slides the panel back
    expect(screen.getByTestId('hai-handle-arrow')).not.toBeNull();
    expect((handle() as HTMLButtonElement).disabled).toBe(false);
    // the symbol is not inside the panel (it would be hidden with it)
    expect(panel()!.contains(handle())).toBe(false);
  });

  it('keeps the contents: the header with the voice buttons, the expand button, the input and the empty state', () => {
    mount({ initial: 'widget' });
    const inside = within(panel()!);
    expect(inside.getByRole('button', { name: 'Vergrößern' })).not.toBeNull();
    expect(inside.getByRole('button', { name: 'Schließen' })).not.toBeNull();
    expect(inside.getByPlaceholderText('Frag HAI...')).not.toBeNull();
    expect(inside.getByRole('button', { name: 'Senden' })).not.toBeNull();
  });
});

describe('focus and keys', () => {
  it('moves the focus into the input when the panel opens', async () => {
    mount();
    fireEvent.click(handle());
    await waitFor(() => expect(panel()).not.toBeNull());
    expect(document.activeElement).toBe(
      within(panel()!).getByPlaceholderText('Frag HAI...')
    );
  });

  it('closes with the close button and puts the focus back on the symbol', async () => {
    mount({ initial: 'widget' });
    within(panel()!).getByRole('button', { name: 'Schließen' }).focus();
    fireEvent.click(
      within(panel()!).getByRole('button', { name: 'Schließen' })
    );
    expect(document.activeElement).toBe(handle());
    await waitFor(() => expect(panel()).toBeNull());
  });

  it('closes with Esc and puts the focus back on the symbol', async () => {
    mount();
    fireEvent.click(handle());
    await waitFor(() => expect(panel()).not.toBeNull());
    const input = within(panel()!).getByPlaceholderText('Frag HAI...');
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(document.activeElement).toBe(handle());
    await waitFor(() => expect(panel()).toBeNull());
  });

  it('does not close with Esc when the focus is somewhere else on the page (a dialog, another field)', async () => {
    mount({ initial: 'widget' });
    const pageButton = screen.getByRole('button', { name: 'page button' });
    pageButton.focus();
    fireEvent.keyDown(pageButton, { key: 'Escape' });
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });
    expect(panel()).not.toBeNull();
  });

  it('does not trap the focus: Tab can leave the panel (it is not modal)', async () => {
    mount({ initial: 'widget' });
    // no handler on the panel keeps the focus inside, and nothing is inert or aria-hidden
    expect(panel()!.getAttribute('aria-hidden')).toBeNull();
    expect(panel()!.hasAttribute('inert')).toBe(false);
    const input = within(panel()!).getByPlaceholderText('Frag HAI...');
    input.focus();
    const prevented = !fireEvent.keyDown(input, { key: 'Tab' });
    expect(prevented).toBe(false);
  });

  it('leaves Esc to the voice mode while it is open (the voice mode ends first)', async () => {
    mount({ initial: 'widget', session: 'open' });
    const input = within(panel()!).getByPlaceholderText('Frag HAI...');
    fireEvent.keyDown(input, { key: 'Escape' });
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });
    expect(panel()).not.toBeNull();
  });
});

describe('the pond of the voice mode is the symbol', () => {
  const session = voiceSession;

  it('grows the round symbol into the pond while the voice mode is open: the same disc, scaled', () => {
    renderWithProviders(
      <SidebarProvider>
        <HaiDouble>
          <SessionContext.Provider value={session('open')}>
            <HaiButton />
          </SessionContext.Provider>
        </HaiDouble>
      </SidebarProvider>
    );
    const pond = document.querySelector('[data-pond]') as HTMLElement;
    expect(pond.getAttribute('data-pond')).toBe('true');
    expect(pond.className).toContain('scale-[2]');
    expect(pond.className).toContain('sm:scale-[2.8]');
    // grows out of the corner where the button sits
    expect(pond.className).toContain('origin-bottom-right');
    // the pixel shark makes room for the figure
    expect(screen.getByTestId('shark').parentElement!.className).toContain(
      'opacity-0'
    );
    // still the one handle, still clickable
    expect(handle()).not.toBeNull();
  });

  it('is a plain button again when the voice mode is closed', () => {
    renderWithProviders(
      <SidebarProvider>
        <HaiDouble>
          <SessionContext.Provider value={session('closed')}>
            <HaiButton />
          </SessionContext.Provider>
        </HaiDouble>
      </SidebarProvider>
    );
    const pond = document.querySelector('[data-pond]') as HTMLElement;
    expect(pond.getAttribute('data-pond')).toBe('false');
    expect(pond.className).not.toContain('scale-[');
    expect(screen.getByTestId('shark').parentElement!.className).toContain(
      'opacity-100'
    );
  });
});

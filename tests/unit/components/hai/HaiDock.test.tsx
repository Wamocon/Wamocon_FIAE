import React, { useState } from 'react';
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
  beforeEach,
  afterEach,
  jest,
} from '@jest/globals';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import { MainLayout } from '@/components/layout/MainLayout';
import { HaiButton } from '@/components/hai/HaiButton';
import { HaiChat } from '@/components/hai/HaiChat';
import { HaiDockProvider } from '@/components/hai/HaiDockContext';
import { HaiQuizModeProvider } from '@/components/hai/HaiQuizMode';
import { SidebarProvider } from '@/contexts/SidebarContext';
import { SessionContext } from '@/components/hai/voice-mode/voiceSessionContext';
import { useCatalog } from '@/contexts/CatalogContext';

// The HAI panel as a part of the layout: open, it is a column at the right edge
// of MainLayout, the page makes room for it (the width is a CSS variable on the
// layout), the person pulls it wider or narrower (mouse, touch, keys), the width
// is kept. Under 768 px (and when the page would keep less than 480 px) the
// panel stays a sheet over the page. Modules under test: HaiDockContext,
// HaiDockColumn, HaiDockHandle, haiLayout (symbol), HaiChat (portal), MainLayout.

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
const { HaiCtx, useHai } = require('@/components/hai/HaiProvider') as {
  HaiCtx: React.Context<unknown>;
  useHai: () => { viewMode: string };
};

jest.mock('next/image', () => ({
  __esModule: true,
  default: (props: { src: string }) => (
    <span data-testid="shark" data-src={props.src} />
  ),
}));
jest.mock('@/components/ui/MarkdownText', () => ({
  __esModule: true,
  MarkdownText: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
jest.mock('@/contexts/CatalogContext');
jest.mock('@/components/layout/Header', () => ({ Header: () => null }));
jest.mock('@/components/layout/Sidebar', () => ({ Sidebar: () => null }));
jest.mock('@/components/catalog/CatalogTabs', () => ({
  CatalogTabs: () => null,
}));

type Mode = 'hidden' | 'widget' | 'full';

function HaiDouble({
  children,
  initial,
}: {
  children: React.ReactNode;
  initial: Mode;
}) {
  const [viewMode, setViewMode] = useState<Mode>(initial);
  const value = {
    viewMode,
    setViewMode,
    toggleChat: () => setViewMode(v => (v === 'hidden' ? 'widget' : 'hidden')),
    messages: [{ id: 'm1', role: 'user', content: 'Frage', timestamp: 'x' }],
    sessions: [],
    sendMessage: jest.fn(),
    stopGeneration: jest.fn(),
    isLoading: false,
    streamingMessageId: null,
    context: {},
    newSession: jest.fn(),
  };
  return <HaiCtx.Provider value={value}>{children}</HaiCtx.Provider>;
}

// what HaiWrapper does: the dock provider knows whether the panel is shown
function DockHost({ children }: { children: React.ReactNode }) {
  const { viewMode } = useHai();
  return (
    <HaiDockProvider open={viewMode === 'widget'}>{children}</HaiDockProvider>
  );
}

const pageRenders = jest.fn();
function Page({ name = 'A' }: { name?: string }) {
  pageRenders();
  return <p data-testid="page">{name}</p>;
}

function App({
  initial,
  sidebarOpen,
  page,
  session,
}: {
  initial: Mode;
  sidebarOpen: boolean;
  page: string;
  session?: unknown;
}) {
  const inner = (
    <DockHost>
      <MainLayout
        profile={null}
        onGoBack={() => {}}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => {}}
        userRole="trainee"
      >
        <Page name={page} />
      </MainLayout>
      <HaiButton />
      <HaiChat />
    </DockHost>
  );
  return (
    <SidebarProvider>
      <HaiQuizModeProvider>
        <HaiDouble initial={initial}>
          {session ? (
            <SessionContext.Provider value={session as never}>
              {inner}
            </SessionContext.Provider>
          ) : (
            inner
          )}
        </HaiDouble>
      </HaiQuizModeProvider>
    </SidebarProvider>
  );
}

function mount(
  options: {
    initial?: Mode;
    sidebarOpen?: boolean;
    page?: string;
    session?: unknown;
  } = {}
) {
  const props = {
    initial: options.initial ?? 'hidden',
    sidebarOpen: options.sidebarOpen ?? false,
    page: options.page ?? 'A',
    session: options.session,
  };
  const view = renderWithProviders(<App {...props} />);
  return {
    ...view,
    rerenderApp: (next: Partial<typeof props>) =>
      view.rerender(<App {...props} {...next} />),
  };
}

const handle = () =>
  document.querySelector<HTMLElement>('[data-hai-handle]') as HTMLElement;
const anchor = () =>
  document.querySelector<HTMLElement>(
    '[data-tour="hai-button"]'
  ) as HTMLElement;
const panel = () => screen.queryByTestId('hai-chat-panel');
const column = () => screen.getByTestId('hai-dock-column');
const separator = () => screen.queryByRole('separator');
const layoutEl = () => column().parentElement as HTMLElement;
const variable = (name: string, element: HTMLElement = layoutEl()) =>
  element.style.getPropertyValue(name);

const STORAGE_KEY = 'hai-panel-width';

// the storage of the width fails (blocked, full), everything else keeps working
function failOnlyForTheWidth(method: 'getItem' | 'setItem') {
  const original = Storage.prototype[method] as (...args: string[]) => unknown;
  jest.spyOn(Storage.prototype, method).mockImplementation(function (
    this: Storage,
    ...args: string[]
  ) {
    if (args[0] === STORAGE_KEY) throw new Error('storage failed');
    return original.apply(this, args);
  } as never);
}

// jsdom has no PointerEvent: a small one with the fields the handle reads
class TestPointerEvent extends MouseEvent {
  pointerId: number;
  pointerType: string;
  constructor(type: string, init: Record<string, unknown> = {}) {
    super(type, init as MouseEventInit);
    this.pointerId = (init.pointerId as number) ?? 1;
    this.pointerType = (init.pointerType as string) ?? 'mouse';
  }
}

let frames: Array<() => void> = [];
const flushFrames = () =>
  act(() => {
    const queue = frames;
    frames = [];
    queue.forEach(run => run());
  });

function setWindowWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: width,
  });
  act(() => {
    window.dispatchEvent(new Event('resize'));
  });
}

const originalMatchMedia = window.matchMedia;
const originalInnerWidth = window.innerWidth;

function mockReducedMotion(reduced: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: reduced && query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    }),
  });
}

beforeAll(() => {
  Element.prototype.scrollIntoView = jest.fn();
  (window as unknown as { PointerEvent: unknown }).PointerEvent =
    TestPointerEvent;
});

beforeEach(() => {
  pageRenders.mockClear();
  frames = [];
  (useCatalog as jest.Mock).mockReturnValue({ tabs: [], epoch: 0 });
  jest
    .spyOn(window, 'requestAnimationFrame')
    .mockImplementation((run: FrameRequestCallback) => {
      frames.push(() => run(0));
      return frames.length;
    });
  jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {
    frames = [];
  });
  setWindowWidth(1280);
});

afterEach(() => {
  window.localStorage.clear();
  document.body.removeAttribute('style');
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: originalMatchMedia,
  });
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: originalInnerWidth,
  });
  jest.restoreAllMocks();
});

describe('the panel is a column of the layout and the page makes room for it', () => {
  it('has a column at the right edge of the layout that is 0 wide while the panel is closed', () => {
    mount();
    expect(panel()).toBeNull();
    expect(column().getAttribute('data-open')).toBe('false');
    expect(variable('--hai-dock-inset')).toBe('0px');
    // the layout row: navigation, main (header and page), column
    expect(layoutEl().lastElementChild).toBe(column());
    expect(column().className).toContain('w-[var(--hai-dock-inset,0px)]');
    // the page may shrink below its content (tables and charts scroll or wrap)
    expect(layoutEl().querySelector('main')!.className).toContain('min-w-0');
  });

  it('opens: the column takes the panel width from the page, the panel is inside of it', async () => {
    mount();
    fireEvent.click(handle());
    await waitFor(() => expect(panel()).not.toBeNull());
    expect(column().getAttribute('data-open')).toBe('true');
    expect(column().getAttribute('data-docked')).toBe('true');
    // the variable on the layout is what moves the page to the left
    expect(variable('--hai-dock-inset')).toBe('420px');
    expect(variable('--hai-panel-width')).toBe('420px');
    // part of the layout, not over it
    expect(column().contains(panel())).toBe(true);
    expect(panel()!.getAttribute('data-docked')).toBe('true');
    expect(panel()!.className).not.toContain('fixed');
    // full height of the column and at its left edge, with the width of the variable
    expect(panel()!.className).toContain('inset-y-0');
    expect(panel()!.className).toContain('left-0');
    expect(panel()!.className).toContain('w-[var(--hai-panel-width,420px)]');
    // still a landmark, no dialog, nothing is dark
    expect(screen.getByRole('complementary', { name: 'HAI Chat' })).toBe(
      panel()
    );
    expect(document.querySelector('.fixed.inset-0')).toBeNull();
  });

  it('closes: the page gets its room back', async () => {
    mount({ initial: 'widget' });
    expect(variable('--hai-dock-inset')).toBe('420px');
    fireEvent.click(handle());
    expect(variable('--hai-dock-inset')).toBe('0px');
    expect(column().getAttribute('data-open')).toBe('false');
    await waitFor(() => expect(panel()).toBeNull());
    // the chosen width stays for the next time
    expect(variable('--hai-panel-width')).toBe('420px');
  });

  it('is closed in the full screen chat too (the page is not pushed under a full screen layer)', () => {
    mount({ initial: 'full' });
    expect(variable('--hai-dock-inset')).toBe('0px');
  });

  it('animates the width of the column for 0.28 s, without motion for reduced motion', () => {
    mount();
    expect(variable('--hai-dock-ms')).toBe('280ms');
    expect(column().className).toContain('transition-[width]');
    expect(column().className).toContain('duration-[var(--hai-dock-ms,280ms)]');
  });

  it('has no transition with reduced motion', () => {
    mockReducedMotion(true);
    mount();
    expect(variable('--hai-dock-ms')).toBe('0ms');
  });

  it('keeps the panel mounted and the history when the page changes (the panel is part of the layout, not of the page)', async () => {
    const { rerenderApp } = mount({ initial: 'widget' });
    const before = panel();
    expect(before).not.toBeNull();
    expect(screen.getByTestId('page').textContent).toBe('A');
    rerenderApp({ page: 'B' });
    expect(screen.getByTestId('page').textContent).toBe('B');
    // the same element, not mounted again
    expect(panel()).toBe(before);
    expect(variable('--hai-dock-inset')).toBe('420px');
  });
});

describe('under 768 px (and when the page would be too narrow) the panel stays a sheet over the page', () => {
  it('does not dock on a phone: the sheet is fixed, the column stays closed, there is no handle', async () => {
    setWindowWidth(600);
    mount({ initial: 'widget' });
    expect(panel()!.getAttribute('data-docked')).toBe('false');
    expect(panel()!.className).toContain('fixed');
    expect(column().contains(panel())).toBe(false);
    expect(variable('--hai-dock-inset')).toBe('0px');
    expect(separator()).toBeNull();
  });

  it('docks between 768 and 1024 px with a narrower minimum', () => {
    setWindowWidth(900);
    mount({ initial: 'widget' });
    expect(panel()!.getAttribute('data-docked')).toBe('true');
    expect(separator()!.getAttribute('aria-valuemin')).toBe('288');
    // the page keeps 480 px: 900 - 480
    expect(separator()!.getAttribute('aria-valuemax')).toBe('420');
  });

  it('is a sheet at 767 px and docks at 768 px', () => {
    setWindowWidth(767);
    mount({ initial: 'widget' });
    expect(panel()!.getAttribute('data-docked')).toBe('false');
    setWindowWidth(768);
    expect(panel()!.getAttribute('data-docked')).toBe('true');
    expect(variable('--hai-panel-width')).toBe('288px');
  });

  it('is a sheet when the open navigation leaves the page less than 480 px', () => {
    setWindowWidth(1024);
    mount({ initial: 'widget', sidebarOpen: true });
    expect(panel()!.getAttribute('data-docked')).toBe('false');
    expect(variable('--hai-dock-inset')).toBe('0px');
  });

  it('docks again when the window grows (resize) and the sheet becomes a column', () => {
    setWindowWidth(600);
    mount({ initial: 'widget' });
    expect(panel()!.getAttribute('data-docked')).toBe('false');
    setWindowWidth(1280);
    expect(panel()!.getAttribute('data-docked')).toBe('true');
    expect(variable('--hai-dock-inset')).toBe('420px');
  });

  it('is a sheet when there is no layout around (no column to dock into)', async () => {
    renderWithProviders(
      <SidebarProvider>
        <HaiQuizModeProvider>
          <HaiDouble initial="widget">
            <DockHost>
              <HaiButton />
              <HaiChat />
            </DockHost>
          </HaiDouble>
        </HaiQuizModeProvider>
      </SidebarProvider>
    );
    expect(panel()!.getAttribute('data-docked')).toBe('false');
    expect(panel()!.className).toContain('fixed');
    expect(separator()).toBeNull();
  });
});

describe('pulling the width with the pointer (mouse and touch)', () => {
  const pull = (
    from: number,
    to: number,
    pointerType: 'mouse' | 'touch' = 'mouse'
  ) => {
    const grip = separator()!;
    fireEvent.pointerDown(grip, {
      clientX: from,
      pointerId: 7,
      pointerType,
      button: 0,
    });
    fireEvent.pointerMove(grip, { clientX: to, pointerId: 7, pointerType });
    return grip;
  };

  it('has an accessible separator with the values of the width', () => {
    mount({ initial: 'widget' });
    const grip = separator()!;
    expect(grip.getAttribute('aria-orientation')).toBe('vertical');
    expect(grip.getAttribute('aria-valuenow')).toBe('420');
    expect(grip.getAttribute('aria-valuemin')).toBe('320');
    expect(grip.getAttribute('aria-valuemax')).toBe('720');
    expect(grip.getAttribute('aria-label')).toBe(
      'Breite des HAI Panels ändern'
    );
    expect(grip.getAttribute('aria-controls')).toBe(panel()!.id);
    expect(grip.tabIndex).toBe(0);
    // at the left edge of the panel, with a column resize cursor, touch is not scrolled
    expect(grip.className).toContain('cursor-col-resize');
    expect(grip.className).toContain('touch-none');
    expect(grip.className).toContain('left-0');
    expect(panel()!.contains(grip)).toBe(true);
  });

  it('makes the panel wider when the pointer moves left, and writes only the variables while pulling', () => {
    mount({ initial: 'widget' });
    const rendersBefore = pageRenders.mock.calls.length;
    pull(1000, 900);
    flushFrames();
    // 420 + 100 px
    expect(variable('--hai-panel-width')).toBe('520px');
    expect(variable('--hai-dock-inset')).toBe('520px');
    // no transition while pulling: the page follows the pointer
    expect(variable('--hai-dock-ms')).toBe('0ms');
    // the state and the storage wait for the release
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    // the page is not rendered again for a pixel
    expect(pageRenders.mock.calls.length).toBe(rendersBefore);
  });

  it('writes one frame for many moves (requestAnimationFrame)', () => {
    mount({ initial: 'widget' });
    const grip = pull(1000, 990);
    fireEvent.pointerMove(grip, { clientX: 970, pointerId: 7 });
    fireEvent.pointerMove(grip, { clientX: 940, pointerId: 7 });
    expect(frames).toHaveLength(1);
    flushFrames();
    expect(variable('--hai-panel-width')).toBe('480px');
  });

  it('puts the width into the state and the storage on release, and restores the transition', () => {
    mount({ initial: 'widget' });
    const grip = pull(1000, 900);
    fireEvent.pointerUp(grip, { clientX: 900, pointerId: 7 });
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('520');
    expect(separator()!.getAttribute('aria-valuenow')).toBe('520');
    expect(variable('--hai-panel-width')).toBe('520px');
    expect(variable('--hai-dock-inset')).toBe('520px');
    expect(variable('--hai-dock-ms')).toBe('280ms');
  });

  it('uses the position of the release too (a release without a move before)', () => {
    mount({ initial: 'widget' });
    const grip = separator()!;
    fireEvent.pointerDown(grip, { clientX: 1000, pointerId: 3 });
    fireEvent.pointerUp(grip, { clientX: 880, pointerId: 3 });
    expect(separator()!.getAttribute('aria-valuenow')).toBe('540');
  });

  it('works with a finger as well', () => {
    mount({ initial: 'widget' });
    const grip = pull(1000, 950, 'touch');
    fireEvent.pointerUp(grip, {
      clientX: 950,
      pointerId: 7,
      pointerType: 'touch',
    });
    expect(separator()!.getAttribute('aria-valuenow')).toBe('470');
  });

  it('captures the pointer so the pull follows it outside of the handle', () => {
    mount({ initial: 'widget' });
    const grip = separator()!;
    const capture = jest.fn();
    const release = jest.fn();
    (grip as unknown as { setPointerCapture: unknown }).setPointerCapture =
      capture;
    (
      grip as unknown as { releasePointerCapture: unknown }
    ).releasePointerCapture = release;
    fireEvent.pointerDown(grip, { clientX: 1000, pointerId: 7 });
    expect(capture).toHaveBeenCalledWith(7);
    fireEvent.pointerUp(grip, { clientX: 1000, pointerId: 7 });
    expect(release).toHaveBeenCalledWith(7);
  });

  it('does not start with the right mouse button', () => {
    mount({ initial: 'widget' });
    const grip = separator()!;
    fireEvent.pointerDown(grip, { clientX: 1000, pointerId: 7, button: 2 });
    expect(screen.queryByTestId('hai-dock-guard')).toBeNull();
    fireEvent.pointerMove(grip, { clientX: 800, pointerId: 7 });
    expect(frames).toHaveLength(0);
  });

  it('ignores moves of another pointer', () => {
    mount({ initial: 'widget' });
    const grip = pull(1000, 990);
    fireEvent.pointerMove(grip, { clientX: 500, pointerId: 99 });
    flushFrames();
    expect(variable('--hai-panel-width')).toBe('430px');
  });

  it('never goes under the minimum of 320 px', () => {
    mount({ initial: 'widget' });
    const grip = pull(1000, 1600);
    flushFrames();
    expect(variable('--hai-panel-width')).toBe('320px');
    fireEvent.pointerUp(grip, { clientX: 1600, pointerId: 7 });
    expect(separator()!.getAttribute('aria-valuenow')).toBe('320');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('320');
  });

  it('never goes over the maximum of 720 px', () => {
    mount({ initial: 'widget' });
    const grip = pull(1000, 100);
    flushFrames();
    expect(variable('--hai-panel-width')).toBe('720px');
    fireEvent.pointerUp(grip, { clientX: 100, pointerId: 7 });
    expect(separator()!.getAttribute('aria-valuenow')).toBe('720');
  });

  it('never takes more than 60 percent of the window and leaves the page 480 px', () => {
    setWindowWidth(1100);
    mount({ initial: 'widget' });
    expect(separator()!.getAttribute('aria-valuemax')).toBe('620');
    const grip = pull(1000, 0);
    fireEvent.pointerUp(grip, { clientX: 0, pointerId: 7 });
    expect(separator()!.getAttribute('aria-valuenow')).toBe('620');
  });

  it('leaves the page 480 px with the navigation open (1280 px: at most 512 px)', () => {
    mount({ initial: 'widget', sidebarOpen: true });
    expect(separator()!.getAttribute('aria-valuemax')).toBe('512');
    const grip = pull(1000, 0);
    fireEvent.pointerUp(grip, { clientX: 0, pointerId: 7 });
    expect(separator()!.getAttribute('aria-valuenow')).toBe('512');
  });

  it('covers the window with a guard while pulling (an iframe cannot swallow the pointer) and removes it afterwards', () => {
    mount({ initial: 'widget' });
    expect(screen.queryByTestId('hai-dock-guard')).toBeNull();
    const grip = pull(1000, 950);
    const guard = screen.getByTestId('hai-dock-guard');
    expect(guard.className).toContain('fixed');
    expect(guard.className).toContain('inset-0');
    expect(guard.className).toContain('cursor-col-resize');
    // above the panel and the page (the viewers are z-50)
    expect(guard.className).toContain('z-[70]');
    fireEvent.pointerUp(grip, { clientX: 950, pointerId: 7 });
    expect(screen.queryByTestId('hai-dock-guard')).toBeNull();
  });

  it('blocks the text selection and keeps the cursor while pulling, and gives them back', () => {
    document.body.style.cursor = 'wait';
    mount({ initial: 'widget' });
    const grip = pull(1000, 950);
    expect(document.body.style.userSelect).toBe('none');
    expect(document.body.style.cursor).toBe('col-resize');
    expect(separator()!.getAttribute('data-pulling')).toBe('true');
    fireEvent.pointerUp(grip, { clientX: 950, pointerId: 7 });
    expect(document.body.style.userSelect).toBe('');
    expect(document.body.style.cursor).toBe('wait');
  });

  it('takes the width back when the pointer is cancelled', () => {
    mount({ initial: 'widget' });
    const grip = pull(1000, 800);
    flushFrames();
    expect(variable('--hai-panel-width')).toBe('620px');
    fireEvent.pointerCancel(grip, { pointerId: 7 });
    expect(variable('--hai-panel-width')).toBe('420px');
    expect(variable('--hai-dock-ms')).toBe('280ms');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(screen.queryByTestId('hai-dock-guard')).toBeNull();
    expect(document.body.style.userSelect).toBe('');
  });

  it('takes the width back and removes the guard when the panel closes during the pull', async () => {
    mount({ initial: 'widget' });
    pull(1000, 800);
    flushFrames();
    fireEvent.click(handle());
    await waitFor(() => expect(panel()).toBeNull());
    expect(screen.queryByTestId('hai-dock-guard')).toBeNull();
    expect(variable('--hai-dock-ms')).toBe('280ms');
    expect(variable('--hai-panel-width')).toBe('420px');
  });

  it('does not pull in the full screen chat or when closed (the handle is not there)', () => {
    mount();
    expect(separator()).toBeNull();
  });
});

describe('keys and double click on the separator', () => {
  const press = (key: string, shiftKey = false) =>
    fireEvent.keyDown(separator()!, { key, shiftKey });
  const now = () => Number(separator()!.getAttribute('aria-valuenow'));

  it('arrow left makes the panel 24 px wider, arrow right 24 px narrower', () => {
    mount({ initial: 'widget' });
    press('ArrowLeft');
    expect(now()).toBe(444);
    expect(variable('--hai-panel-width')).toBe('444px');
    press('ArrowRight');
    press('ArrowRight');
    expect(now()).toBe(396);
  });

  it('changes by 96 px with Shift', () => {
    mount({ initial: 'widget' });
    press('ArrowLeft', true);
    expect(now()).toBe(516);
    press('ArrowRight', true);
    press('ArrowRight', true);
    expect(now()).toBe(324);
  });

  it('goes to the minimum with Home and to the maximum with End', () => {
    mount({ initial: 'widget' });
    press('Home');
    expect(now()).toBe(320);
    press('End');
    expect(now()).toBe(720);
  });

  it('stays inside the limits with the keys', () => {
    mount({ initial: 'widget' });
    press('End');
    press('ArrowLeft', true);
    expect(now()).toBe(720);
    press('Home');
    press('ArrowRight', true);
    expect(now()).toBe(320);
  });

  it('remembers the width after a key', () => {
    mount({ initial: 'widget' });
    press('ArrowLeft', true);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('516');
  });

  it('does not take other keys (Tab and Escape still work for the page)', () => {
    mount({ initial: 'widget' });
    const tabbed = fireEvent.keyDown(separator()!, { key: 'Tab' });
    expect(tabbed).toBe(true);
    expect(now()).toBe(420);
  });

  it('is reached by Tab: focusable', () => {
    mount({ initial: 'widget' });
    separator()!.focus();
    expect(document.activeElement).toBe(separator());
  });

  it('goes back to the default width of 420 px on a double click', () => {
    mount({ initial: 'widget' });
    press('End');
    expect(now()).toBe(720);
    fireEvent.doubleClick(separator()!);
    expect(now()).toBe(420);
    expect(variable('--hai-panel-width')).toBe('420px');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('420');
  });
});

describe('the width is kept', () => {
  it('starts with 420 px when nothing is stored', () => {
    mount({ initial: 'widget' });
    expect(separator()!.getAttribute('aria-valuenow')).toBe('420');
  });

  it('starts with the stored width', () => {
    window.localStorage.setItem(STORAGE_KEY, '600');
    mount({ initial: 'widget' });
    expect(separator()!.getAttribute('aria-valuenow')).toBe('600');
    expect(variable('--hai-panel-width')).toBe('600px');
    expect(variable('--hai-dock-inset')).toBe('600px');
  });

  it('restores the width after a reload (mounted again)', () => {
    const first = mount({ initial: 'widget' });
    fireEvent.keyDown(separator()!, { key: 'ArrowLeft', shiftKey: true });
    fireEvent.keyDown(separator()!, { key: 'ArrowLeft', shiftKey: true });
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('612');
    first.unmount();
    mount({ initial: 'widget' });
    expect(separator()!.getAttribute('aria-valuenow')).toBe('612');
  });

  it('limits what is stored to the limits when it is read', () => {
    window.localStorage.setItem(STORAGE_KEY, '9000');
    mount({ initial: 'widget' });
    expect(separator()!.getAttribute('aria-valuenow')).toBe('720');
  });

  it('limits a stored width to the window (1000 px: at most 520 px)', () => {
    setWindowWidth(1000);
    window.localStorage.setItem(STORAGE_KEY, '700');
    mount({ initial: 'widget' });
    expect(separator()!.getAttribute('aria-valuenow')).toBe('520');
    // the stored value itself is not rewritten by the window
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('700');
  });

  it('limits the width again when the window changes, and gives the chosen width back when it grows', () => {
    window.localStorage.setItem(STORAGE_KEY, '700');
    mount({ initial: 'widget' });
    expect(separator()!.getAttribute('aria-valuenow')).toBe('700');
    setWindowWidth(1000);
    expect(separator()!.getAttribute('aria-valuenow')).toBe('520');
    expect(variable('--hai-dock-inset')).toBe('520px');
    expect(separator()!.getAttribute('aria-valuemax')).toBe('520');
    setWindowWidth(1400);
    expect(separator()!.getAttribute('aria-valuenow')).toBe('700');
  });

  it('starts with the default width when the storage cannot be read (getItem throws)', () => {
    window.localStorage.setItem(STORAGE_KEY, '600');
    failOnlyForTheWidth('getItem');
    mount({ initial: 'widget' });
    expect(separator()!.getAttribute('aria-valuenow')).toBe('420');
  });

  it('still changes the width when the storage cannot be written (setItem throws)', () => {
    failOnlyForTheWidth('setItem');
    mount({ initial: 'widget' });
    fireEvent.keyDown(separator()!, { key: 'End' });
    expect(separator()!.getAttribute('aria-valuenow')).toBe('720');
    expect(variable('--hai-panel-width')).toBe('720px');
  });

  it('ignores a stored value that is not only a number', () => {
    window.localStorage.setItem(STORAGE_KEY, '{"width":600}');
    mount({ initial: 'widget' });
    expect(separator()!.getAttribute('aria-valuenow')).toBe('420');
  });
});

describe('the HAI symbol and the voice figure follow the panel', () => {
  it('sits at the bottom right of the page that is left, next to the panel, and follows its width', () => {
    mount();
    // closed: 1.5rem from the edge (right-6), as without a panel
    expect(anchor().getAttribute('data-docked')).toBe('true');
    expect(anchor().className).toContain(
      'right-[calc(var(--hai-dock-inset,0px)+1.5rem)]'
    );
    expect(anchor().className).not.toContain('right-4');
    expect(variable('--hai-dock-inset', anchor())).toBe('0px');
    fireEvent.click(handle());
    expect(variable('--hai-dock-inset', anchor())).toBe('420px');
    // not shifted by a transform any more
    expect(anchor().className).not.toContain('translate-x');
  });

  it('follows the width while it is pulled, with the same variable', async () => {
    mount({ initial: 'widget' });
    const grip = separator()!;
    fireEvent.pointerDown(grip, { clientX: 1000, pointerId: 7 });
    fireEvent.pointerMove(grip, { clientX: 900, pointerId: 7 });
    flushFrames();
    expect(variable('--hai-dock-inset', anchor())).toBe('520px');
    expect(variable('--hai-dock-ms', anchor())).toBe('0ms');
    fireEvent.pointerUp(grip, { clientX: 900, pointerId: 7 });
    expect(variable('--hai-dock-inset', anchor())).toBe('520px');
    expect(variable('--hai-dock-ms', anchor())).toBe('280ms');
  });

  it('stays clickable and keeps aria-expanded and aria-controls', async () => {
    mount();
    expect(handle().getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(handle());
    await waitFor(() => expect(panel()).not.toBeNull());
    expect(handle().getAttribute('aria-expanded')).toBe('true');
    expect(handle().getAttribute('aria-controls')).toBe(panel()!.id);
    expect((handle() as HTMLButtonElement).disabled).toBe(false);
    // not inside the panel: it hides neither the input nor the send button
    expect(panel()!.contains(handle())).toBe(false);
    expect(column().contains(handle())).toBe(false);
  });

  it('rides on the sheet as before when the panel does not dock', () => {
    setWindowWidth(600);
    mount({ initial: 'widget' });
    expect(anchor().getAttribute('data-docked')).toBe('false');
    expect(anchor().className).not.toContain('--hai-dock-inset');
    expect(anchor().className).toContain('right-4');
    expect(anchor().className).toContain('md:-translate-x-[420px]');
  });

  it('puts the voice figure at the same place, left of the panel', () => {
    const session = {
      view: 'open',
      available: true,
      captions: true,
      setCaptions: jest.fn(),
      offer: null,
      openNavigation: jest.fn(),
      closeMode: jest.fn(),
      openMode: jest.fn(),
      acceptConsent: jest.fn(),
      muted: false,
      toggleMic: jest.fn(),
      voice: {
        available: true,
        phase: 'listening',
        error: null,
        level: null,
        interim: '',
        heard: '',
        spoken: [],
        consented: true,
        chain: ['sokrates'],
        region: 'eu',
        fallback: null,
        live: true,
        micOpen: true,
        interrupt: jest.fn(),
        start: jest.fn(),
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const {
      HaiVoiceModeOverlay,
    } = require('@/components/hai/voice-mode/HaiVoiceModeOverlay');
    renderWithProviders(
      <SidebarProvider>
        <HaiQuizModeProvider>
          <HaiDouble initial="widget">
            <SessionContext.Provider value={session as never}>
              <DockHost>
                <MainLayout
                  profile={null}
                  onGoBack={() => {}}
                  sidebarOpen={false}
                  onToggleSidebar={() => {}}
                  userRole="trainee"
                >
                  <Page />
                </MainLayout>
                <HaiButton />
                <HaiChat />
                <HaiVoiceModeOverlay />
              </DockHost>
            </SessionContext.Provider>
          </HaiDouble>
        </HaiQuizModeProvider>
      </SidebarProvider>
    );
    const figure = screen.getByTestId('hai-voice-figure');
    expect(figure.className).toContain(
      'right-[calc(var(--hai-dock-inset,0px)+1.5rem)]'
    );
    expect(variable('--hai-dock-inset', figure)).toBe('420px');
    // the panel stays open at 1280 px (below 1024 px it makes room, HaiChat)
    expect(panel()).not.toBeNull();
    expect(within(figure).getByTestId('hai-voice-mic')).not.toBeNull();
  });
});

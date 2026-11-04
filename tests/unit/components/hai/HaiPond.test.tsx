import React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
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
import { HaiWrapper } from '@/components/hai/HaiWrapper';
import { useAuth } from '@/contexts/AuthContext';
import { useCatalog } from '@/contexts/CatalogContext';
import { SidebarProvider } from '@/contexts/SidebarContext';

// The HAI figure always stands in its pond, whatever the width of the panel.
// The pond is the grown HAI symbol (HaiButton), the figure is rendered by the
// voice session in a portal (HaiVoiceModeOverlay). Both read the same anchor
// (haiLayout.ts, useHaiAnchor) and the same dock variables. A portal keeps the
// context of the place where it is rendered, so what counts here is the order
// of the providers in HaiWrapper: the figure was once rendered above the dock
// provider and stood at a fixed offset, next to the pond, as soon as the panel
// was wider or narrower than 420 px. This test renders the REAL HaiWrapper (the
// real order of its providers), only the chat provider, the voice loop and the
// lazy loading are doubles. Modules under test: HaiWrapper, haiLayout,
// HaiDockContext, HaiButton, HaiVoiceModeOverlay.

// the first test loads the lazy components, which can take longer on a busy machine
jest.setTimeout(30000);

jest.mock('@/contexts/AuthContext');
jest.mock('@/contexts/CatalogContext');
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
jest.mock('@/components/layout/Header', () => ({ Header: () => null }));
jest.mock('@/components/layout/Sidebar', () => ({ Sidebar: () => null }));
jest.mock('@/components/catalog/CatalogTabs', () => ({
  CatalogTabs: () => null,
}));

// next/dynamic: the real components, loaded at once
jest.mock('next/dynamic', () => ({
  __esModule: true,
  default: (loader: () => Promise<React.ComponentType<object>>) => {
    const R = jest.requireActual('react') as typeof React;
    const Lazy = R.lazy(() =>
      loader().then(component => ({ default: component }))
    );
    return function Dynamic(props: object) {
      return (
        <R.Suspense fallback={null}>
          <Lazy {...props} />
        </R.Suspense>
      );
    };
  },
}));

// the chat provider: a double with the view mode, as HaiDock.test.tsx
jest.mock('@/components/hai/HaiProvider', () => {
  const R = jest.requireActual('react') as typeof React;
  const Ctx = R.createContext<unknown>(null);
  function HaiProvider({ children }: { children: React.ReactNode }) {
    const [viewMode, setViewMode] = R.useState('widget');
    const value = {
      viewMode,
      setViewMode,
      toggleChat: () =>
        setViewMode((v: string) => (v === 'hidden' ? 'widget' : 'hidden')),
      messages: [{ id: 'm1', role: 'user', content: 'Frage', timestamp: 'x' }],
      sessions: [],
      sendMessage: () => undefined,
      stopGeneration: () => undefined,
      isLoading: false,
      streamingMessageId: null,
      context: {},
      newSession: () => undefined,
    };
    return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
  }
  return {
    __esModule: true,
    HaiProvider,
    useHai: () => R.useContext(Ctx),
  };
});

// The voice session: what HaiVoiceSessionProvider does with the figure, nothing
// else (the real one renders the overlay as a sibling of its children). The
// view is switched by the test, the voice loop is not needed here.
const mockSession = {
  setView: null as null | ((view: 'open' | 'closed') => void),
};
jest.mock('@/components/hai/voice-mode/HaiVoiceSession', () => {
  const R = jest.requireActual('react') as typeof React;
  const { SessionContext } = jest.requireActual(
    '@/components/hai/voice-mode/voiceSessionContext'
  ) as typeof import('@/components/hai/voice-mode/voiceSessionContext');
  const { HaiVoiceModeOverlay } = jest.requireActual(
    '@/components/hai/voice-mode/HaiVoiceModeOverlay'
  ) as typeof import('@/components/hai/voice-mode/HaiVoiceModeOverlay');
  const noop = () => undefined;
  const voice = {
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
    interrupt: noop,
    start: noop,
  };
  function HaiVoiceSessionProvider({
    children,
  }: {
    children: React.ReactNode;
  }) {
    const [view, setView] = R.useState<'open' | 'closed'>('closed');
    mockSession.setView = setView;
    const value = {
      voice,
      available: true,
      view,
      captions: true,
      setCaptions: noop,
      offer: null,
      openNavigation: noop,
      openMode: () => setView('open'),
      closeMode: () => setView('closed'),
      muted: false,
      toggleMic: noop,
      acceptConsent: noop,
    };
    return (
      <SessionContext.Provider value={value as never}>
        {children}
        <HaiVoiceModeOverlay />
      </SessionContext.Provider>
    );
  }
  return { __esModule: true, HaiVoiceSessionProvider };
});

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

const originalInnerWidth = window.innerWidth;

function Shell() {
  return (
    <SidebarProvider>
      <HaiWrapper>
        <MainLayout
          profile={null}
          onGoBack={() => {}}
          sidebarOpen={false}
          onToggleSidebar={() => {}}
          userRole="trainee"
        >
          <p>Seite</p>
        </MainLayout>
      </HaiWrapper>
    </SidebarProvider>
  );
}

async function mount() {
  renderWithProviders(<Shell />);
  // the lazy button and chat are loaded
  await waitFor(() => expect(handle()).not.toBeNull());
  await waitFor(() => expect(panel()).not.toBeNull());
}

const handle = () => document.querySelector<HTMLElement>('[data-hai-handle]');
const pond = () =>
  document.querySelector<HTMLElement>('[data-hai-anchor]') as HTMLElement;
const figure = () => screen.getByTestId('hai-voice-figure');
const panel = () => screen.queryByTestId('hai-chat-panel');
const separator = () => screen.getByRole('separator');
const openVoice = () => act(() => mockSession.setView!('open'));

/** What the anchor of the pond or the figure reads from the dock. */
const vars = (element: HTMLElement) => ({
  width: element.style.getPropertyValue('--hai-panel-width'),
  inset: element.style.getPropertyValue('--hai-dock-inset'),
  ms: element.style.getPropertyValue('--hai-dock-ms'),
});

// the classes that place the anchor (not the ones of what is inside of it)
const NOT_PLACEMENT = new Set([
  'flex',
  'flex-col',
  'items-end',
  'gap-2',
  'pointer-events-none',
]);
const placement = (element: HTMLElement) =>
  element.className
    .split(/\s+/)
    .filter(token => token && !NOT_PLACEMENT.has(token))
    .sort();

/** Pond and figure sit on the same place: same classes, same variables. */
function expectSamePlace() {
  expect(placement(figure())).toEqual(placement(pond()));
  expect(vars(figure())).toEqual(vars(pond()));
}

beforeAll(() => {
  Element.prototype.scrollIntoView = jest.fn();
  (window as unknown as { PointerEvent: unknown }).PointerEvent =
    TestPointerEvent;
});

beforeEach(() => {
  frames = [];
  (useCatalog as jest.Mock).mockReturnValue({ tabs: [], epoch: 0 });
  (useAuth as jest.Mock).mockReturnValue({
    user: { id: 'u1' },
    profile: { id: 'u1', role: 'trainee', trainerActivated: true },
    subscriptionPlan: 'PRO',
  });
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
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: originalInnerWidth,
  });
  jest.restoreAllMocks();
});

describe('the HAI figure stands in its pond (panel docked, HaiWrapper)', () => {
  it('knows the dock like the pond does: same classes and same variables from the start', async () => {
    await mount();
    await openVoice();
    expect(figure().getAttribute('data-phase')).toBe('live');
    // the figure is docked: its right edge follows the variable, not a fixed offset
    expect(figure().className).toContain(
      'right-[calc(var(--hai-dock-inset,0px)+1.5rem)]'
    );
    expect(figure().className).not.toContain('translate-x');
    expect(vars(figure()).inset).toBe('420px');
    expectSamePlace();
  });

  it('follows a width chosen by key, wider and narrower, to the same pixel as the pond', async () => {
    await mount();
    await openVoice();
    for (const [key, shiftKey, inset] of [
      ['ArrowLeft', false, '444px'],
      ['ArrowLeft', true, '540px'],
      ['End', false, '720px'],
      ['ArrowRight', false, '696px'],
      ['Home', false, '320px'],
    ] as const) {
      fireEvent.keyDown(separator(), { key, shiftKey });
      expect(vars(pond()).inset).toBe(inset);
      expect(vars(figure()).inset).toBe(inset);
      expectSamePlace();
    }
  });

  it('follows the width while it is pulled (live, without a transition) and after it is released', async () => {
    await mount();
    await openVoice();
    const grip = separator();
    fireEvent.pointerDown(grip, { clientX: 1000, pointerId: 7 });
    fireEvent.pointerMove(grip, { clientX: 800, pointerId: 7 });
    flushFrames();
    expect(vars(figure())).toEqual({
      width: '620px',
      inset: '620px',
      ms: '0ms',
    });
    expectSamePlace();
    fireEvent.pointerMove(grip, { clientX: 1100, pointerId: 7 });
    flushFrames();
    expect(vars(figure()).inset).toBe('320px');
    expectSamePlace();
    fireEvent.pointerUp(grip, { clientX: 1100, pointerId: 7 });
    expect(vars(figure())).toEqual({
      width: '320px',
      inset: '320px',
      ms: '280ms',
    });
    expectSamePlace();
  });

  it('follows the reset by double click', async () => {
    await mount();
    await openVoice();
    fireEvent.keyDown(separator(), { key: 'End' });
    expect(vars(figure()).inset).toBe('720px');
    fireEvent.doubleClick(separator());
    expect(vars(figure()).inset).toBe('420px');
    expectSamePlace();
  });

  it('follows a change of the window size (the chosen width is limited again)', async () => {
    await mount();
    await openVoice();
    fireEvent.keyDown(separator(), { key: 'End' });
    expect(vars(figure()).inset).toBe('720px');
    // 1000 px: the page keeps 480 px, the panel may be 520 px at most
    setWindowWidth(1000);
    expect(vars(pond()).inset).toBe('520px');
    expect(vars(figure()).inset).toBe('520px');
    expectSamePlace();
    setWindowWidth(1280);
    expect(vars(figure()).inset).toBe('720px');
    expectSamePlace();
  });

  it('goes in and out with the panel: the figure stays open and keeps the pond', async () => {
    await mount();
    await openVoice();
    fireEvent.keyDown(separator(), { key: 'End' });
    expectSamePlace();
    fireEvent.click(handle()!);
    // the column gives the room back at once (the panel itself slides out)
    expect(vars(pond()).inset).toBe('0px');
    expect(vars(figure()).inset).toBe('0px');
    expectSamePlace();
    fireEvent.click(handle()!);
    expect(vars(figure()).inset).toBe('720px');
    expectSamePlace();
  });

  it('keeps the pond while it dives in (DivingFigure) and for a new width', async () => {
    await mount();
    await openVoice();
    fireEvent.keyDown(separator(), { key: 'ArrowLeft', shiftKey: true });
    act(() => mockSession.setView!('closed'));
    expect(figure().getAttribute('data-phase')).toBe('diving');
    expect(vars(figure()).inset).toBe('516px');
    expectSamePlace();
    fireEvent.keyDown(separator(), { key: 'End' });
    expect(vars(figure()).inset).toBe('720px');
    expectSamePlace();
  });

  it('a figure that opens later reads the width that is set right now', async () => {
    await mount();
    fireEvent.keyDown(separator(), { key: 'End' });
    await openVoice();
    expect(vars(figure()).inset).toBe('720px');
    expectSamePlace();
  });
});

describe('the HAI figure stands in its pond (sheet over the page)', () => {
  it('uses the anchor of the sheet like the pond (under 768 px, a phone)', async () => {
    setWindowWidth(600);
    await mount();
    await openVoice();
    expect(pond().getAttribute('data-docked')).toBe('false');
    expect(figure().className).toContain('right-4');
    expect(figure().className).not.toContain('--hai-dock-inset');
    expect(figure().className).toContain('md:-translate-x-[420px]');
    expectSamePlace();
  });

  it('has no panel next to the pond with the panel closed (phone, the sheet put away)', async () => {
    setWindowWidth(390);
    await mount();
    // the panel is put away: the sheet does not shift the symbol any more
    fireEvent.click(handle()!);
    await openVoice();
    expect(figure().className).not.toContain('md:-translate-x-[420px]');
    expect(pond().className).not.toContain('md:-translate-x-[420px]');
    expectSamePlace();
  });
});

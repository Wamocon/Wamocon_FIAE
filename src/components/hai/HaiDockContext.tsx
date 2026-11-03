'use client';

/**
 * The docked HAI panel as a part of the app layout.
 *
 * Open, the panel is a column at the right edge of the layout (MainLayout),
 * the header and the page make room for it. This file holds what the layout,
 * the panel, the HAI symbol and the voice figure share:
 *
 *  - the width (chosen by the person, kept in localStorage, limited by the
 *    window, see haiDock.ts),
 *  - whether the panel docks at all (a phone and a window that is too narrow
 *    keep the sheet over the page),
 *  - three CSS variables (--hai-panel-width, --hai-dock-inset, --hai-dock-ms)
 *    that are written straight onto the elements that use them (the layout,
 *    the symbol, the figure). While the panel is pulled, only these variables
 *    change (one write per animation frame), nothing in React renders; the
 *    width goes into the state when the pointer is released.
 *
 * Two contexts: the registry (stable functions, MainLayout reads only this and
 * never re-renders for a width) and the state (the panel, the column and the
 * handle read it).
 *
 * It must not import the chat provider (the layout loads this file, the chat
 * is loaded lazily): the wrapper tells the provider whether the panel is open.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { usePrefersReducedMotion } from './voice-mode/usePrefersReducedMotion';
import {
  DOCK_ANIMATION_MS,
  DOCK_DEFAULT_WIDTH,
  HAI_DOCK_INSET_VAR,
  HAI_DOCK_MS_VAR,
  HAI_PANEL_WIDTH_VAR,
  clampDockWidth,
  dockLimits,
  readStoredDockWidth,
  writeStoredDockWidth,
} from './haiDock';

// no layout effect warning when the wrapper renders on the server
const useIsomorphicLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect;

export interface HaiDockRegistry {
  /** An element that reads the variables (layout, symbol, figure): they are written onto it. */
  register: (element: HTMLElement) => void;
  unregister: (element: HTMLElement) => void;
  /** The column of the layout the panel is rendered into. */
  slotRef: (element: HTMLElement | null) => void;
  /** The open navigation takes room next to the page from lg up. */
  setSidebarOpen: (open: boolean) => void;
}

export interface HaiDockState {
  /** The panel is a column of the layout (else the sheet over the page). */
  docked: boolean;
  /** The column is open: docked and the panel is shown. */
  open: boolean;
  width: number;
  min: number;
  max: number;
  slotEl: HTMLElement | null;
  /** The pointer is down on the handle: no transition until it is released. */
  startDrag: () => void;
  /** Live width while pulling: variables only, one write per frame. Returns the limited width. */
  previewWidth: (width: number) => number;
  /** Final width (pointer released, key, double click): state and storage. */
  commitWidth: (width: number) => void;
  /** The pull ended without a result (cancelled, handle gone). */
  cancelDrag: () => void;
  resetWidth: () => void;
}

const RegistryContext = createContext<HaiDockRegistry | null>(null);
const StateContext = createContext<HaiDockState | null>(null);

interface Values {
  width: number;
  inset: number;
  ms: number;
}

function writeVars(element: HTMLElement, values: Values) {
  element.style.setProperty(HAI_PANEL_WIDTH_VAR, `${values.width}px`);
  element.style.setProperty(HAI_DOCK_INSET_VAR, `${values.inset}px`);
  element.style.setProperty(HAI_DOCK_MS_VAR, `${values.ms}ms`);
}

export function HaiDockProvider({
  open,
  children,
}: {
  /** The text chat is shown as a panel (not hidden, not full screen). */
  open: boolean;
  children: ReactNode;
}) {
  const reduced = usePrefersReducedMotion();
  const [slotEl, setSlotEl] = useState<HTMLElement | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [viewport, setViewport] = useState(() =>
    typeof window === 'undefined' ? 0 : window.innerWidth
  );
  // what the person chose last (limited to the absolute limits when read)
  const [preferred, setPreferred] = useState(readStoredDockWidth);

  const limits = useMemo(
    () => dockLimits(viewport, sidebarOpen),
    [viewport, sidebarOpen]
  );
  // limited again for every window size: the chosen width comes back when the window grows
  const width = clampDockWidth(preferred, limits);
  const docked = limits.docked && slotEl !== null;
  const columnOpen = docked && open;
  const inset = columnOpen ? width : 0;
  const ms = reduced ? 0 : DOCK_ANIMATION_MS;

  const targets = useRef(new Set<HTMLElement>());
  // what is written onto the elements right now (a pull writes ahead of the state)
  const current = useRef<Values>({ width, inset, ms });
  // what the state says
  const committed = useRef<Values>({ width, inset, ms });
  const dragging = useRef(false);
  const frame = useRef<number | null>(null);
  // the width of the latest pointer move, the frame writes it when it runs
  const pending = useRef(0);
  // the latest values for the functions below, which must stay the same functions
  const live = useRef({ min: limits.min, max: limits.max, columnOpen, ms });

  const applyAll = useCallback((values: Values) => {
    current.current = values;
    targets.current.forEach(element => writeVars(element, values));
  }, []);

  const cancelFrame = useCallback(() => {
    if (frame.current !== null) {
      window.cancelAnimationFrame(frame.current);
      frame.current = null;
    }
  }, []);

  // the state is the source of the variables, unless the pointer pulls right now
  useIsomorphicLayoutEffect(() => {
    live.current = { min: limits.min, max: limits.max, columnOpen, ms };
    committed.current = { width, inset, ms };
    if (dragging.current) return;
    applyAll(committed.current);
  }, [applyAll, limits.min, limits.max, columnOpen, ms, width, inset]);

  useEffect(() => {
    const onResize = () => setViewport(window.innerWidth);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => cancelFrame, [cancelFrame]);

  const registry = useMemo<HaiDockRegistry>(
    () => ({
      register: element => {
        targets.current.add(element);
        writeVars(element, current.current);
      },
      unregister: element => {
        targets.current.delete(element);
      },
      slotRef: setSlotEl,
      setSidebarOpen,
    }),
    []
  );

  const startDrag = useCallback(() => {
    dragging.current = true;
    applyAll({ ...current.current, ms: 0 });
  }, [applyAll]);

  const previewWidth = useCallback(
    (next: number) => {
      const clamped = clampDockWidth(next, live.current);
      dragging.current = true;
      pending.current = clamped;
      if (frame.current === null) {
        frame.current = window.requestAnimationFrame(() => {
          frame.current = null;
          applyAll({
            width: pending.current,
            inset: live.current.columnOpen ? pending.current : 0,
            ms: 0,
          });
        });
      }
      return clamped;
    },
    [applyAll]
  );

  const settle = useCallback(
    (next: number) => {
      cancelFrame();
      dragging.current = false;
      applyAll({
        width: next,
        inset: live.current.columnOpen ? next : 0,
        ms: live.current.ms,
      });
    },
    [applyAll, cancelFrame]
  );

  const commitWidth = useCallback(
    (next: number) => {
      const clamped = clampDockWidth(next, live.current);
      settle(clamped);
      setPreferred(clamped);
      writeStoredDockWidth(clamped);
    },
    [settle]
  );

  const cancelDrag = useCallback(() => {
    cancelFrame();
    dragging.current = false;
    applyAll(committed.current);
  }, [applyAll, cancelFrame]);

  const resetWidth = useCallback(
    () => commitWidth(DOCK_DEFAULT_WIDTH),
    [commitWidth]
  );

  const state = useMemo<HaiDockState>(
    () => ({
      docked,
      open: columnOpen,
      width,
      min: limits.min,
      max: limits.max,
      slotEl,
      startDrag,
      previewWidth,
      commitWidth,
      cancelDrag,
      resetWidth,
    }),
    [
      docked,
      columnOpen,
      width,
      limits.min,
      limits.max,
      slotEl,
      startDrag,
      previewWidth,
      commitWidth,
      cancelDrag,
      resetWidth,
    ]
  );

  return (
    <RegistryContext.Provider value={registry}>
      <StateContext.Provider value={state}>{children}</StateContext.Provider>
    </RegistryContext.Provider>
  );
}

/** Stable functions only: a component that reads this never renders for a width. */
export function useHaiDockRegistry(): HaiDockRegistry | null {
  return useContext(RegistryContext);
}

/** The state of the dock, or null outside of the provider (no layout, tests). */
export function useOptionalHaiDock(): HaiDockState | null {
  return useContext(StateContext);
}

/**
 * A ref for an element that reads the dock variables: the variables are
 * written onto it while it is mounted. Without a provider it does nothing.
 */
export function useHaiDockVars(): (element: HTMLElement | null) => void {
  const registry = useHaiDockRegistry();
  const previous = useRef<HTMLElement | null>(null);
  return useCallback(
    (element: HTMLElement | null) => {
      if (previous.current) registry?.unregister(previous.current);
      previous.current = element;
      if (element) registry?.register(element);
    },
    [registry]
  );
}

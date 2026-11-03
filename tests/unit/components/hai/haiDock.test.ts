import { describe, it, expect, afterEach, jest } from '@jest/globals';
import {
  DOCK_DEFAULT_WIDTH,
  HAI_PANEL_WIDTH_KEY,
  clampDockWidth,
  dockLimits,
  readStoredDockWidth,
  widthForKey,
  writeStoredDockWidth,
} from '@/components/hai/haiDock';

// The rules of the docked HAI panel: where it docks, how wide it may be, what
// is kept in the storage and what the keys on the separator do.

afterEach(() => {
  window.localStorage.clear();
  jest.restoreAllMocks();
});

describe('dockLimits: where the panel may dock and how wide it may be', () => {
  it('is a sheet below 768 px (a phone)', () => {
    expect(dockLimits(390, false).docked).toBe(false);
    expect(dockLimits(767, false).docked).toBe(false);
  });

  it('docks from 768 px up, with a narrower minimum below 1024 px', () => {
    const tablet = dockLimits(800, false);
    expect(tablet.docked).toBe(true);
    expect(tablet.min).toBe(288);
    expect(dockLimits(1024, false).min).toBe(320);
    expect(dockLimits(1280, false).min).toBe(320);
  });

  it('keeps 480 px for the page: 768 px leaves exactly the minimum panel', () => {
    const edge = dockLimits(768, false);
    expect(edge.docked).toBe(true);
    expect(edge.max).toBe(768 - 480);
    expect(edge.min).toBe(edge.max);
  });

  it('caps the width at 720 px', () => {
    expect(dockLimits(1920, false).max).toBe(720);
    expect(dockLimits(2560, true).max).toBe(720);
  });

  it('caps the width at 60 percent of the window', () => {
    // 1100 px: 60 percent are 660, the page would keep 620
    expect(dockLimits(1100, false).max).toBe(620);
    // 1000 px: 60 percent are 600, the page would keep 520: the 480 px rule is stricter
    expect(dockLimits(1000, false).max).toBe(520);
    // 1400 px: 60 percent are 840, the 720 px cap is stricter
    expect(dockLimits(1400, false).max).toBe(720);
  });

  it('takes the open navigation from lg up out of the room of the page', () => {
    expect(dockLimits(1280, false).max).toBe(720);
    // 1280 - 288 (navigation) - 480 (page)
    expect(dockLimits(1280, true).max).toBe(512);
    // below lg the navigation is a sheet over the page and takes no room
    expect(dockLimits(900, true).max).toBe(dockLimits(900, false).max);
  });

  it('is an overlay when the page would keep less than 480 px even with the minimum', () => {
    // 1024 px with the navigation open: 1024 - 288 - 480 = 256 px, less than 320 px
    expect(dockLimits(1024, true).docked).toBe(false);
    // the same window with the navigation closed docks
    expect(dockLimits(1024, false).docked).toBe(true);
  });
});

describe('clampDockWidth', () => {
  const limits = { min: 320, max: 720 };
  it('keeps the width inside the limits and in whole pixels', () => {
    expect(clampDockWidth(100, limits)).toBe(320);
    expect(clampDockWidth(5000, limits)).toBe(720);
    expect(clampDockWidth(433.6, limits)).toBe(434);
  });
  it('turns something that is not a number into the default', () => {
    expect(clampDockWidth(Number.NaN, limits)).toBe(DOCK_DEFAULT_WIDTH);
    expect(clampDockWidth(Number.POSITIVE_INFINITY, limits)).toBe(
      DOCK_DEFAULT_WIDTH
    );
  });
});

describe('the storage of the width', () => {
  it('uses the key hai-panel-width', () => {
    expect(HAI_PANEL_WIDTH_KEY).toBe('hai-panel-width');
  });

  it('writes only the number', () => {
    writeStoredDockWidth(512.4);
    expect(window.localStorage.getItem('hai-panel-width')).toBe('512');
  });

  it('reads it back', () => {
    window.localStorage.setItem('hai-panel-width', '560');
    expect(readStoredDockWidth()).toBe(560);
  });

  it('limits what it reads to 320 and 720 px', () => {
    window.localStorage.setItem('hai-panel-width', '90');
    expect(readStoredDockWidth()).toBe(320);
    window.localStorage.setItem('hai-panel-width', '9000');
    expect(readStoredDockWidth()).toBe(720);
  });

  it.each(['', 'abc', '420px', '-5', '4.5', '{"w":420}', 'NaN'])(
    'takes the default for the value %p (only a number is accepted)',
    value => {
      window.localStorage.setItem('hai-panel-width', value);
      expect(readStoredDockWidth()).toBe(DOCK_DEFAULT_WIDTH);
    }
  );

  it('takes the default when nothing is stored', () => {
    expect(readStoredDockWidth()).toBe(DOCK_DEFAULT_WIDTH);
  });

  it('does not throw when the storage cannot be read (blocked, private window)', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readStoredDockWidth()).toBe(DOCK_DEFAULT_WIDTH);
  });

  it('does not throw when the storage cannot be written (full, blocked)', () => {
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => writeStoredDockWidth(500)).not.toThrow();
  });
});

describe('widthForKey: the keys on the separator', () => {
  const limits = { min: 320, max: 720 };

  it('makes the panel wider with arrow left (24 px) and narrower with arrow right', () => {
    expect(widthForKey('ArrowLeft', false, 420, limits)).toBe(444);
    expect(widthForKey('ArrowRight', false, 420, limits)).toBe(396);
  });

  it('steps by 96 px with Shift', () => {
    expect(widthForKey('ArrowLeft', true, 420, limits)).toBe(516);
    expect(widthForKey('ArrowRight', true, 420, limits)).toBe(324);
  });

  it('stays inside the limits', () => {
    expect(widthForKey('ArrowLeft', true, 700, limits)).toBe(720);
    expect(widthForKey('ArrowRight', true, 330, limits)).toBe(320);
  });

  it('goes to the minimum with Home and to the maximum with End', () => {
    expect(widthForKey('Home', false, 500, limits)).toBe(320);
    expect(widthForKey('End', false, 500, limits)).toBe(720);
  });

  it('leaves every other key alone', () => {
    expect(widthForKey('Enter', false, 420, limits)).toBeNull();
    expect(widthForKey('ArrowUp', false, 420, limits)).toBeNull();
    expect(widthForKey('a', false, 420, limits)).toBeNull();
  });
});

import { act, renderHook } from '@testing-library/react';
import { useThrottledAnnouncement } from '@/components/admin/content-upload/useAnnouncer';

describe('useThrottledAnnouncement', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-28T10:00:00Z'));
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('sets the first message at once', () => {
    const { result } = renderHook(() => useThrottledAnnouncement(5000));
    act(() => result.current[1]('eins'));
    expect(result.current[0]).toBe('eins');
  });

  it('holds back what comes within the interval and sets only the latest one at its end', () => {
    const { result } = renderHook(() => useThrottledAnnouncement(5000));
    act(() => result.current[1]('eins'));
    act(() => {
      jest.advanceTimersByTime(1000);
      result.current[1]('zwei');
      jest.advanceTimersByTime(1000);
      result.current[1]('drei');
    });
    expect(result.current[0]).toBe('eins');
    act(() => {
      jest.advanceTimersByTime(3000);
    });
    expect(result.current[0]).toBe('drei');
  });

  it('sets a message that is immediate at once and drops what was waiting', () => {
    const { result } = renderHook(() => useThrottledAnnouncement(5000));
    act(() => result.current[1]('eins'));
    act(() => result.current[1]('wartet'));
    act(() => result.current[1]('Fehler', true));
    expect(result.current[0]).toBe('Fehler');
    act(() => {
      jest.advanceTimersByTime(10_000);
    });
    expect(result.current[0]).toBe('Fehler');
  });

  it('sets a new message after the interval without a delay', () => {
    const { result } = renderHook(() => useThrottledAnnouncement(5000));
    act(() => result.current[1]('eins'));
    act(() => {
      jest.advanceTimersByTime(5001);
      result.current[1]('zwei');
    });
    expect(result.current[0]).toBe('zwei');
  });

  it('does not set anything after the end of the component', () => {
    const { result, unmount } = renderHook(() =>
      useThrottledAnnouncement(5000)
    );
    act(() => result.current[1]('eins'));
    act(() => result.current[1]('zwei'));
    unmount();
    expect(() => jest.advanceTimersByTime(6000)).not.toThrow();
  });
});

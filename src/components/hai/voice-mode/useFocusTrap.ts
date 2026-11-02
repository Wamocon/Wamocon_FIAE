'use client';

/**
 * Keeps the focus inside a dialog while it is open (Tab and Shift+Tab walk in
 * a circle), puts the focus on the first element marked `data-autofocus` (or
 * the first focusable one) when it opens, and gives the focus back to the
 * element that had it before when the dialog closes.
 */

import { useEffect, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    el =>
      !el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true'
  );
}

export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  active: boolean
) {
  useEffect(() => {
    const root = ref.current;
    if (!active || !root) return;
    const opener = document.activeElement as HTMLElement | null;

    const first =
      root.querySelector<HTMLElement>('[data-autofocus]') ??
      focusables(root)[0] ??
      root;
    first.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = focusables(root);
      if (items.length === 0) {
        event.preventDefault();
        root.focus();
        return;
      }
      const head = items[0];
      const tail = items[items.length - 1];
      const current = document.activeElement;
      if (event.shiftKey && (current === head || !root.contains(current))) {
        event.preventDefault();
        tail.focus();
      } else if (
        !event.shiftKey &&
        (current === tail || !root.contains(current))
      ) {
        event.preventDefault();
        head.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [ref, active]);
}

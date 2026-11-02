import { useEffect, useRef } from 'react';

// Open dialogs in the order they were opened. Escape closes only the one on
// top, so a confirmation inside a dialog does not close the dialog below it.
const openDialogs: symbol[] = [];

/**
 * Closes a dialog with the Escape key. Every dialog of the platform uses it, so
 * they all behave the same. While several dialogs are open only the last
 * opened one answers. `active` switches the handler off, for example while a
 * request is running and the dialog must stay open.
 */
export function useEscapeKey(onEscape: () => void, active = true) {
  const handler = useRef(onEscape);
  handler.current = onEscape;

  useEffect(() => {
    if (!active) return;
    const id = Symbol('dialog');
    openDialogs.push(id);
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (openDialogs[openDialogs.length - 1] !== id) return;
      event.stopPropagation();
      handler.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      const index = openDialogs.indexOf(id);
      if (index !== -1) openDialogs.splice(index, 1);
    };
  }, [active]);
}

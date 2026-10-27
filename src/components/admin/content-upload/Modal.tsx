'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type Props = {
  /** Id of the heading inside the dialog, names the dialog. */
  titleId: string;
  /** Id of the text that describes the dialog (optional). */
  descriptionId?: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
};

/**
 * A dialog that keeps the focus: it takes the focus when it opens, keeps Tab and
 * Shift+Tab inside, closes with Escape and gives the focus back to what had it
 * before. It sits in a portal under the body, so a transform of the page (the
 * hover of a card) cannot shift it.
 */
export function Modal({
  titleId,
  descriptionId,
  onClose,
  children,
  className = '',
}: Props) {
  const dialog = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const node = dialog.current;
    const focusables = () =>
      node
        ? Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
            el => !el.matches(':disabled')
          )
        : [];
    // The first control that is not a plain close button, else the dialog itself
    const first = focusables().find(
      el => el.dataset.initialFocus !== undefined
    );
    (first ?? focusables()[0] ?? node)?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !node) return;
      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        node.focus();
        return;
      }
      const head = items[0];
      const tail = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === head || active === node)) {
        event.preventDefault();
        tail.focus();
      } else if (!event.shiftKey && active === tail) {
        event.preventDefault();
        head.focus();
      } else if (active && !node.contains(active)) {
        event.preventDefault();
        head.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      // the opener may be disabled or gone by now (a mass action empties the
      // selection): the list is the next best place for the focus
      if (before && before.isConnected && !before.matches(':disabled')) {
        before.focus();
      } else {
        document.getElementById('review-list')?.focus();
      }
    };
  }, []);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className={`bg-card text-foreground border-border max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border p-6 shadow-2xl focus:outline-none ${className}`}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}

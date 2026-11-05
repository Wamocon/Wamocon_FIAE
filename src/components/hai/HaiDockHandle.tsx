'use client';

/**
 * The grip at the left edge of the docked HAI panel: a separator the person
 * pulls (mouse and touch) to make the panel wider or narrower.
 *
 *  - Pointer: pointerdown captures the pointer, pointermove changes the width
 *    (only CSS variables, one write per animation frame, HaiDockContext), the
 *    release puts the width into the state and the storage.
 *  - While pulling, the text is not selectable, the cursor stays a column
 *    resize cursor and a transparent guard covers the whole window, so an
 *    iframe under the pointer (the PDF viewer of the trainer) cannot swallow
 *    the pointer events and the pull does not hang.
 *  - Keys (the handle is focusable): arrow left/right change the width by
 *    24 px (96 px with Shift), Home and End go to the minimum and the maximum.
 *    The panel is at the right edge, so arrow left makes it wider.
 *  - Double click: back to the default width (420 px).
 */

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { widthForKey } from './haiDock';
import { useOptionalHaiDock } from './HaiDockContext';
import { HAI_PANEL_ID } from './haiLayout';

export function HaiDockHandle() {
  const dock = useOptionalHaiDock();
  const { t } = useLanguage();
  const separatorRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
    width: number;
  } | null>(null);
  const [pulling, setPulling] = useState(false);

  // while pulling: no text selection, one cursor, also when the pointer leaves the handle
  useEffect(() => {
    if (!pulling) return;
    const { body } = document;
    const before = { select: body.style.userSelect, cursor: body.style.cursor };
    body.style.userSelect = 'none';
    body.style.cursor = 'col-resize';
    return () => {
      body.style.userSelect = before.select;
      body.style.cursor = before.cursor;
    };
  }, [pulling]);

  // the handle goes away while pulling (the panel closes): the pull is over
  const cancelDrag = dock?.cancelDrag;
  useEffect(
    () => () => {
      if (drag.current) {
        drag.current = null;
        cancelDrag?.();
      }
    },
    [cancelDrag]
  );

  if (!dock) return null;

  const show = (value: number) =>
    separatorRef.current?.setAttribute('aria-valuenow', String(value));

  const finish = (commit: boolean) => {
    const active = drag.current;
    if (!active) return;
    drag.current = null;
    setPulling(false);
    if (commit) dock.commitWidth(active.width);
    else dock.cancelDrag();
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    // the primary button of a mouse, or a finger or a pen
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // the pointer is already gone: the pull ends with its first event
    }
    separatorRef.current?.focus({ preventScroll: true });
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: dock.width,
      width: dock.width,
    };
    dock.startDrag();
    setPulling(true);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    // the panel is at the right edge: a pointer to the left makes it wider
    active.width = dock.previewWidth(
      active.startWidth + (active.startX - event.clientX)
    );
    show(active.width);
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    active.width = dock.previewWidth(
      active.startWidth + (active.startX - event.clientX)
    );
    try {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    } catch {
      // already released
    }
    finish(true);
  };

  const onPointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    show(dock.width);
    finish(false);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const next = widthForKey(event.key, event.shiftKey, dock.width, dock);
    if (next === null) return;
    event.preventDefault();
    dock.commitWidth(next);
  };

  return (
    <>
      <div
        ref={separatorRef}
        role="separator"
        aria-orientation="vertical"
        aria-controls={HAI_PANEL_ID}
        aria-label={t('hai.panel.resize')}
        aria-valuenow={dock.width}
        aria-valuemin={dock.min}
        aria-valuemax={dock.max}
        tabIndex={0}
        data-testid="hai-dock-handle"
        data-pulling={pulling ? 'true' : 'false'}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onDoubleClick={dock.resetWidth}
        onKeyDown={onKeyDown}
        // 12 px of grip (20 px for a finger) at the left edge, over the border
        className="group absolute inset-y-0 left-0 z-20 w-3 cursor-col-resize touch-none outline-none pointer-coarse:w-5"
      >
        {/* the line that lights up under the pointer, on focus and while pulling */}
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 w-0.5 bg-transparent transition-colors group-hover:bg-cyan-400/70 group-focus-visible:bg-cyan-400 group-data-[pulling=true]:bg-cyan-400"
        />
        {/* the grip: always a little visible, so the edge shows that it can be pulled */}
        <span
          aria-hidden="true"
          className="absolute top-1/2 left-[3px] h-10 w-1 -translate-y-1/2 rounded-full bg-white/25 transition-colors group-hover:bg-cyan-300 group-focus-visible:bg-cyan-300 group-data-[pulling=true]:bg-cyan-300"
        />
      </div>
      {pulling &&
        createPortal(
          <div
            aria-hidden="true"
            data-testid="hai-dock-guard"
            className="fixed inset-0 z-[70] cursor-col-resize touch-none"
          />,
          document.body
        )}
    </>
  );
}

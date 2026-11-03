'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type SyntheticEvent,
} from 'react';
import type {
  PDFDocumentProxy,
  RenderTask,
} from 'pdfjs-dist/legacy/build/pdf.mjs';
import { ChevronDown, ChevronUp, ZoomIn, ZoomOut } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useLanguage } from '@/contexts/LanguageContext';
import { authFetch } from '@/lib/authFetch';
import { loadPdfjs } from '@/lib/pdf/pdfjs';

// The reading view of a learning document for a trainee.
//
// The PDF is not handed to the browser's own PDF viewer (an iframe): that one
// has a context menu with "save as", the keys for saving and printing, and a
// toolbar. This viewer reads the bytes from a route of the app (`src`, always a
// path under /api/trainee/, asked with the session of the app) and draws the
// pages itself with pdf.js onto canvases, page by page and only the pages that
// are near the visible area, so a large file does not fill the memory.
//
// What it blocks, as far as a browser allows it: the context menu on the whole
// viewer, dragging, selecting and copying, the keys Ctrl/Cmd+S, Ctrl/Cmd+P (and
// with Shift), and printing (nothing of the viewer is printed). What no page can
// block (a screenshot, the developer tools, a photo of the screen) is listed in
// docs/dokumentschutz.md.

const MIN_ZOOM = 50;
const MAX_ZOOM = 300;
const ZOOM_STEP = 25;
const DEFAULT_ZOOM = 100;
/** Width of a page at 100%, never wider than the viewer (css pixels). */
const MAX_PAGE_WIDTH = 900;
/** Pages this far outside of the visible area are drawn already. */
const PRELOAD_MARGIN = '900px 0px';
/** More pixels than this on one canvas are not drawn (memory of the device). */
const MAX_CANVAS_PIXELS = 16_000_000;
const FALLBACK_WIDTH = 800;

const stop = (event: SyntheticEvent) => event.preventDefault();

/**
 * Only the routes of the trainee area deliver a document to this viewer, and
 * the route that delivers the file of a use case submission to the trainer who
 * reviews it (WMCNL-2927).
 */
const isContentPath = (src: unknown): src is string =>
  typeof src === 'string' &&
  (/^\/api\/trainee\/[A-Za-z0-9\-_/]+$/.test(src) ||
    /^\/api\/trainer\/reviews\/use-cases\/[A-Za-z0-9-]+\/file\/content$/.test(
      src
    ));

interface PageSlotProps {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  /** Width of the page in css pixels. */
  width: number;
  /** Height divided by width, from the first page until this page is known. */
  estimatedRatio: number;
  scrollRoot: HTMLElement | null;
  label: string;
  register: (pageNumber: number, element: HTMLDivElement | null) => void;
}

function PageSlot({
  pdf,
  pageNumber,
  width,
  estimatedRatio,
  scrollRoot,
  label,
  register,
}: PageSlotProps) {
  const slot = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [near, setNear] = useState(false);
  const [ratio, setRatio] = useState<number | null>(null);

  const setSlot = useCallback(
    (element: HTMLDivElement | null) => {
      slot.current = element;
      register(pageNumber, element);
    },
    [pageNumber, register]
  );

  // Which pages are near the visible area
  useEffect(() => {
    const element = slot.current;
    if (!element) return;
    if (typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) setNear(entry.isIntersecting);
      },
      { root: scrollRoot, rootMargin: PRELOAD_MARGIN }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [scrollRoot]);

  // Draw the page while it is near, free the canvas when it is not
  useEffect(() => {
    const target = canvas.current;
    if (!target) return;
    if (!near) {
      target.width = 0;
      target.height = 0;
      return;
    }
    let cancelled = false;
    let task: RenderTask | null = null;
    void (async () => {
      try {
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;
        const unit = page.getViewport({ scale: 1 });
        const cssScale = width / unit.width;
        const viewport = page.getViewport({ scale: cssScale });
        const dpr = Math.min(
          typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1,
          2
        );
        const pixels = viewport.width * viewport.height * dpr * dpr;
        const density =
          pixels > MAX_CANVAS_PIXELS
            ? dpr * Math.sqrt(MAX_CANVAS_PIXELS / pixels)
            : dpr;
        const context = target.getContext('2d');
        if (!context) return;
        target.width = Math.floor(viewport.width * density);
        target.height = Math.floor(viewport.height * density);
        target.style.width = `${Math.floor(viewport.width)}px`;
        target.style.height = `${Math.floor(viewport.height)}px`;
        setRatio(unit.height / unit.width);
        task = page.render({
          canvasContext: context,
          canvas: target,
          viewport,
          transform: density !== 1 ? [density, 0, 0, density, 0, 0] : undefined,
        });
        await task.promise;
      } catch {
        // a cancelled render, or a page that cannot be drawn: the slot stays blank
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [near, pdf, pageNumber, width]);

  const height = Math.round(width * (ratio ?? estimatedRatio));
  return (
    <div
      ref={setSlot}
      data-page={pageNumber}
      className="mx-auto mb-4 bg-white shadow-lg"
      style={{ width, height }}
    >
      <canvas
        ref={canvas}
        role="img"
        aria-label={label}
        draggable={false}
        onDragStart={stop}
        className="block select-none"
      />
    </div>
  );
}

export interface SecurePdfViewerProps {
  /**
   * The route that delivers the PDF: a path under /api/trainee/, or the file
   * route of a submission under /api/trainer/reviews/use-cases/.
   */
  src: string;
  title: string;
  className?: string;
}

export function SecurePdfViewer({
  src,
  title,
  className = '',
}: SecurePdfViewerProps) {
  const { t } = useLanguage();
  const scroller = useRef<HTMLDivElement | null>(null);
  const slots = useRef(new Map<number, HTMLDivElement>());
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [firstRatio, setFirstRatio] = useState(1.414);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [current, setCurrent] = useState(1);
  const [available, setAvailable] = useState(FALLBACK_WIDTH);
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);

  const scrollerRef = useCallback((element: HTMLDivElement | null) => {
    scroller.current = element;
    setScrollRoot(element);
  }, []);

  // Fetch the bytes with the session and open them in pdf.js
  useEffect(() => {
    const controller = new AbortController();
    let task: { destroy(): Promise<void> | void } | null = null;
    let cancelled = false;
    setState('loading');
    setPdf(null);
    setCurrent(1);

    void (async () => {
      try {
        if (!isContentPath(src)) throw new Error('not a content route');
        const [pdfjs, response] = await Promise.all([
          loadPdfjs(),
          authFetch(src, { signal: controller.signal, cache: 'no-store' }),
        ]);
        if (!response.ok) throw new Error('not delivered');
        const data = new Uint8Array(await response.arrayBuffer());
        if (cancelled) return;
        const loading = pdfjs.getDocument({
          data,
          isEvalSupported: false,
          enableScripting: false,
        } as Parameters<typeof pdfjs.getDocument>[0]);
        task = loading;
        const document = await loading.promise;
        if (cancelled) {
          void loading.destroy();
          return;
        }
        const first = await document.getPage(1);
        const unit = first.getViewport({ scale: 1 });
        if (cancelled) return;
        setFirstRatio(unit.height / unit.width);
        setPdf(document);
        setState('ready');
      } catch {
        if (!cancelled) setState('error');
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      void task?.destroy();
    };
  }, [src]);

  // The width the pages may take
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const measure = () =>
      setAvailable(Math.max(240, (element.clientWidth || FALLBACK_WIDTH) - 32));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [state]);

  // The keys of the viewer take the focus, so a key goes to the viewer first
  useEffect(() => {
    if (state === 'ready') scroller.current?.focus({ preventScroll: true });
  }, [state]);

  const register = useCallback(
    (pageNumber: number, element: HTMLDivElement | null) => {
      if (element) slots.current.set(pageNumber, element);
      else slots.current.delete(pageNumber);
    },
    []
  );

  const numPages = pdf?.numPages ?? 0;
  const pageWidth = Math.round(
    (Math.min(available, MAX_PAGE_WIDTH) * zoom) / 100
  );

  const onScroll = () => {
    const root = scroller.current;
    if (!root) return;
    const line = root.scrollTop + root.clientHeight / 3;
    let page = 1;
    for (const [number, element] of slots.current) {
      if (element.offsetTop <= line && number > page) page = number;
    }
    setCurrent(page);
  };

  const goTo = (page: number) => {
    const target = Math.min(numPages, Math.max(1, page));
    const element = slots.current.get(target);
    const root = scroller.current;
    if (element && root) root.scrollTop = element.offsetTop - 8;
    setCurrent(target);
  };

  const zoomBy = (step: number) =>
    setZoom(value => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value + step)));

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const key = event.key.toLowerCase();
    // save and print (Ctrl or Cmd, with or without Shift)
    if ((event.ctrlKey || event.metaKey) && (key === 's' || key === 'p')) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (key === '+' || key === '=') {
      event.preventDefault();
      zoomBy(ZOOM_STEP);
    } else if (key === '-') {
      event.preventDefault();
      zoomBy(-ZOOM_STEP);
    }
  };

  const pages = useMemo(
    () => Array.from({ length: numPages }, (_, index) => index + 1),
    [numPages]
  );

  const buttonClass =
    'rounded-lg p-1.5 text-gray-300 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40';

  return (
    <div
      data-testid="secure-pdf-viewer"
      aria-label={title}
      className={`flex h-full w-full flex-col bg-slate-950 select-none print:hidden ${className}`}
      style={{ userSelect: 'none', WebkitTouchCallout: 'none' }}
      onContextMenu={stop}
      onDragStart={stop}
      onCopy={stop}
      onCut={stop}
      onKeyDown={onKeyDown}
    >
      <div className="flex items-center justify-between gap-2 border-b border-white/10 bg-black/30 px-3 py-1.5 text-xs text-gray-300">
        <div className="flex items-center gap-1">
          <button
            type="button"
            className={buttonClass}
            disabled={state !== 'ready' || current <= 1}
            onClick={() => goTo(current - 1)}
            title={t('securePdf.previousPage')}
            aria-label={t('securePdf.previousPage')}
          >
            <ChevronUp className="h-4 w-4" />
          </button>
          <span
            data-testid="secure-pdf-page"
            className="min-w-[7rem] text-center"
          >
            {state === 'ready'
              ? t('securePdf.pageOf', {
                  current: String(current),
                  total: String(numPages),
                })
              : ''}
          </span>
          <button
            type="button"
            className={buttonClass}
            disabled={state !== 'ready' || current >= numPages}
            onClick={() => goTo(current + 1)}
            title={t('securePdf.nextPage')}
            aria-label={t('securePdf.nextPage')}
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className={buttonClass}
            disabled={state !== 'ready' || zoom <= MIN_ZOOM}
            onClick={() => zoomBy(-ZOOM_STEP)}
            title={t('flipbook.zoomOut')}
            aria-label={t('flipbook.zoomOut')}
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <span className="min-w-[3rem] text-center">{zoom}%</span>
          <button
            type="button"
            className={buttonClass}
            disabled={state !== 'ready' || zoom >= MAX_ZOOM}
            onClick={() => zoomBy(ZOOM_STEP)}
            title={t('flipbook.zoomIn')}
            aria-label={t('flipbook.zoomIn')}
          >
            <ZoomIn className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div
        ref={scrollerRef}
        tabIndex={0}
        onScroll={onScroll}
        className="relative min-h-0 flex-1 overflow-auto p-4 outline-none"
      >
        {state === 'loading' && (
          <div
            role="status"
            aria-label={t('flipbook.loading')}
            className="absolute inset-0 z-10 flex items-center justify-center bg-slate-900/90"
          >
            <LoadingSpinner size="xl" />
          </div>
        )}
        {state === 'error' && (
          <div
            role="alert"
            className="flex h-full items-center justify-center px-6 text-center text-sm text-red-300"
          >
            {t('securePdf.loadFailed')}
          </div>
        )}
        {state === 'ready' &&
          pdf &&
          pages.map(page => (
            <PageSlot
              key={page}
              pdf={pdf}
              pageNumber={page}
              width={pageWidth}
              estimatedRatio={firstRatio}
              scrollRoot={scrollRoot}
              label={t('securePdf.pageLabel', { page: String(page) })}
              register={register}
            />
          ))}
      </div>
    </div>
  );
}

export default SecurePdfViewer;

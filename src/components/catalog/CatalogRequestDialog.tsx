'use client';

import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useLanguage } from '@/contexts/LanguageContext';
import { authFetch } from '@/lib/authFetch';

/** Same limit as the server (CATALOG_REQUEST_MESSAGE_MAX). */
const MESSAGE_MAX = 500;
/** A request that hangs is given up after this time. */
const REQUEST_TIMEOUT_MS = 15000;

type Phase =
  | { kind: 'form' }
  | { kind: 'sending' }
  | { kind: 'done'; alreadyRequested: boolean }
  | { kind: 'error'; key: string };

/** Text key of the error for the answer of the server. */
function errorKey(status: number, code: unknown): string {
  if (code === 'ALREADY_ENABLED') return 'ALREADY_ENABLED';
  if (code === 'RATE_LIMITED' || status === 429) return 'RATE_LIMITED';
  if (code === 'NO_RECIPIENT') return 'NO_RECIPIENT';
  if (status === 404) return 'NOT_FOUND';
  if (status === 403) return 'FORBIDDEN';
  if (status === 401) return 'UNAUTHORIZED';
  return 'GENERIC';
}

/**
 * "Abo anfragen": the dialog to ask the platform administration for an
 * occupation the organization does not have. Mount it while it is open and
 * unmount it in `onClose`, so every opening starts with an empty form.
 *
 * Accessible modal dialog (Radix): the focus moves into it and stays there,
 * Escape and Cancel close it, the page behind it is inert. `restoreFocusTo`
 * is the element that opened it and gets the focus back. While the request is
 * sent the dialog cannot be closed. A click next to the dialog only closes it
 * while nothing was typed.
 */
export function CatalogRequestDialog({
  catalog,
  onClose,
  restoreFocusTo,
}: {
  catalog: { code: string; title: string };
  onClose: () => void;
  restoreFocusTo?: RefObject<HTMLElement | null>;
}) {
  const { t } = useLanguage();
  const [message, setMessage] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'form' });
  const closeRef = useRef<HTMLButtonElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const counterId = useId();
  const hintId = useId();
  const sending = phase.kind === 'sending';
  const done = phase.kind === 'done';

  // The form is replaced by the answer: the focus goes to the one button left
  useEffect(() => {
    if (done) closeRef.current?.focus();
  }, [done]);

  // Closing the dialog gives up a request that is still on its way
  useEffect(() => () => controllerRef.current?.abort(), []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (sending) return;
    setPhase({ kind: 'sending' });
    const controller = new AbortController();
    controllerRef.current = controller;
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const note = message.trim();
    try {
      const res = await authFetch('/api/me/catalog-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          note
            ? { catalogCode: catalog.code, message: note }
            : { catalogCode: catalog.code }
        ),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        setPhase({
          kind: 'done',
          alreadyRequested: data?.alreadyRequested === true,
        });
      } else {
        setPhase({ kind: 'error', key: errorKey(res.status, data?.code) });
      }
    } catch {
      setPhase({ kind: 'error', key: 'GENERIC' });
    } finally {
      clearTimeout(timer);
    }
  };

  return (
    <Dialog.Root
      open
      onOpenChange={open => {
        if (!open && !sending) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm" />
        <Dialog.Content
          aria-modal="true"
          onEscapeKeyDown={event => {
            if (sending) event.preventDefault();
          }}
          onInteractOutside={event => {
            if (sending || message.trim() !== '') event.preventDefault();
          }}
          onCloseAutoFocus={event => {
            event.preventDefault();
            restoreFocusTo?.current?.focus();
          }}
          className="bg-card text-foreground border-border fixed top-1/2 left-1/2 z-[101] max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border p-6 shadow-2xl"
        >
          <Dialog.Title className="text-foreground text-lg font-bold">
            {t('catalog.tiles.request.title', { title: catalog.title })}
          </Dialog.Title>
          <Dialog.Description className="text-muted-foreground mt-2 text-sm">
            {t('catalog.tiles.request.explain')}
          </Dialog.Description>

          {done ? (
            <div className="mt-5 space-y-5">
              <p
                id={`${counterId}-result`}
                role="status"
                className="bg-accent/10 border-accent/30 text-foreground rounded-xl border p-3 text-sm"
              >
                {phase.alreadyRequested
                  ? t('catalog.tiles.request.alreadyRequested')
                  : t('catalog.tiles.request.success')}
              </p>
              <div className="flex justify-end">
                <Dialog.Close asChild>
                  <button
                    ref={closeRef}
                    aria-describedby={`${counterId}-result`}
                    type="button"
                    className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-accent min-h-11 w-full rounded-xl px-5 py-2 text-sm font-semibold focus-visible:ring-2 focus-visible:outline-none sm:w-auto"
                  >
                    {t('catalog.tiles.request.close')}
                  </button>
                </Dialog.Close>
              </div>
            </div>
          ) : (
            <form
              onSubmit={submit}
              noValidate
              aria-busy={sending}
              className="mt-5 space-y-4"
            >
              <div>
                <label
                  htmlFor={`${counterId}-message`}
                  className="text-foreground mb-1.5 block text-sm font-medium"
                >
                  {t('catalog.tiles.request.messageLabel')}
                </label>
                <textarea
                  id={`${counterId}-message`}
                  value={message}
                  onChange={event => setMessage(event.target.value)}
                  maxLength={MESSAGE_MAX}
                  rows={4}
                  aria-describedby={`${hintId} ${counterId}`}
                  className="bg-background border-border text-foreground focus:ring-accent w-full resize-y rounded-xl border px-3 py-2 text-base focus:border-transparent focus:ring-2 focus:outline-none sm:text-sm"
                />
                <div className="text-muted-foreground mt-1 flex flex-wrap justify-between gap-x-3 text-xs">
                  <span id={hintId}>
                    {t('catalog.tiles.request.messageHint')}
                  </span>
                  <span id={counterId}>
                    {t('catalog.tiles.request.counter', {
                      count: message.length,
                      max: MESSAGE_MAX,
                    })}
                  </span>
                </div>
              </div>

              {phase.kind === 'error' && (
                <p
                  role="alert"
                  className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400"
                >
                  {t(`catalog.tiles.request.error.${phase.key}`)}
                </p>
              )}

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Dialog.Close asChild>
                  <button
                    type="button"
                    aria-disabled={sending}
                    className="border-border bg-background text-foreground hover:bg-muted focus-visible:ring-accent min-h-11 rounded-xl border px-5 py-2 text-sm font-semibold focus-visible:ring-2 focus-visible:outline-none"
                  >
                    {t('catalog.tiles.request.cancel')}
                  </button>
                </Dialog.Close>
                <button
                  type="submit"
                  aria-disabled={sending}
                  className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-accent min-h-11 rounded-xl px-5 py-2 text-sm font-semibold focus-visible:ring-2 focus-visible:outline-none aria-disabled:opacity-60"
                >
                  {sending
                    ? t('catalog.tiles.request.sending')
                    : t('catalog.tiles.request.send')}
                </button>
              </div>
            </form>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

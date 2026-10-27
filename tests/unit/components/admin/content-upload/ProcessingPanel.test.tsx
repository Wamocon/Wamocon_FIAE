import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../../helpers/renderWithProviders';
import {
  ProcessingPanel,
  processingFigures,
} from '@/components/admin/content-upload/ProcessingPanel';
import { UploadAbortedError } from '@/lib/content-upload/staging/client';

const progress = (counts: Record<string, number>, totalFiles?: number) => ({
  run: {},
  progress: {
    counts,
    totalFiles: totalFiles ?? Object.values(counts).reduce((a, b) => a + b, 0),
    totalBytes: 0,
  },
  limits: {},
});

function fakeClient(overrides: Record<string, unknown> = {}) {
  return {
    getRun: jest.fn(async () => progress({ proposed_rules: 3, verified: 2 })),
    processRun: jest.fn(async () => ({ done: true })),
    ...overrides,
  } as any;
}

describe('processingFigures', () => {
  it('counts what still waits for a step, leaves out copies and expired files', () => {
    expect(
      processingFigures({
        counts: {
          announced: 1,
          uploaded: 2,
          verified: 3,
          extracted: 4,
          ki_pending: 1,
          proposed_rules: 10,
          unclear: 2,
          merged: 5,
          expired: 1,
          failed: 1,
        },
        totalFiles: 30,
        totalBytes: 0,
      })
    ).toEqual({ total: 24, pending: 11, done: 13 });
  });

  it('is zero without a run and never negative', () => {
    expect(processingFigures(null)).toEqual({ total: 0, done: 0, pending: 0 });
    expect(
      processingFigures({
        counts: { verified: 5, merged: 9 },
        totalFiles: 5,
        totalBytes: 0,
      })
    ).toEqual({ total: -4, pending: 5, done: 0 });
  });
});

describe('ProcessingPanel', () => {
  it('works the queue as soon as it is shown and tells the run to go on when it is empty', async () => {
    const client = fakeClient();
    const onDone = jest.fn();
    renderWithProviders(
      <ProcessingPanel runId="r1" autoStart onDone={onDone} client={client} />
    );
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(client.processRun).toHaveBeenCalledWith(
      'r1',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(
      screen.getAllByText('Alle Dateien sind verarbeitet.').length
    ).toBeGreaterThan(0);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows how far the run is as a progress bar with a name and a value', async () => {
    const client = fakeClient({
      processRun: jest.fn(() => new Promise(() => undefined)),
    });
    renderWithProviders(
      <ProcessingPanel
        runId="r1"
        autoStart
        onDone={jest.fn()}
        client={client}
      />
    );
    expect(
      (await screen.findAllByText('Verarbeitet: 3 von 5')).length
    ).toBeGreaterThan(0);
    const bar = screen.getByRole('progressbar', {
      name: 'Fortschritt der Verarbeitung',
    });
    expect(bar).toHaveAttribute('value', '3');
    expect(bar).toHaveAttribute('max', '5');
    expect(
      screen.getByText(
        'Die Verarbeitung läuft, solange diese Seite geöffnet ist.'
      )
    ).toBeInTheDocument();
  });

  it('refreshes the numbers after each call of the pump', async () => {
    const counts = [
      { verified: 5 },
      { verified: 4, proposed_rules: 1 },
      { proposed_rules: 5 },
    ];
    let call = 0;
    const client = fakeClient({
      getRun: jest.fn(async () => progress(counts[Math.min(call++, 2)])),
      processRun: jest.fn(async (_id: string, handlers: any) => {
        handlers.onProgress({ done: false });
        handlers.onProgress({ done: true });
        return { done: true };
      }),
    });
    renderWithProviders(
      <ProcessingPanel
        runId="r1"
        autoStart
        onDone={jest.fn()}
        client={client}
      />
    );
    await waitFor(() =>
      expect(
        screen.getAllByText('Verarbeitet: 5 von 5').length
      ).toBeGreaterThan(0)
    );
  });

  it('can be paused and continued', async () => {
    const user = userEvent.setup();
    const client = fakeClient({
      processRun: jest.fn(
        (_id: string, handlers: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            handlers.signal.addEventListener('abort', () =>
              reject(new UploadAbortedError())
            );
          })
      ),
    });
    renderWithProviders(
      <ProcessingPanel
        runId="r1"
        autoStart
        onDone={jest.fn()}
        client={client}
      />
    );
    await user.click(await screen.findByRole('button', { name: 'Pausieren' }));
    expect(await screen.findByText(/Pausiert/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Weiterverarbeiten' }));
    await waitFor(() => expect(client.processRun).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByRole('button', { name: 'Pausieren' })
    ).toBeInTheDocument();
  });

  it('does not start by itself unless it is asked to', async () => {
    const client = fakeClient();
    renderWithProviders(
      <ProcessingPanel runId="r1" onDone={jest.fn()} client={client} />
    );
    expect(
      screen.getByText('Die Verarbeitung ist angehalten.')
    ).toBeInTheDocument();
    expect(client.processRun).not.toHaveBeenCalled();
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Weiterverarbeiten' }));
    await waitFor(() => expect(client.processRun).toHaveBeenCalled());
  });

  it('says so when the queue cannot be worked and offers to continue', async () => {
    const client = fakeClient({
      processRun: jest.fn(async () => {
        throw new Error('down');
      }),
    });
    renderWithProviders(
      <ProcessingPanel
        runId="r1"
        autoStart
        onDone={jest.fn()}
        client={client}
      />
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'konnte nicht fortgesetzt werden'
    );
    expect(
      screen.getByRole('button', { name: 'Weiterverarbeiten' })
    ).toBeInTheDocument();
  });

  it('announces the progress to a screen reader in a polite live region', async () => {
    const client = fakeClient({
      processRun: jest.fn(() => new Promise(() => undefined)),
    });
    renderWithProviders(
      <ProcessingPanel
        runId="r1"
        autoStart
        onDone={jest.fn()}
        client={client}
      />
    );
    await screen.findAllByText('Verarbeitet: 3 von 5');
    const live = document.querySelector('[aria-live="polite"][role="status"]')!;
    expect(live).toHaveClass('sr-only');
    await waitFor(() => expect(live).toHaveTextContent('Verarbeitet: 3 von 5'));
  });

  it('stops working the queue when it is taken from the page', async () => {
    let signal: AbortSignal | undefined;
    const client = fakeClient({
      processRun: jest.fn((_id: string, handlers: { signal: AbortSignal }) => {
        signal = handlers.signal;
        return new Promise(() => undefined);
      }),
    });
    const { unmount } = renderWithProviders(
      <ProcessingPanel
        runId="r1"
        autoStart
        onDone={jest.fn()}
        client={client}
      />
    );
    await waitFor(() => expect(signal).toBeDefined());
    act(() => unmount());
    expect(signal!.aborted).toBe(true);
  });
});

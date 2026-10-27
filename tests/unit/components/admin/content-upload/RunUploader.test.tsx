import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../../helpers/renderWithProviders';
import { RunUploader } from '@/components/admin/content-upload/RunUploader';
import { UploadAbortedError } from '@/lib/content-upload/staging/client';

function file(name: string, path?: string, size = 100) {
  const f = new File(['x'.repeat(Math.min(size, 50))], name);
  Object.defineProperty(f, 'size', { value: size });
  if (path) Object.defineProperty(f, 'webkitRelativePath', { value: path });
  return f;
}

const summary = (overrides: Record<string, unknown> = {}) => ({
  announced: 2,
  merged: 1,
  existing: 0,
  alreadyPast: 0,
  rejected: [],
  uploaded: 2,
  failed: [],
  warnings: [],
  ...overrides,
});

function fakeClient(overrides: Record<string, unknown> = {}) {
  return {
    uploadFiles: jest.fn(async () => summary()),
    getRun: jest.fn(async () => ({
      run: {},
      progress: { counts: { proposed_rules: 2 }, totalFiles: 2, totalBytes: 0 },
      limits: {},
    })),
    processRun: jest.fn(async () => ({ done: true })),
    ...overrides,
  } as any;
}

async function choose(
  user: ReturnType<typeof userEvent.setup>,
  files: File[],
  kind: 'files' | 'folder' = 'files'
) {
  await user.upload(screen.getByTestId(`${kind}-input`), files);
}

describe('RunUploader: the choice of the files', () => {
  it('has a button for a folder and one for files, each with a name', () => {
    renderWithProviders(
      <RunUploader runId="r1" onFinished={jest.fn()} client={fakeClient()} />
    );
    expect(
      screen.getByRole('button', { name: 'Ordner wählen' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Dateien wählen' })
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Erlaubt: .docx und .pdf bis 25 MB, .json bis 32 MB, .xlsx bis 5 MB je Datei, bis 1500 Dateien je Lauf/
      )
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Hochladen und verarbeiten' })
    ).toBeDisabled();
  });

  it('marks the folder input as a folder input', () => {
    renderWithProviders(
      <RunUploader runId="r1" onFinished={jest.fn()} client={fakeClient()} />
    );
    expect(screen.getByTestId('folder-input')).toHaveAttribute(
      'webkitdirectory'
    );
    expect(screen.getByTestId('files-input')).not.toHaveAttribute(
      'webkitdirectory'
    );
    expect(screen.getByTestId('files-input')).toHaveAttribute(
      'accept',
      '.docx,.pdf,.json,.xlsx'
    );
  });

  it('takes Word, PDF, JSON and Excel files and says how many others it left out', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <RunUploader runId="r1" onFinished={jest.fn()} client={fakeClient()} />
    );
    await choose(
      user,
      [
        file('a.docx'),
        file('b.PDF'),
        file('c.xlsx'),
        file('q.JSON'),
        file('d.txt'),
        file('e.csv'),
        file('Thumbs.db'),
        file('f.json.exe'),
      ],
      'folder'
    );
    const selection = screen.getByTestId('selection');
    expect(selection).toHaveTextContent('4 Dateien gewählt');
    expect(selection).toHaveTextContent(
      '4 Dateien mit anderer Endung werden nicht hochgeladen.'
    );
    expect(
      screen.getByRole('button', { name: 'Hochladen und verarbeiten' })
    ).toBeEnabled();
  });

  it('says so when the choice holds nothing it can use', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <RunUploader runId="r1" onFinished={jest.fn()} client={fakeClient()} />
    );
    await choose(user, [file('a.csv'), file('b.xlsm')], 'folder');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'keine Word-, PDF-, JSON- oder Excel-Dateien'
    );
    expect(
      screen.getByRole('button', { name: 'Hochladen und verarbeiten' })
    ).toBeDisabled();
  });

  it('warns about files above the limit and refuses more files than a run may hold', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <RunUploader runId="r1" onFinished={jest.fn()} client={fakeClient()} />
    );
    await choose(user, [
      file('a.docx'),
      file('big.pdf', undefined, 26 * 1024 * 1024),
    ]);
    expect(
      screen.getByText(/1 Dateien sind größer als erlaubt/)
    ).toBeInTheDocument();
    const many = Array.from({ length: 1501 }, (_, i) => file(`f${i}.docx`));
    await choose(user, many);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'höchstens 1500 Dateien'
    );
    expect(
      screen.getByRole('button', { name: 'Hochladen und verarbeiten' })
    ).toBeDisabled();
  });
});

describe('RunUploader: the upload', () => {
  it('uploads the chosen files with their relative paths and goes on to the queue', async () => {
    const user = userEvent.setup();
    const client = fakeClient();
    const onFinished = jest.fn();
    renderWithProviders(
      <RunUploader runId="r1" onFinished={onFinished} client={client} />
    );
    await choose(
      user,
      [
        file('a.docx', 'Ordner/K1/a.docx'),
        file('b.pdf', 'Ordner/K1/b.pdf'),
        file('c.csv', 'Ordner/c.csv'),
      ],
      'folder'
    );
    await user.click(
      screen.getByRole('button', { name: 'Hochladen und verarbeiten' })
    );
    await waitFor(() => expect(client.uploadFiles).toHaveBeenCalledTimes(1));
    const [runId, candidates, handlers] = client.uploadFiles.mock.calls[0];
    expect(runId).toBe('r1');
    expect(candidates.map((c: any) => c.path)).toEqual([
      'Ordner/K1/a.docx',
      'Ordner/K1/b.pdf',
    ]);
    expect(handlers.signal).toBeInstanceOf(AbortSignal);
    // the queue is worked and the run goes on
    await waitFor(() =>
      expect(client.processRun).toHaveBeenCalledWith('r1', expect.anything())
    );
    await waitFor(() => expect(onFinished).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('summary')).toHaveTextContent(
      '2 Dateien hochgeladen, 1 Kopien zusammengefasst.'
    );
  });

  it('shows the phase and the progress while it uploads, with a pause button', async () => {
    const user = userEvent.setup();
    let release!: () => void;
    const client = fakeClient({
      uploadFiles: jest.fn(async (_id: string, _c: unknown, handlers: any) => {
        handlers.onProgress({ phase: 'uploading', done: 148, total: 340 });
        await new Promise<void>(resolve => {
          release = resolve;
        });
        return summary();
      }),
    });
    renderWithProviders(
      <RunUploader runId="r1" onFinished={jest.fn()} client={client} />
    );
    await choose(user, [file('a.docx')]);
    await user.click(
      screen.getByRole('button', { name: 'Hochladen und verarbeiten' })
    );
    const bar = await screen.findByRole('progressbar', {
      name: 'Dateien werden hochgeladen',
    });
    expect(bar).toHaveAttribute('value', '148');
    expect(bar).toHaveAttribute('max', '340');
    expect(
      screen.getAllByText('Dateien werden hochgeladen: 148 von 340').length
    ).toBeGreaterThan(0);
    expect(
      screen.getByRole('button', { name: 'Pausieren' })
    ).toBeInTheDocument();
    // nothing can be chosen while it runs
    expect(
      screen.getByRole('button', { name: 'Dateien wählen' })
    ).toBeDisabled();
    release();
    await waitFor(() =>
      expect(
        screen.queryByRole('progressbar', {
          name: 'Dateien werden hochgeladen',
        })
      ).not.toBeInTheDocument()
    );
  });

  it('can be paused and continued with the same files', async () => {
    const user = userEvent.setup();
    const client = fakeClient({
      uploadFiles: jest
        .fn()
        .mockImplementationOnce(
          (_id: string, _c: unknown, handlers: { signal: AbortSignal }) =>
            new Promise((_resolve, reject) => {
              handlers.signal.addEventListener('abort', () =>
                reject(new UploadAbortedError())
              );
            })
        )
        .mockResolvedValue(summary()),
    });
    renderWithProviders(
      <RunUploader runId="r1" onFinished={jest.fn()} client={client} />
    );
    await choose(user, [file('a.docx'), file('b.docx')]);
    await user.click(
      screen.getByRole('button', { name: 'Hochladen und verarbeiten' })
    );
    await user.click(await screen.findByRole('button', { name: 'Pausieren' }));
    expect(
      await screen.findByText(/Der Upload ist pausiert/)
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Fortsetzen' }));
    await waitFor(() => expect(client.uploadFiles).toHaveBeenCalledTimes(2));
    expect(client.uploadFiles.mock.calls[1][1]).toHaveLength(2);
  });

  it('says so when the upload fails and offers to continue', async () => {
    const user = userEvent.setup();
    const client = fakeClient({
      uploadFiles: jest.fn(async () => {
        throw new Error('network');
      }),
    });
    renderWithProviders(
      <RunUploader runId="r1" onFinished={jest.fn()} client={client} />
    );
    await choose(user, [file('a.docx')]);
    await user.click(
      screen.getByRole('button', { name: 'Hochladen und verarbeiten' })
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Der Upload ist fehlgeschlagen'
    );
    expect(
      screen.getByRole('button', { name: 'Fortsetzen' })
    ).toBeInTheDocument();
  });

  it('lists the files that were refused or failed with the reason in words', async () => {
    const user = userEvent.setup();
    const client = fakeClient({
      uploadFiles: jest.fn(async () =>
        summary({
          rejected: [{ path: 'K1/Makro.docx', code: 'UNSUPPORTED_EXTENSION' }],
          failed: [
            { path: 'K1/kaputt.pdf', code: 'UPLOAD_FAILED' },
            { path: 'K1/x.pdf', code: 'SOMETHING_NEW' },
          ],
        })
      ),
      processRun: jest.fn(() => new Promise(() => undefined)),
    });
    renderWithProviders(
      <RunUploader runId="r1" onFinished={jest.fn()} client={client} />
    );
    await choose(user, [file('a.docx')]);
    await user.click(
      screen.getByRole('button', { name: 'Hochladen und verarbeiten' })
    );
    const details = await screen.findByText('3 Dateien mit Fehler');
    await user.click(details);
    const list = within(details.closest('details')!).getByRole('list');
    expect(list).toHaveTextContent('K1/Makro.docx: Dateityp nicht erlaubt.');
    expect(list).toHaveTextContent(
      'K1/kaputt.pdf: Der Upload ist fehlgeschlagen.'
    );
    expect(list).toHaveTextContent('K1/x.pdf: Code: SOMETHING_NEW');
  });
});

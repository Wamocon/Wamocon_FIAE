import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../../helpers/renderWithProviders';
import { RunsOverview } from '@/components/admin/content-upload/RunsOverview';
import { UploadApiError } from '@/lib/content-upload/staging/client';
import { fakeClient, uuid } from '../../../../helpers/reviewUi';

const run = (n: number, overrides: Record<string, unknown> = {}) => ({
  id: uuid(n),
  catalog: 'KFBM',
  label: `Lauf ${n}`,
  status: 'review',
  kiEnabled: true,
  decisionsVersion: 0,
  createdById: uuid(1),
  createdAt: '2026-10-27T10:00:00.000Z',
  updatedAt: '2026-10-27T10:00:00.000Z',
  fileCount: 340,
  decidedCount: 0,
  createdByName: 'Erika Muster',
  ...overrides,
});

describe('RunsOverview', () => {
  it('shows a loading note, then the runs in a table with a caption and header cells', async () => {
    const client = fakeClient();
    client.overview.mockResolvedValue({
      runs: [
        run(1, { label: 'KfBM Teil 2 Wahl', decidedCount: 120 }),
        run(2, { status: 'applied', createdByName: null }),
      ] as any,
    });
    renderWithProviders(<RunsOverview client={client} />);
    expect(screen.getByText('Wird geladen...')).toBeInTheDocument();
    const table = await screen.findByRole('table', {
      name: 'Läufe des Inhalts-Uploads',
    });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map(h => h.textContent)
    ).toEqual([
      'Bezeichnung',
      'Beruf',
      'Status',
      'Dateien',
      'Erstellt von',
      'Datum',
    ]);
    const first = within(table)
      .getByRole('rowheader', { name: 'KfBM Teil 2 Wahl' })
      .closest('tr')!;
    expect(
      within(first).getByRole('link', { name: 'KfBM Teil 2 Wahl' })
    ).toHaveAttribute('href', `/trainer/admin/content-upload/${uuid(1)}`);
    expect(first).toHaveTextContent('KfBM');
    expect(first).toHaveTextContent('Prüfung');
    expect(first).toHaveTextContent('340 (120 entschieden)');
    expect(first).toHaveTextContent('Erika Muster');
    expect(first).toHaveTextContent('27.10.2026');
    const second = within(table)
      .getByRole('rowheader', { name: 'Lauf 2' })
      .closest('tr')!;
    expect(second).toHaveTextContent('Übernommen');
    expect(second).toHaveTextContent('-');
  });

  it('has a link to a new run', async () => {
    const client = fakeClient();
    renderWithProviders(<RunsOverview client={client} />);
    expect(
      await screen.findByRole('link', { name: 'Neuer Lauf' })
    ).toHaveAttribute('href', '/trainer/admin/content-upload/new');
  });

  it('says what to do when there is no run yet', async () => {
    renderWithProviders(<RunsOverview client={fakeClient()} />);
    expect(
      await screen.findByText('Noch kein Lauf. Legen Sie einen neuen Lauf an.')
    ).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('says so when the runs cannot be loaded and tries again on request', async () => {
    const user = userEvent.setup();
    const client = fakeClient();
    client.overview
      .mockRejectedValueOnce(new UploadApiError(500, 'x'))
      .mockResolvedValue({ runs: [run(1)] as any });
    renderWithProviders(<RunsOverview client={client} />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('konnten nicht geladen werden');
    await user.click(
      within(alert).getByRole('button', { name: 'Erneut versuchen' })
    );
    expect(await screen.findByRole('table')).toBeInTheDocument();
  });

  it('says that the feature is off here, and offers no new run', async () => {
    const client = fakeClient();
    client.overview.mockRejectedValue(
      new UploadApiError(
        404,
        'The content upload is not available in this environment.'
      )
    );
    renderWithProviders(<RunsOverview client={client} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'in dieser Umgebung nicht verfügbar'
    );
    expect(
      screen.queryByRole('link', { name: 'Neuer Lauf' })
    ).not.toBeInTheDocument();
  });

  it('ends the request when the page is left', async () => {
    let signal: AbortSignal | undefined;
    const client = fakeClient();
    client.overview.mockImplementation(async (s?: AbortSignal) => {
      signal = s;
      return new Promise(() => undefined);
    });
    const { unmount } = renderWithProviders(<RunsOverview client={client} />);
    await waitFor(() => expect(signal).toBeDefined());
    unmount();
    expect(signal!.aborted).toBe(true);
  });
});

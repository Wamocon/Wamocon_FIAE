import { screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../../helpers/renderWithProviders';
import { ReviewView } from '@/components/admin/content-upload/ReviewView';
import { UploadApiError } from '@/lib/content-upload/staging/client';
import {
  fakeClient,
  group,
  listResponse,
  rowDto,
  uuid,
} from '../../../../helpers/reviewUi';

const RUN = uuid(900);

function fakeUpload(overrides: Record<string, unknown> = {}) {
  return {
    getRun: jest.fn(async () => ({
      run: {},
      progress: { counts: {}, totalFiles: 0, totalBytes: 0 },
      limits: {},
    })),
    processRun: jest.fn(async () => ({ done: true })),
    uploadFiles: jest.fn(),
    discardRun: jest.fn(async () => ({ run: {} })),
    ...overrides,
  } as any;
}

function standardRows() {
  return [
    rowDto({ band: 'high', fileName: 'A_Quiz.docx' }),
    rowDto({ band: 'medium', fileName: 'B_Text.docx' }),
    rowDto({ band: 'low', fileName: 'C_lose.docx' }),
    rowDto({ band: 'conflict', fileName: 'D_Szenario.docx' }),
    rowDto({ band: null, fileName: 'E_kaputt.docx' }),
  ];
}

async function open(
  client = fakeClient(),
  upload = fakeUpload(),
  rows = standardRows(),
  options: Parameters<typeof listResponse>[1] = {}
) {
  client.review.mockResolvedValue(listResponse(rows, options));
  const user = userEvent.setup();
  const view = renderWithProviders(
    <ReviewView runId={RUN} client={client} uploadClient={upload} />
  );
  await screen.findByRole('table');
  return { client, upload, user, view, rows };
}

const DECISION_LABEL = {
  accept: 'Übernehmen',
  reject: 'Ablehnen',
  defer: 'Zurückgestellt',
} as const;
const decisionGroup = (name: string) =>
  screen.getByRole('group', { name: `Entscheidung für ${name}` });
const decisionButton = (name: string, action: keyof typeof DECISION_LABEL) =>
  within(decisionGroup(name)).getByRole('button', {
    name: DECISION_LABEL[action],
  });

const rowOf = (name: string) =>
  screen.getByRole('rowheader', { name: new RegExp(name) }).closest('tr')!;

describe('ReviewView: the states of the page', () => {
  it('shows a loading note first and then the table with its caption', async () => {
    const client = fakeClient();
    client.review.mockResolvedValue(listResponse(standardRows()));
    renderWithProviders(
      <ReviewView runId={RUN} client={client} uploadClient={fakeUpload()} />
    );
    expect(screen.getByText('Wird geladen...')).toBeInTheDocument();
    expect(
      await screen.findByRole('table', {
        name: 'Prüfliste der Dateien des Laufs',
      })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 1, name: 'KfBM Teil 2 Wahl' })
    ).toBeInTheDocument();
    expect(client.review).toHaveBeenCalledWith(
      RUN,
      {},
      expect.any(AbortSignal)
    );
  });

  it('says so when the list cannot be loaded and tries again on request', async () => {
    const client = fakeClient();
    client.review
      .mockRejectedValueOnce(new UploadApiError(500, 'Internal Server Error'))
      .mockResolvedValue(listResponse(standardRows()));
    const user = userEvent.setup();
    renderWithProviders(
      <ReviewView runId={RUN} client={client} uploadClient={fakeUpload()} />
    );
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Die Daten konnten nicht geladen werden');
    await user.click(
      within(alert).getByRole('button', { name: 'Erneut versuchen' })
    );
    expect(await screen.findByRole('table')).toBeInTheDocument();
  });

  it('tells that the feature is off in this environment (404 of the switch)', async () => {
    const client = fakeClient();
    client.review.mockRejectedValue(
      new UploadApiError(
        404,
        'The content upload is not available in this environment.'
      )
    );
    renderWithProviders(
      <ReviewView runId={RUN} client={client} uploadClient={fakeUpload()} />
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'in dieser Umgebung nicht verfügbar'
    );
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('tells that the run was not found (a run of somebody else looks the same)', async () => {
    const client = fakeClient();
    client.review.mockRejectedValue(new UploadApiError(404, 'Run not found'));
    renderWithProviders(
      <ReviewView runId={RUN} client={client} uploadClient={fakeUpload()} />
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Dieser Lauf wurde nicht gefunden'
    );
    expect(
      screen.getByRole('link', { name: 'Zurück zu den Läufen' })
    ).toHaveAttribute('href', '/trainer/admin/content-upload');
  });

  it('shows an empty state for a run without files', async () => {
    const client = fakeClient();
    client.review.mockResolvedValue(listResponse([]));
    renderWithProviders(
      <ReviewView runId={RUN} client={client} uploadClient={fakeUpload()} />
    );
    expect(
      await screen.findByText('In diesem Lauf gibt es keine Dateien.')
    ).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('keeps showing the list and offers a retry when only a later reload fails', async () => {
    const { client, user } = await open();
    client.review.mockRejectedValue(new UploadApiError(500, 'x'));
    await user.click(screen.getByRole('button', { name: /^Sicher \d/ }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Die Daten konnten nicht geladen werden');
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('shows the uploader for a run that is still being uploaded', async () => {
    renderWithProviders(
      <ReviewView
        runId={RUN}
        client={(() => {
          const c = fakeClient();
          c.review.mockResolvedValue(listResponse([], { status: 'uploading' }));
          return c;
        })()}
        uploadClient={fakeUpload()}
      />
    );
    expect(
      await screen.findByRole('heading', { name: 'Dateien hochladen' })
    ).toBeInTheDocument();
    expect(screen.getByText(/noch nicht abgeschlossen/)).toBeInTheDocument();
  });

  it('works the queue of a run in processing and shows the progress', async () => {
    const upload = fakeUpload({
      getRun: jest.fn(async () => ({
        run: {},
        progress: {
          counts: { proposed_rules: 3, verified: 2 },
          totalFiles: 5,
          totalBytes: 10,
        },
        limits: {},
      })),
      processRun: jest.fn(() => new Promise(() => undefined)),
    });
    const client = fakeClient();
    client.review.mockResolvedValue(
      listResponse(standardRows(), { status: 'processing' })
    );
    renderWithProviders(
      <ReviewView runId={RUN} client={client} uploadClient={upload} />
    );
    expect(
      await screen.findByText('Fortschritt der Verarbeitung')
    ).toBeInTheDocument();
    expect(
      (await screen.findAllByText('Verarbeitet: 3 von 5')).length
    ).toBeGreaterThan(0);
    expect(upload.processRun).toHaveBeenCalledWith(
      RUN,
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    // the decisions wait until the run is in review
    expect(
      screen.queryByRole('group', { name: /Entscheidung für/ })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Alle sicheren übernehmen/ })
    ).toBeDisabled();
  });

  it.each([
    ['applying', 'Die Übernahme läuft'],
    ['applied', 'wurde übernommen'],
    ['failed', 'fehlgeschlagen'],
  ])('shows a run in the state %s read only', async (status, text) => {
    await open(fakeClient(), fakeUpload(), standardRows(), { status });
    expect(screen.getAllByText(new RegExp(text)).length).toBeGreaterThan(0);
    expect(
      screen.queryByRole('group', { name: /Entscheidung für/ })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Alle sicheren übernehmen/ })
    ).toBeDisabled();
    expect(
      screen.getByRole('button', {
        name: 'Neueste Fassung je Dublettengruppe wählen',
      })
    ).toBeDisabled();
  });
});

describe('ReviewView: the table', () => {
  it('shows file, proposal, source, band and decision of every file, and what is derived', async () => {
    await open();
    const row = rowOf('A_Quiz.docx');
    expect(
      within(row).getByText('Komponente/K1/A_Quiz.docx')
    ).toBeInTheDocument();
    expect(within(row).getByText('Quiz leicht, K1-a')).toBeInTheDocument();
    expect(within(row).getByText('Pflicht, Phase 1')).toBeInTheDocument();
    expect(within(row).getByText('Pfad und Inhalt')).toBeInTheDocument();
    expect(within(row).getByText('Sicher')).toBeInTheDocument();
    expect(within(row).getByText('(99 %)')).toBeInTheDocument();
    const group = within(row).getByRole('group', {
      name: 'Entscheidung für A_Quiz.docx',
    });
    // three buttons, none of them pressed: nothing is decided yet
    expect(within(group).getAllByRole('button')).toHaveLength(3);
    for (const button of within(group).getAllByRole('button')) {
      expect(button).toHaveAttribute('aria-pressed', 'false');
    }
  });

  it('shows the state and the code of a file that failed instead of a proposal', async () => {
    await open();
    const row = rowOf('E_kaputt.docx');
    expect(within(row).getByText('Fehler')).toBeInTheDocument();
    expect(
      within(row).getByText('Kein lesbarer Text, vermutlich ein Scan.')
    ).toBeInTheDocument();
    expect(within(row).queryByRole('group')).not.toBeInTheDocument();
    expect(within(row).getByRole('checkbox')).toBeDisabled();
  });

  it('names a file that was not sent to the model (unclear) in its row', async () => {
    await open();
    expect(
      within(rowOf('C_lose.docx')).getByText(
        'Struktur unbekannt, nicht an die KI gesendet'
      )
    ).toBeInTheDocument();
  });

  it('says in words and symbols what the band is, not by colour alone', async () => {
    await open();
    for (const word of ['Sicher', 'Wahrscheinlich', 'Unklar', 'Widerspruch']) {
      expect(screen.getAllByText(word).length).toBeGreaterThan(0);
    }
  });

  it('opens and closes the details of a row with the keyboard and keeps aria-expanded true', async () => {
    const { user } = await open();
    const toggle = screen.getByRole('button', {
      name: 'Details zu A_Quiz.docx anzeigen',
    });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    toggle.focus();
    await user.keyboard('{Enter}');
    const hide = screen.getByRole('button', {
      name: 'Details zu A_Quiz.docx ausblenden',
    });
    expect(hide).toHaveAttribute('aria-expanded', 'true');
    const details = document.getElementById(
      hide.getAttribute('aria-controls')!
    )!;
    expect(details).toBeInTheDocument();
    expect(
      within(details).getByText('Pfad und Inhalt nennen dasselbe.')
    ).toBeInTheDocument();
    expect(within(details).getByText('(AGREE)')).toBeInTheDocument();
    await user.keyboard(' ');
    expect(
      document.getElementById(hide.getAttribute('aria-controls')!)
    ).toBeNull();
  });

  it('shows no text of a document and no part of a solution, only the reasons of the rules', async () => {
    const { user } = await open();
    await user.click(
      screen.getByRole('button', { name: 'Details zu A_Quiz.docx anzeigen' })
    );
    const text = document.body.textContent ?? '';
    for (const word of [
      'Richtige Antwort',
      'Kurzbegründung',
      'Musterlösung',
      'ZEBRAKANAL',
      'QUOKKA',
    ]) {
      expect(text).not.toContain(word);
    }
    expect(
      screen.getByText(/Inhalte und Lösungsteile werden hier nie angezeigt/)
    ).toBeInTheDocument();
  });

  it('has a header cell for each column, sortable columns say how they are sorted', async () => {
    const { user, client } = await open();
    const headers = screen.getAllByRole('columnheader');
    expect(headers).toHaveLength(6);
    expect(headers[1]).toHaveAttribute('aria-sort', 'ascending');
    expect(headers[4]).toHaveAttribute('aria-sort', 'none');
    await user.click(
      within(headers[4]).getByRole('button', { name: /Sicherheit/ })
    );
    expect(client.review).toHaveBeenLastCalledWith(
      RUN,
      { sort: 'band', page: 1 },
      expect.any(AbortSignal)
    );
  });

  it('selects the rows of a page with one box that shows a partial selection', async () => {
    const { user } = await open();
    const all = screen.getByRole('checkbox', {
      name: 'Alle Zeilen dieser Seite auswählen',
    }) as HTMLInputElement;
    await user.click(
      screen.getByRole('checkbox', { name: 'Datei A_Quiz.docx auswählen' })
    );
    expect(all.indeterminate).toBe(true);
    expect(screen.getByText('1 gewählt')).toBeInTheDocument();
    await user.click(all);
    // the file that failed cannot be decided and is not selected
    expect(screen.getByText('4 gewählt')).toBeInTheDocument();
    await user.click(all);
    expect(screen.getByText('0 gewählt')).toBeInTheDocument();
  });
});

describe('ReviewView: filters and paging', () => {
  it('shows the counts of the whole run as buttons that set and clear a filter', async () => {
    const { user, client } = await open();
    const group = screen.getByRole('group', {
      name: /Zusammenfassung des Laufs/,
    });
    const low = within(group).getByRole('button', { name: /Unklar/ });
    expect(low).toHaveAttribute('aria-pressed', 'false');
    expect(low).toHaveTextContent('1');
    await user.click(low);
    expect(client.review).toHaveBeenLastCalledWith(
      RUN,
      { band: 'low', page: 1 },
      expect.any(AbortSignal)
    );
    await waitFor(() =>
      expect(
        within(group).getByRole('button', { name: /Unklar/ })
      ).toHaveAttribute('aria-pressed', 'true')
    );
    await user.click(within(group).getByRole('button', { name: /Unklar/ }));
    expect(client.review).toHaveBeenLastCalledWith(
      RUN,
      { page: 1 },
      expect.any(AbortSignal)
    );
  });

  it('filters by duplicates, status, type and component', async () => {
    const { user, client } = await open();
    const summary = screen.getByRole('group', {
      name: /Zusammenfassung des Laufs/,
    });
    await user.click(
      within(summary).getByRole('button', { name: /^Dublette/ })
    );
    expect(client.review).toHaveBeenLastCalledWith(
      RUN,
      { duplicates: true, page: 1 },
      expect.any(AbortSignal)
    );
    await user.selectOptions(screen.getByLabelText('Status'), 'open');
    expect(client.review).toHaveBeenLastCalledWith(
      RUN,
      { duplicates: true, status: 'open', page: 1 },
      expect.any(AbortSignal)
    );
    await user.selectOptions(screen.getByLabelText('Typ'), 'quiz');
    await user.selectOptions(screen.getByLabelText('Komponente'), 'K1');
    expect(client.review).toHaveBeenLastCalledWith(
      RUN,
      {
        duplicates: true,
        status: 'open',
        docType: 'quiz',
        component: 'K1',
        page: 1,
      },
      expect.any(AbortSignal)
    );
  });

  it('searches after a pause in typing and resets everything with one button', async () => {
    const { user, client } = await open();
    await user.type(screen.getByLabelText('Suche'), 'quiz');
    await waitFor(() =>
      expect(client.review).toHaveBeenLastCalledWith(
        RUN,
        { query: 'quiz', page: 1 },
        expect.any(AbortSignal)
      )
    );
    await user.click(
      screen.getByRole('button', { name: 'Filter zurücksetzen' })
    );
    await waitFor(() =>
      expect(client.review).toHaveBeenLastCalledWith(
        RUN,
        { page: 1 },
        expect.any(AbortSignal)
      )
    );
    expect(screen.getByLabelText('Suche')).toHaveValue('');
  });

  it('says when no file matches and offers to reset the filter', async () => {
    const { user, client } = await open();
    client.review.mockResolvedValue(listResponse([], { counts: { total: 5 } }));
    await user.click(screen.getByRole('button', { name: /Unklar/ }));
    expect(
      await screen.findByText('Keine Treffer für diese Filter.')
    ).toBeInTheDocument();
    client.review.mockResolvedValue(listResponse(standardRows()));
    await user.click(
      screen.getAllByRole('button', { name: 'Filter zurücksetzen' })[0]
    );
    expect(await screen.findByRole('table')).toBeInTheDocument();
  });

  it('pages through the list and changes the size of a page', async () => {
    const { user, client } = await open(
      fakeClient(),
      fakeUpload(),
      standardRows(),
      {
        page: 1,
        pages: 3,
        matching: 120,
      }
    );
    expect(screen.getByText('Seite 1 von 3, 120 Treffer')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vorherige Seite' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Weiter' }));
    expect(client.review).toHaveBeenLastCalledWith(
      RUN,
      { page: 2 },
      expect.any(AbortSignal)
    );
    await user.selectOptions(screen.getByLabelText('Zeilen je Seite'), '100');
    expect(client.review).toHaveBeenLastCalledWith(
      RUN,
      { page: 1, pageSize: 100 },
      expect.any(AbortSignal)
    );
  });
});

describe('ReviewView: decisions', () => {
  it('writes the decision of a safe proposal at once, for the version it saw', async () => {
    const { user, client, rows } = await open(
      fakeClient(),
      fakeUpload(),
      standardRows(),
      {
        version: 4,
      }
    );
    await user.click(decisionButton('A_Quiz.docx', 'accept'));
    expect(client.decide).toHaveBeenCalledWith(RUN, 4, {
      command: 'set',
      items: [
        { fileId: rows[0].id, action: 'accept', assignment: null, note: null },
      ],
    });
    expect(
      await screen.findByText('1 Entscheidungen gespeichert.')
    ).toBeInTheDocument();
    // the list is read again afterwards
    await waitFor(() =>
      expect(client.review.mock.calls.length).toBeGreaterThan(1)
    );
  });

  it('rejects and defers with one choice', async () => {
    const { user, client, rows } = await open();
    await user.click(decisionButton('B_Text.docx', 'reject'));
    expect(client.decide).toHaveBeenLastCalledWith(RUN, 0, {
      command: 'set',
      items: [
        { fileId: rows[1].id, action: 'reject', assignment: null, note: null },
      ],
    });
    await user.click(decisionButton('B_Text.docx', 'defer'));
    expect(client.decide).toHaveBeenLastCalledWith(
      RUN,
      0,
      expect.objectContaining({
        items: [expect.objectContaining({ action: 'defer' })],
      })
    );
  });

  it('does not take an unclear proposal as it stands: it opens the editor and says why', async () => {
    const { user, client } = await open();
    await user.click(decisionButton('C_lose.docx', 'accept'));
    expect(client.decide).not.toHaveBeenCalled();
    expect(
      screen.getByText(/Für C_lose.docx gibt es keinen sicheren Vorschlag/)
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Details zu C_lose.docx ausblenden' })
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen
          .getAllByLabelText('Typ')
          .some(el => el === document.activeElement)
      ).toBe(true)
    );
  });

  it('saves a corrected assignment and accepts it', async () => {
    const { user, client, rows } = await open();
    await user.click(
      screen.getByRole('button', {
        name: 'Details zu D_Szenario.docx anzeigen',
      })
    );
    const details = document.getElementById(`details-${rows[3].id}`)!;
    await user.selectOptions(within(details).getByLabelText('Typ'), 'scenario');
    await user.selectOptions(
      within(details).getByLabelText('Komponente'),
      'K12'
    );
    await user.selectOptions(
      within(details).getByLabelText('Enabler'),
      'K12-a'
    );
    await user.click(
      within(details).getByRole('button', {
        name: 'Zuordnung speichern und übernehmen',
      })
    );
    expect(client.decide).toHaveBeenCalledWith(RUN, 0, {
      command: 'set',
      items: [
        {
          fileId: rows[3].id,
          action: 'accept',
          assignment: {
            docType: 'scenario',
            componentCode: 'K12',
            enablerCode: 'K12-a',
            quizLevel: null,
          },
          note: null,
        },
      ],
    });
  });

  it('offers only the values of the positive list: no free input of codes', async () => {
    const { user, rows } = await open();
    await user.click(
      screen.getByRole('button', { name: 'Details zu C_lose.docx anzeigen' })
    );
    const details = document.getElementById(`details-${rows[2].id}`)!;
    expect(within(details).queryByRole('textbox')).not.toBeInTheDocument();
    const components = within(details).getByLabelText(
      'Komponente'
    ) as HTMLSelectElement;
    expect([...components.options].map(o => o.value)).toEqual([
      '',
      'K1',
      'K12',
    ]);
    await user.selectOptions(components, 'K12');
    const enablers = within(details).getByLabelText(
      'Enabler'
    ) as HTMLSelectElement;
    expect([...enablers.options].map(o => o.value)).toEqual(['', 'K12-a']);
  });

  it('shows the PDF type fixed for a PDF original', async () => {
    const pdf = rowDto({
      band: 'medium',
      fileName: 'O.pdf',
      ext: 'pdf',
      effective: {
        docType: 'pdf_original',
        componentCode: 'K1',
        enablerCode: 'K1-a',
        quizLevel: 'low',
      },
    });
    const { user } = await open(fakeClient(), fakeUpload(), [pdf]);
    await user.click(
      screen.getByRole('button', { name: 'Details zu O.pdf anzeigen' })
    );
    const type = within(
      document.querySelector('tr[id^="details-"]') as HTMLElement
    ).getByLabelText('Typ') as HTMLSelectElement;
    expect(type).toBeDisabled();
    expect([...type.options].map(o => o.value)).toEqual(['', 'pdf_original']);
  });

  it('tells about the files that were skipped', async () => {
    const client = fakeClient();
    client.decide.mockResolvedValue({
      version: 1,
      written: 2,
      skipped: [
        { fileId: uuid(1), code: 'NOT_IN_POSITIVE_LIST' },
        { fileId: uuid(2), code: 'NOT_IN_POSITIVE_LIST' },
        { fileId: uuid(3), code: 'DUPLICATE_UNRESOLVED' },
      ],
    });
    const { user } = await open(client);
    await user.click(decisionButton('A_Quiz.docx', 'accept'));
    const note = await screen.findByText(
      /2 Entscheidungen gespeichert, 3 Dateien übersprungen/
    );
    expect(note).toHaveTextContent(
      '2 × Komponente oder Enabler nicht in der Liste'
    );
    expect(note).toHaveTextContent('1 × mehrere Fassungen');
  });

  it('answers a changed version with a note and a new list (409 VERSION_CONFLICT)', async () => {
    const client = fakeClient();
    client.decide.mockRejectedValue(
      new UploadApiError(409, 'changed', 'VERSION_CONFLICT')
    );
    const { user } = await open(client);
    const before = client.review.mock.calls.length;
    await user.click(decisionButton('A_Quiz.docx', 'accept'));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'wurden inzwischen geändert'
    );
    await waitFor(() =>
      expect(client.review.mock.calls.length).toBeGreaterThan(before)
    );
  });

  it('answers a run that is no longer in review (409 RUN_STATE)', async () => {
    const client = fakeClient();
    client.decide.mockRejectedValue(new UploadApiError(409, 'x', 'RUN_STATE'));
    const { user } = await open(client);
    await user.click(decisionButton('A_Quiz.docx', 'accept'));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'nicht mehr in der Prüfung'
    );
  });

  it('answers a rate limit and an unknown failure', async () => {
    const client = fakeClient();
    client.decide
      .mockRejectedValueOnce(new UploadApiError(429, 'x', 'RATE_LIMITED'))
      .mockRejectedValueOnce(new Error('boom'));
    const { user } = await open(client);
    await user.click(decisionButton('A_Quiz.docx', 'accept'));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Zu viele Anfragen'
    );
    await user.click(decisionButton('A_Quiz.docx', 'reject'));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Die Aktion ist fehlgeschlagen'
      )
    );
  });
});

describe('ReviewView: mass actions', () => {
  it('asks before it accepts all safe proposals, names the number and keeps the focus', async () => {
    const { user, client } = await open();
    const button = screen.getByRole('button', {
      name: 'Alle sicheren übernehmen (1)',
    });
    await user.click(button);
    const dialog = screen.getByRole('dialog', {
      name: 'Alle sicheren Vorschläge übernehmen',
    });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(
      within(dialog).getByText(/1 Dateien im Band Sicher/)
    ).toBeInTheDocument();
    // a stray Enter does not confirm: the focus starts on Abbrechen
    expect(
      within(dialog).getByRole('button', { name: 'Abbrechen' })
    ).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(button).toHaveFocus();
    expect(client.decide).not.toHaveBeenCalled();
    await user.click(button);
    await user.click(
      within(
        screen.getByRole('dialog', { name: 'Alle sicheren Vorschläge übernehmen' })
      ).getByRole('button', { name: 'Übernehmen' })
    );
    expect(client.decide).toHaveBeenCalledWith(RUN, 0, {
      command: 'accept_high',
    });
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    );
  });

  it('rejects a selection after the question, and clears the selection', async () => {
    const { user, client, rows } = await open();
    await user.click(
      screen.getByRole('checkbox', { name: 'Datei A_Quiz.docx auswählen' })
    );
    await user.click(
      screen.getByRole('checkbox', { name: 'Datei B_Text.docx auswählen' })
    );
    await user.click(screen.getByRole('button', { name: 'Auswahl ablehnen' }));
    const dialog = screen.getByRole('dialog', { name: 'Auswahl ablehnen' });
    expect(
      within(dialog).getByText(/2 Dateien werden abgelehnt/)
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Ablehnen' }));
    expect(client.decide).toHaveBeenCalledWith(RUN, 0, {
      command: 'bulk',
      action: 'reject',
      fileIds: [rows[0].id, rows[1].id],
    });
    await waitFor(() =>
      expect(screen.getByText('0 gewählt')).toBeInTheDocument()
    );
  });

  it('defers a selection', async () => {
    const { user, client, rows } = await open();
    await user.click(
      screen.getByRole('checkbox', { name: 'Datei C_lose.docx auswählen' })
    );
    await user.click(
      screen.getByRole('button', { name: 'Auswahl zurückstellen' })
    );
    await user.click(screen.getByRole('button', { name: 'Zurückstellen' }));
    expect(client.decide).toHaveBeenCalledWith(RUN, 0, {
      command: 'bulk',
      action: 'defer',
      fileIds: [rows[2].id],
    });
  });

  it('keeps the selection actions off until something is selected', async () => {
    const { user } = await open();
    for (const name of [
      'Zuordnung ändern',
      'Auswahl ablehnen',
      'Auswahl zurückstellen',
    ]) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
    await user.click(
      screen.getByRole('checkbox', { name: 'Datei A_Quiz.docx auswählen' })
    );
    for (const name of [
      'Zuordnung ändern',
      'Auswahl ablehnen',
      'Auswahl zurückstellen',
    ]) {
      expect(screen.getByRole('button', { name })).toBeEnabled();
    }
    await user.click(screen.getByRole('button', { name: 'Auswahl aufheben' }));
    expect(screen.getByText('0 gewählt')).toBeInTheDocument();
  });

  it('changes the assignment of a selection: only what is set, from the positive list', async () => {
    const { user, client, rows } = await open();
    await user.click(
      screen.getByRole('checkbox', { name: 'Datei A_Quiz.docx auswählen' })
    );
    await user.click(
      screen.getByRole('checkbox', { name: 'Datei B_Text.docx auswählen' })
    );
    await user.click(screen.getByRole('button', { name: 'Zuordnung ändern' }));
    const dialog = screen.getByRole('dialog', { name: 'Zuordnung ändern' });
    const apply = within(dialog).getByRole('button', {
      name: 'Für 2 Dateien übernehmen',
    });
    expect(apply).toBeDisabled();
    await user.selectOptions(within(dialog).getByLabelText('Stufe'), 'medium');
    expect(apply).toBeEnabled();
    await user.click(apply);
    expect(client.decide).toHaveBeenCalledWith(RUN, 0, {
      command: 'assign',
      fileIds: [rows[0].id, rows[1].id],
      assignment: { quizLevel: 'medium' },
    });
  });

  it('clears the enabler when the component of a selection changes without a new enabler', async () => {
    const { user, client } = await open();
    await user.click(
      screen.getByRole('checkbox', { name: 'Datei A_Quiz.docx auswählen' })
    );
    await user.click(screen.getByRole('button', { name: 'Zuordnung ändern' }));
    const dialog = screen.getByRole('dialog');
    await user.selectOptions(
      within(dialog).getByLabelText('Komponente'),
      'K12'
    );
    const enabler = within(dialog).getByLabelText(
      'Enabler'
    ) as HTMLSelectElement;
    expect([...enabler.options].map(o => o.value)).toEqual(['', 'K12-a']);
    await user.click(
      within(dialog).getByRole('button', { name: /Für 1 Dateien übernehmen/ })
    );
    expect(client.decide).toHaveBeenCalledWith(
      RUN,
      0,
      expect.objectContaining({
        assignment: { componentCode: 'K12', enablerCode: null },
      })
    );
  });

  it('chooses the newest version of every group after it has counted the groups', async () => {
    const client = fakeClient();
    client.duplicates.mockResolvedValue({
      groups: [
        group(),
        group({ key: 'quiz:2a:low', ambiguous: true, suggestedId: null }),
        group({ key: 'quiz:3a:low', resolved: true }),
      ],
      version: 0,
    });
    const { user } = await open(client);
    await user.click(
      screen.getByRole('button', {
        name: 'Neueste Fassung je Dublettengruppe wählen',
      })
    );
    const dialog = await screen.findByRole('dialog', {
      name: 'Neueste Fassung wählen',
    });
    expect(
      within(dialog).getByText(
        /In 1 Dublettengruppen wird die vorgeschlagene Fassung/
      )
    ).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole('button', { name: 'Neueste Fassung wählen' })
    );
    expect(client.decide).toHaveBeenCalledWith(RUN, 0, {
      command: 'accept_newest',
    });
  });

  it('says so when no group has a suggestion', async () => {
    const client = fakeClient();
    client.duplicates.mockResolvedValue({
      groups: [group({ ambiguous: true, suggestedId: null })],
      version: 0,
    });
    const { user } = await open(client);
    await user.click(
      screen.getByRole('button', {
        name: 'Neueste Fassung je Dublettengruppe wählen',
      })
    );
    expect(
      await screen.findByText(/keine Dublettengruppe mit einem Vorschlag/)
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('ReviewView: the duplicate view', () => {
  const dupRows = () => [
    rowDto({
      band: 'high',
      fileName: '12a_Quiz_Low_v2.docx',
      duplicate: {
        key: 'quiz:1a:low',
        size: 2,
        suggested: true,
        ambiguous: false,
      },
    }),
    rowDto({
      band: 'high',
      fileName: '12a_Quiz_Low.docx',
      duplicate: {
        key: 'quiz:1a:low',
        size: 2,
        suggested: false,
        ambiguous: false,
      },
    }),
  ];

  it('opens from the row, shows the versions with the suggestion and keeps the chosen one', async () => {
    const client = fakeClient();
    client.duplicates.mockResolvedValue({ groups: [group()], version: 0 });
    const { user } = await open(client, fakeUpload(), dupRows(), {
      counts: { duplicates: 2, acceptableHigh: 0 },
    });
    const firstRow = rowOf('12a_Quiz_Low_v2.docx');
    await user.click(
      within(firstRow).getByRole('button', { name: 'Dublette: 2 Fassungen' })
    );
    const dialog = await screen.findByRole('dialog', {
      name: /Dublette: Quiz leicht, K1-a \(2 Dateien\)/,
    });
    const radios = await within(dialog).findAllByRole('radio');
    expect(radios).toHaveLength(3);
    // the suggestion is preselected and has the focus
    expect(radios[0]).toBeChecked();
    await waitFor(() => expect(radios[0]).toHaveFocus());
    expect(within(dialog).getByText('Vorschlag')).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        /Vorschlag: die Fassung mit der höchsten Version/
      )
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(/Änderungsdatum stammt vom Browser/)
    ).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole('button', { name: 'Entscheiden' })
    );
    expect(client.decide).toHaveBeenCalledWith(RUN, 0, {
      command: 'duplicate',
      key: 'quiz:1a:low',
      keepFileId: uuid(501),
    });
  });

  it('chooses nothing when there is no suggestion, and allows to take none', async () => {
    const client = fakeClient();
    client.duplicates.mockResolvedValue({
      groups: [
        group({
          suggestedId: null,
          ambiguous: true,
          reasons: [
            {
              code: 'AMBIGUOUS_WITHIN_WINDOW',
              text: 'Gleiche Version und Änderungen innerhalb von 24 Stunden, es gibt keinen Vorschlag.',
            },
          ],
          members: group().members.map(m => ({ ...m, suggested: false })),
        }),
      ],
      version: 0,
    });
    const { user } = await open(client, fakeUpload(), dupRows(), {
      counts: { duplicates: 2 },
    });
    await user.click(
      within(rowOf('12a_Quiz_Low_v2.docx')).getByRole('button', {
        name: 'Dublette: 2 Fassungen',
      })
    );
    const dialog = await screen.findByRole('dialog');
    const radios = await within(dialog).findAllByRole('radio');
    expect(radios.every(r => !(r as HTMLInputElement).checked)).toBe(true);
    const decide = within(dialog).getByRole('button', { name: 'Entscheiden' });
    expect(decide).toBeDisabled();
    expect(
      within(dialog).getByText(/es gibt keinen Vorschlag/)
    ).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole('radio', { name: 'Keine übernehmen' })
    );
    await user.click(decide);
    expect(client.decide).toHaveBeenCalledWith(RUN, 0, {
      command: 'duplicate',
      key: 'quiz:1a:low',
      keepFileId: null,
    });
  });

  it('sends a person who wants to accept one version of a group to the duplicate view', async () => {
    const client = fakeClient();
    client.duplicates.mockResolvedValue({ groups: [group()], version: 0 });
    const { user } = await open(client, fakeUpload(), dupRows(), {
      counts: { duplicates: 2 },
    });
    await user.click(decisionButton('12a_Quiz_Low.docx', 'accept'));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(client.decide).not.toHaveBeenCalled();
  });

  it('closes with Escape and gives the focus back to the button that opened it', async () => {
    const client = fakeClient();
    client.duplicates.mockResolvedValue({ groups: [group()], version: 0 });
    const { user } = await open(client, fakeUpload(), dupRows(), {
      counts: { duplicates: 2 },
    });
    const opener = within(rowOf('12a_Quiz_Low_v2.docx')).getByRole('button', {
      name: 'Dublette: 2 Fassungen',
    });
    await user.click(opener);
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('tells when the group is gone, and when it cannot be loaded', async () => {
    const client = fakeClient();
    client.duplicates.mockResolvedValueOnce({ groups: [], version: 1 });
    const { user } = await open(client, fakeUpload(), dupRows(), {
      counts: { duplicates: 2 },
    });
    const opener = () =>
      within(rowOf('12a_Quiz_Low_v2.docx')).getByRole('button', {
        name: 'Dublette: 2 Fassungen',
      });
    await user.click(opener());
    expect(
      await screen.findByText(/Diese Gruppe gibt es nicht mehr/)
    ).toBeInTheDocument();
    await user.keyboard('{Escape}');
    client.duplicates.mockRejectedValueOnce(new Error('down'));
    await user.click(opener());
    expect(
      await within(await screen.findByRole('dialog')).findByRole('alert')
    ).toHaveTextContent('Die Daten konnten nicht geladen werden');
  });
});

describe('ReviewView: discarding a run', () => {
  it('asks first and then discards through the route, and goes back to the list', async () => {
    const upload = fakeUpload();
    const { user } = await open(fakeClient(), upload);
    await user.click(screen.getByRole('button', { name: 'Lauf verwerfen' }));
    const dialog = screen.getByRole('dialog', { name: 'Lauf verwerfen' });
    expect(
      within(dialog).getByText(/Der Lauf mit 5 Dateien wird verworfen/)
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Verwerfen' }));
    await waitFor(() => expect(upload.discardRun).toHaveBeenCalledWith(RUN));
  });

  it('says so when discarding fails', async () => {
    const upload = fakeUpload({
      discardRun: jest.fn(async () => {
        throw new Error('x');
      }),
    });
    const { user } = await open(fakeClient(), upload);
    await user.click(screen.getByRole('button', { name: 'Lauf verwerfen' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Verwerfen',
      })
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Die Aktion ist fehlgeschlagen'
    );
  });
});

describe('ReviewView: review again', () => {
  it.each(['applied', 'failed'])('offers "Erneut prüfen" for a run in the state %s and asks first', async status => {
    const client = fakeClient();
    const { user } = await open(client, fakeUpload(), standardRows(), { status });
    await user.click(screen.getByRole('button', { name: 'Erneut prüfen' }));
    const dialog = screen.getByRole('dialog', { name: 'Lauf erneut prüfen' });
    expect(within(dialog).getByText(/Ein früherer Probelauf gilt nicht mehr/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Abbrechen' })).toHaveFocus();
    expect(client.reopen).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Erneut prüfen' }));
    await waitFor(() => expect(client.reopen).toHaveBeenCalledWith(RUN));
    expect(await screen.findByText('Der Lauf ist wieder in der Prüfung.')).toBeInTheDocument();
    // the list is read again
    await waitFor(() => expect(client.review.mock.calls.length).toBeGreaterThan(1));
  });

  it.each(['review', 'processing', 'draft', 'applying', 'discarded'])('has no such button for a run in the state %s', async status => {
    await open(fakeClient(), fakeUpload(), standardRows(), { status });
    expect(screen.queryByRole('button', { name: 'Erneut prüfen' })).not.toBeInTheDocument();
  });

  it('says so when the run is no longer in a state that can be reviewed again', async () => {
    const client = fakeClient();
    client.reopen.mockRejectedValue(new UploadApiError(409, 'x', 'RUN_STATE'));
    const { user } = await open(client, fakeUpload(), standardRows(), { status: 'applied' });
    await user.click(screen.getByRole('button', { name: 'Erneut prüfen' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Erneut prüfen' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('nicht erneut prüfen');
  });
});

describe('ReviewView: the skip link', () => {
  it('has a link to the list that is the first thing a keyboard reaches', async () => {
    const { user } = await open();
    await act(async () => {
      await user.tab();
    });
    const link = screen.getByRole('link', { name: 'Zur Prüfliste' });
    expect(link).toHaveAttribute('href', '#review-list');
    expect(link).toHaveFocus();
    expect(document.getElementById('review-list')).toBeInTheDocument();
  });
});

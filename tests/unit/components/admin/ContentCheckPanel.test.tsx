import { screen, waitFor, fireEvent, within } from '@testing-library/react';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import { ContentCheckPanel } from '@/components/admin/ContentCheckPanel';
import { ContentStatsView } from '@/components/admin/ContentStatsView';
import { authFetch } from '@/lib/authFetch';
import { compareToTarget } from '@/lib/catalog/content-targets';
import type { ContentStatsResponse } from '@/lib/catalog/content-targets';
import type {
  ContentCheckReport,
  Finding,
} from '@/lib/catalog/content-check/types';

jest.mock('@/lib/authFetch', () => ({ authFetch: jest.fn() }));

const CATALOG = '00000000-0000-4000-8000-000000000002';
const fetchMock = authFetch as jest.MockedFunction<typeof authFetch>;

const finding = (over: Partial<Finding> = {}): Finding => ({
  rule: 'enabler.quiz.missing',
  severity: 'error',
  source: 'script',
  category: 'quiz',
  summary: '2 Enabler haben nicht alle drei Lektionsquizze.',
  details: 'Betroffen: 2.',
  refs: [
    { type: 'enabler', id: 'e1', label: 'K1 / K1-a: Erstes Thema' },
    { type: 'enabler', id: 'e2', label: 'K1 / K1-b: Zweites Thema' },
  ],
  hint: 'Die fehlenden Quizze importieren.',
  ...over,
});

function report(
  findings: Finding[],
  over: Partial<ContentCheckReport> = {}
): ContentCheckReport {
  const counts = { error: 0, warning: 0, info: 0 };
  for (const f of findings) counts[f.severity] += 1;
  return {
    catalogId: CATALOG,
    catalogCode: 'KFBM',
    generatedAt: '2026-11-03T10:15:00.000Z',
    findings,
    counts,
    ran: { script: true, ki: false, plan: false },
    notes: [],
    ...over,
  };
}

const sample = [
  finding(),
  finding({
    rule: 'title.glued',
    severity: 'warning',
    category: 'text',
    summary: '1 Titel enthält zusammengeklebte Wörter (Importrest).',
    refs: [{ type: 'enabler', id: 'e3', label: 'gestaltenInhalt in K2-a' }],
    hint: undefined,
    details: undefined,
  }),
  finding({
    rule: 'description.equalsTitle',
    severity: 'info',
    category: 'text',
    summary: '200 Beschreibungen sind gleich dem Titel.',
    refs: [],
  }),
  finding({
    rule: 'ki.thema_passt_nicht',
    severity: 'warning',
    source: 'ki',
    category: 'content',
    summary: 'KI-Einschätzung: Szenario passt möglicherweise nicht zum Thema.',
    details:
      'Begründung der KI: andere Themen. (Sicherheit laut KI 70 Prozent.)',
    refs: [{ type: 'enabler', id: 'e4', label: 'K9-b: Planen mit Modellen' }],
  }),
  finding({
    rule: 'plan.target.scenarios',
    severity: 'warning',
    source: 'plan',
    category: 'plan',
    summary: 'Es fehlen 2 Szenarien gegenüber dem Soll.',
    refs: [{ type: 'catalog', id: CATALOG, label: 'KFBM: Kaufleute' }],
  }),
];

const answer = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as Response;

function renderPanel() {
  return renderWithProviders(
    <ContentCheckPanel catalogId={CATALOG} catalogCode="KFBM" />
  );
}

/** The button of a severity group (the heading holds it, a finding button does not). */
const groupButton = (name: RegExp) =>
  within(screen.getByRole('heading', { level: 4, name })).getByRole('button');

const runButton = () => screen.getByRole('button', { name: 'Prüfen' });
const kiButton = () => screen.getByRole('button', { name: 'Prüfen mit KI' });

describe('ContentCheckPanel: before a run', () => {
  beforeEach(() => jest.clearAllMocks());

  it('loads nothing, says that no check was started and offers both buttons', () => {
    renderPanel();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      screen.getByRole('heading', { level: 3, name: /Inhaltsprüfung/ })
    ).toBeInTheDocument();
    expect(
      screen.getByText('Noch keine Prüfung gestartet.')
    ).toBeInTheDocument();
    expect(runButton()).toBeEnabled();
    expect(kiButton()).toBeEnabled();
    // The empty message is only for a check that really ran
    expect(screen.queryByText('Keine Auffälligkeiten gefunden.')).toBeNull();
  });
});

describe('ContentCheckPanel: a script run', () => {
  beforeEach(() => jest.clearAllMocks());

  it('posts the catalog without the AI, shows the loading state, then the result by severity', async () => {
    let resolve: (value: Response) => void = () => {};
    fetchMock.mockReturnValueOnce(
      new Promise<Response>(r => {
        resolve = r;
      })
    );
    renderPanel();
    fireEvent.click(runButton());

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/admin/catalogs/${CATALOG}/content-check`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ ki: false }),
      })
    );
    // Loading: both buttons off, a status text, the section is busy
    expect(screen.getByRole('status')).toHaveTextContent(
      'Die Prüfung läuft ...'
    );
    expect(runButton()).toBeDisabled();
    expect(kiButton()).toBeDisabled();

    resolve(answer(report(sample)));
    await screen.findByText('2 Enabler haben nicht alle drei Lektionsquizze.');

    expect(runButton()).toBeEnabled();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Prüfung abgeschlossen'
    );
    // Counts with symbol and text
    expect(
      screen.getByText('5 Auffälligkeiten', { exact: false })
    ).toBeInTheDocument();
    // The groups: errors and warnings open, the notes folded away
    const errors = groupButton(/^Fehler/);
    const warnings = groupButton(/^Warnungen/);
    const notes = groupButton(/^Hinweise/);
    expect(errors).toHaveAttribute('aria-expanded', 'true');
    expect(warnings).toHaveAttribute('aria-expanded', 'true');
    expect(notes).toHaveAttribute('aria-expanded', 'false');
    expect(
      screen.queryByText('200 Beschreibungen sind gleich dem Titel.')
    ).not.toBeVisible();
    fireEvent.click(notes);
    expect(notes).toHaveAttribute('aria-expanded', 'true');
    expect(
      screen.getByText('200 Beschreibungen sind gleich dem Titel.')
    ).toBeVisible();
    // Grouped by category inside a severity
    expect(screen.getByText('Quizze (1)')).toBeInTheDocument();
    // Once under the warnings, once under the notes
    expect(screen.getAllByText('Titel und Texte (1)')).toHaveLength(2);
  });

  it('a finding opens to its details, its recommendation and the objects, by button', async () => {
    fetchMock.mockResolvedValueOnce(answer(report(sample)));
    renderPanel();
    fireEvent.click(runButton());
    const summary = await screen.findByRole('button', {
      name: /2 Enabler haben nicht alle drei Lektionsquizze/,
    });
    expect(summary).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('K1 / K1-a: Erstes Thema')).toBeNull();
    expect(screen.getByText('2 Objekte')).toBeInTheDocument();
    fireEvent.click(summary);
    expect(summary).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('K1 / K1-a: Erstes Thema')).toBeInTheDocument();
    expect(screen.getByText('K1 / K1-b: Zweites Thema')).toBeInTheDocument();
    expect(
      screen.getByText('Die fehlenden Quizze importieren.')
    ).toBeInTheDocument();
    expect(screen.getByText('Betroffen: 2.')).toBeInTheDocument();
    // The severity is also words for a screen reader, not only the color
    expect(within(summary).getByText(/Fehler:/)).toBeInTheDocument();
    fireEvent.click(summary);
    expect(screen.queryByText('K1 / K1-a: Erstes Thema')).toBeNull();
  });

  it('a single object is named right below the summary', async () => {
    fetchMock.mockResolvedValueOnce(answer(report(sample)));
    renderPanel();
    fireEvent.click(runButton());
    await screen.findByText(/zusammengeklebte Wörter/);
    expect(screen.getByText(/gestaltenInhalt in K2-a/)).toBeInTheDocument();
  });

  it('names what ran and what did not, and shows the notes of the run', async () => {
    fetchMock.mockResolvedValueOnce(
      answer(
        report(sample, {
          notes: ['Nicht geprüft: ob die Dateien im Speicher vorhanden sind.'],
        })
      )
    );
    renderPanel();
    fireEvent.click(runButton());
    await screen.findByText('Anmerkungen zum Lauf');
    expect(screen.getByText('Skript: gelaufen')).toBeInTheDocument();
    expect(screen.getByText('KI: nicht angefordert')).toBeInTheDocument();
    expect(screen.getByText('Plan: nicht gelaufen')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Nicht geprüft: ob die Dateien im Speicher vorhanden sind.'
      )
    ).toBeInTheDocument();
  });

  it('says "no findings" only after a run that found nothing', async () => {
    fetchMock.mockResolvedValueOnce(answer(report([])));
    renderPanel();
    expect(screen.queryByText('Keine Auffälligkeiten gefunden.')).toBeNull();
    fireEvent.click(runButton());
    expect(
      await screen.findByText('Keine Auffälligkeiten gefunden.')
    ).toBeInTheDocument();
  });
});

describe('ContentCheckPanel: the run with the AI', () => {
  beforeEach(() => jest.clearAllMocks());

  it('posts ki true, names the AI as running and marks an AI finding as an assessment', async () => {
    let resolve: (value: Response) => void = () => {};
    fetchMock.mockReturnValueOnce(
      new Promise<Response>(r => {
        resolve = r;
      })
    );
    renderPanel();
    fireEvent.click(kiButton());
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ body: JSON.stringify({ ki: true }) })
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'Die KI-Prüfung läuft, das kann bis zu einer Minute dauern.'
    );
    resolve(
      answer(report(sample, { ran: { script: true, ki: true, plan: true } }))
    );
    const item = await screen.findByRole('button', {
      name: /KI-Einschätzung: Szenario passt möglicherweise nicht zum Thema/,
    });
    // The label sits on the finding itself, as a badge with symbol and text
    expect(within(item).getAllByText('KI-Einschätzung').length).toBeGreaterThan(
      0
    );
    expect(screen.getByText('KI: gelaufen')).toBeInTheDocument();
    fireEvent.click(item);
    expect(
      screen.getByText(
        'Von der KI geschätzt, kein Beweis. Ein Mensch entscheidet.'
      )
    ).toBeInTheDocument();
  });

  it('a requested AI that did not run is said so', async () => {
    fetchMock.mockResolvedValueOnce(
      answer(
        report(sample.slice(0, 1), {
          notes: [
            'KI-Prüfung nicht gelaufen: Sie ist in dieser Umgebung nicht eingeschaltet.',
          ],
        })
      )
    );
    renderPanel();
    fireEvent.click(kiButton());
    await screen.findByText('KI: nicht gelaufen');
    expect(screen.getByText(/nicht eingeschaltet/)).toBeInTheDocument();
  });
});

describe('ContentCheckPanel: filter by source', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows only the findings of the chosen source, with the counts on the buttons', async () => {
    fetchMock.mockResolvedValueOnce(answer(report(sample)));
    renderPanel();
    fireEvent.click(runButton());
    await screen.findByText(/zusammengeklebte Wörter/);

    const filter = screen.getByRole('group', { name: 'Nach Quelle filtern' });
    const all = within(filter).getByRole('button', { name: /^Alle/ });
    const script = within(filter).getByRole('button', { name: /^Skript/ });
    const ki = within(filter).getByRole('button', { name: /^KI-Einschätzung/ });
    const plan = within(filter).getByRole('button', { name: /^Plan/ });
    expect(all).toHaveAttribute('aria-pressed', 'true');
    expect(all).toHaveTextContent('5');
    expect(script).toHaveTextContent('3');
    expect(ki).toHaveTextContent('1');
    expect(plan).toHaveTextContent('1');

    fireEvent.click(ki);
    expect(ki).toHaveAttribute('aria-pressed', 'true');
    expect(all).toHaveAttribute('aria-pressed', 'false');
    expect(
      screen.getByText(/Szenario passt möglicherweise/)
    ).toBeInTheDocument();
    expect(screen.queryByText(/zusammengeklebte Wörter/)).toBeNull();
    expect(screen.queryByText(/Es fehlen 2 Szenarien/)).toBeNull();

    fireEvent.click(plan);
    expect(screen.getByText(/Es fehlen 2 Szenarien/)).toBeInTheDocument();
  });

  it('says that a source has no findings, which is not "no findings at all"', async () => {
    fetchMock.mockResolvedValueOnce(answer(report(sample.slice(0, 2))));
    renderPanel();
    fireEvent.click(runButton());
    await screen.findByText(/Lektionsquizze/);
    fireEvent.click(screen.getByRole('button', { name: /^KI-Einschätzung/ }));
    expect(
      screen.getByText('Keine Auffälligkeiten aus dieser Quelle.')
    ).toBeInTheDocument();
    expect(screen.queryByText('Keine Auffälligkeiten gefunden.')).toBeNull();
  });
});

describe('ContentCheckPanel: errors', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each([
    [500, 'Die Prüfung konnte nicht ausgeführt werden.'],
    [429, 'Zu viele Prüfungen in kurzer Zeit.'],
    [409, 'Für diese Ausbildung läuft schon eine KI-Prüfung.'],
    [403, 'Die Inhaltsprüfung dürfen nur Plattform-Administratoren starten.'],
    [404, 'Die Ausbildung wurde nicht gefunden.'],
  ])(
    'status %s gives a specific message and the buttons work again',
    async (status, text) => {
      fetchMock.mockResolvedValueOnce(answer({ error: 'x' }, status));
      renderPanel();
      fireEvent.click(runButton());
      expect(await screen.findByRole('alert')).toHaveTextContent(text);
      expect(runButton()).toBeEnabled();
      expect(screen.queryByText('Keine Auffälligkeiten gefunden.')).toBeNull();
    }
  );

  it('a network failure is reported and an earlier result is not mistaken for the new one', async () => {
    fetchMock.mockResolvedValueOnce(answer(report(sample)));
    renderPanel();
    fireEvent.click(runButton());
    await screen.findByText(/Lektionsquizze/);
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    fireEvent.click(runButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'konnte nicht ausgeführt werden'
    );
    // The old result is gone, it is not shown next to the error as if it were new
    expect(screen.queryByText(/Lektionsquizze/)).toBeNull();
    expect(
      screen.queryByRole('group', { name: 'Bericht herunterladen' })
    ).toBeNull();
    // After a retry that works the error is gone
    fetchMock.mockResolvedValueOnce(answer(report([])));
    fireEvent.click(runButton());
    await screen.findByText('Keine Auffälligkeiten gefunden.');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('ContentCheckPanel: download', () => {
  const blobs: Blob[] = [];
  const names: string[] = [];
  let clickSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    blobs.length = 0;
    names.length = 0;
    (URL as any).createObjectURL = jest.fn((blob: Blob) => {
      blobs.push(blob);
      return 'blob:test';
    });
    (URL as any).revokeObjectURL = jest.fn();
    clickSpy = jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        names.push(this.download);
      });
  });
  afterEach(() => clickSpy.mockRestore());

  const readBlob = (blob: Blob) =>
    new Promise<string>(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(blob);
    });

  it('offers the report as JSON and CSV only after a run', async () => {
    renderPanel();
    expect(
      screen.queryByRole('group', { name: 'Bericht herunterladen' })
    ).toBeNull();
    fetchMock.mockResolvedValueOnce(answer(report(sample)));
    fireEvent.click(runButton());
    await screen.findByText(/Lektionsquizze/);
    const group = screen.getByRole('group', { name: 'Bericht herunterladen' });
    expect(within(group).getByRole('button', { name: /JSON/ })).toBeEnabled();
    expect(within(group).getByRole('button', { name: /CSV/ })).toBeEnabled();
  });

  it('the JSON is the report as it came', async () => {
    const data = report(sample);
    fetchMock.mockResolvedValueOnce(answer(data));
    renderPanel();
    fireEvent.click(runButton());
    await screen.findByText(/Lektionsquizze/);
    fireEvent.click(screen.getByRole('button', { name: /JSON/ }));
    expect(names).toEqual(['inhaltspruefung-KFBM-2026-11-03.json']);
    expect(JSON.parse(await readBlob(blobs[0]))).toEqual(data);
  });

  it('the CSV has one row per finding, translated headers and no formula injection', async () => {
    const data = report([
      finding(),
      finding({
        summary: '=HYPERLINK("http://x")',
        refs: [{ type: 'enabler', id: 'x', label: '@SUM(1)' }],
        severity: 'info',
      }),
    ]);
    fetchMock.mockResolvedValueOnce(answer(data));
    renderPanel();
    fireEvent.click(runButton());
    await screen.findByText(/Lektionsquizze/);
    fireEvent.click(screen.getByRole('button', { name: /CSV/ }));
    expect(names).toEqual(['inhaltspruefung-KFBM-2026-11-03.csv']);
    const text = await readBlob(blobs[0]);
    const lines = text.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(
      '"Schweregrad";"Quelle";"Kategorie";"Regel";"Zusammenfassung";"Details";"Empfehlung";"Objekte"'
    );
    expect(lines[1]).toContain(
      '"Fehler";"Skript";"Quizze";"enabler.quiz.missing"'
    );
    expect(lines[1]).toContain(
      'Enabler: K1 / K1-a: Erstes Thema | Enabler: K1 / K1-b'
    );
    // A cell that starts like a formula gets a leading quote
    expect(lines[2]).toContain(`"'=HYPERLINK(""http://x"")"`);
  });
});

describe('ContentCheckPanel in the statistics page', () => {
  const stats = (canEditTargets: boolean): ContentStatsResponse => ({
    targetsVisible: canEditTargets,
    canEditTargets,
    catalogs: [
      {
        catalogId: CATALOG,
        code: 'KFBM',
        title: 'Kaufleute für Büromanagement',
        isActive: true,
        metrics: [
          {
            id: 'enablers',
            actual: 1,
            active: 1,
            target: null,
            ...compareToTarget(1, null),
          },
        ],
        questions: 0,
        mappings: 0,
      },
    ],
  });

  beforeEach(() => jest.clearAllMocks());

  it('is part of the page for the platform admin, one per training, and loads nothing by itself', async () => {
    fetchMock.mockResolvedValue(answer(stats(true)));
    renderWithProviders(<ContentStatsView />);
    await screen.findByText('Kaufleute für Büromanagement');
    expect(
      screen.getByRole('heading', { level: 3, name: /Inhaltsprüfung/ })
    ).toBeInTheDocument();
    // Only the statistics were requested
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/content-stats');
  });

  it('is not on the page for the admin of an organization', async () => {
    fetchMock.mockResolvedValue(answer(stats(false)));
    renderWithProviders(<ContentStatsView />);
    await waitFor(() =>
      expect(
        screen.getByText('Kaufleute für Büromanagement')
      ).toBeInTheDocument()
    );
    expect(
      screen.queryByRole('heading', { name: /Inhaltsprüfung/ })
    ).toBeNull();
    expect(screen.queryByRole('button', { name: 'Prüfen mit KI' })).toBeNull();
  });
});

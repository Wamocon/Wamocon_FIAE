import { act, screen, waitFor, fireEvent, within } from '@testing-library/react';
import toast from 'react-hot-toast';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import { ContentPlanPanel } from '@/components/admin/ContentPlanPanel';
import { ContentStatsView } from '@/components/admin/ContentStatsView';
import { authFetch } from '@/lib/authFetch';
import { planToRows } from '@/lib/catalog/content-plan/rows';
import type { ContentStatsResponse } from '@/lib/catalog/content-targets';
import { compareToTarget } from '@/lib/catalog/content-targets';

jest.mock('@/lib/authFetch', () => ({ authFetch: jest.fn() }));
jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { success: jest.fn(), error: jest.fn() },
}));

const CAT = '00000000-0000-4000-8000-000000000002';
const BASE = `/api/admin/catalogs/${CAT}/content-plan`;

const reply = (data: unknown, status = 200) =>
  ({
    ok: status < 400,
    status,
    json: async () => data,
    blob: async () => new Blob(['x']),
  }) as unknown as Response;

const storedPlan = {
  plan: {
    totals: { enablers: 226 },
    components: [{ code: 'K1' }],
    learningFields: [{ code: 'LF1' }, { code: 'LF2' }],
  },
  source: {
    fileName: 'rahmenplan.xlsx',
    savedAt: '2026-11-03T10:00:00.000Z',
    fieldCount: 5,
    method: 'script',
  },
};

const scriptRows = planToRows(
  {
    totals: { enablers: 226, hours: 4800 },
    components: [{ code: 'K1', title: 'Grundlagen', hours: 80 }],
    relations: [{ type: 'enabler_learning_field', from: 'K1-a', to: 'LF1' }],
    notes: ['Ein Hinweis'],
  },
  'Blatt Gesamt, Zeile 2'
);

type Handlers = {
  stored?: unknown;
  parse?: Response | (() => Response);
  put?: Response | (() => Response);
  del?: Response;
};

function mockApi(h: Handlers = {}) {
  (authFetch as jest.Mock).mockImplementation(
    async (url: string, init?: RequestInit) => {
      if (url.startsWith(`${BASE}/template`)) return reply({});
      if (url === `${BASE}/parse`) {
        const p = h.parse ?? reply({});
        return typeof p === 'function' ? p() : p;
      }
      if (url === BASE && init?.method === 'PUT') {
        const p = h.put ?? reply({});
        return typeof p === 'function' ? p() : p;
      }
      if (url === BASE && init?.method === 'DELETE') {
        return h.del ?? reply({ catalogId: CAT, stored: null });
      }
      if (url === BASE)
        return reply({ catalogId: CAT, stored: h.stored ?? null });
      throw new Error(`unexpected request ${url}`);
    }
  );
}

const proposalAnswer = (over: Record<string, unknown> = {}) =>
  reply({
    catalogId: CAT,
    fileName: 'plan.xlsx',
    method: 'script',
    rows: scriptRows,
    issues: [],
    warnings: [],
    ...over,
  });

const calls = (method?: string) =>
  (authFetch as jest.Mock).mock.calls.filter(
    ([, init]) => (init?.method ?? 'GET') === (method ?? 'GET')
  );

function renderPanel(onChanged = jest.fn()) {
  const view = renderWithProviders(
    <ContentPlanPanel catalogId={CAT} onChanged={onChanged} />
  );
  return { ...view, onChanged };
}
const open = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Plan-Dokument öffnen' }));
  await screen.findByText(/Noch kein Plan gespeichert|Quelle:/);
};
const chooseFile = (container: HTMLElement, file: File) => {
  const input = container.querySelector('input[type=file]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
};
const xlsx = () => new File(['PK'], 'plan.xlsx');

beforeEach(() => {
  jest.clearAllMocks();
  global.URL.createObjectURL = jest.fn(() => 'blob:x');
  global.URL.revokeObjectURL = jest.fn();
});

describe('ContentPlanPanel: the section', () => {
  it('says it is optional and never replaces the manual numbers', async () => {
    mockApi();
    renderPanel();
    expect(
      screen.getByRole('group', { name: 'Plan-Dokument' })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Optional, zusätzlich zur manuellen Eingabe/)
    ).toBeInTheDocument();
    // nothing is loaded before the section is opened
    expect(authFetch).not.toHaveBeenCalled();
    const toggle = screen.getByRole('button', { name: 'Plan-Dokument öffnen' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await open();
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(
      screen.getByText(/Ein Plan ersetzt nie die manuellen Zahlen/)
    ).toBeInTheDocument();
    expect(screen.getByText('Noch kein Plan gespeichert.')).toBeInTheDocument();
  });

  it('shows the saved plan with its source and removes it after a confirmation', async () => {
    mockApi({ stored: storedPlan });
    const { onChanged } = renderPanel();
    await open();
    expect(
      screen.getByText(
        /Quelle: rahmenplan\.xlsx, per Skript gelesen, .*, 5 Felder\./
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText('1 Komponenten, 2 Lernfelder, 0 Beziehungen.')
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Plan entfernen' }));
    expect(
      screen.getByText(/Die manuellen Soll-Zahlen bleiben unverändert/)
    ).toBeInTheDocument();
    // nothing is deleted before the confirmation
    expect(calls('DELETE')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Ja, entfernen' }));
    await waitFor(() => expect(calls('DELETE')).toHaveLength(1));
    expect(
      await screen.findByText('Noch kein Plan gespeichert.')
    ).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('Plan entfernt.');
  });

  it('can cancel the removal', async () => {
    mockApi({ stored: storedPlan });
    renderPanel();
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Plan entfernen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(
      screen.getByRole('button', { name: 'Plan entfernen' })
    ).toBeInTheDocument();
    expect(calls('DELETE')).toHaveLength(0);
  });

  it('downloads both templates through the authorized fetch', async () => {
    mockApi();
    renderPanel();
    await open();
    fireEvent.click(
      screen.getByRole('button', { name: 'Vorlage herunterladen (Excel)' })
    );
    await waitFor(() =>
      expect(calls().some(([u]) => u === `${BASE}/template?format=xlsx`)).toBe(
        true
      )
    );
    fireEvent.click(screen.getByRole('button', { name: 'Vorlage als JSON' }));
    await waitFor(() =>
      expect(calls().some(([u]) => u === `${BASE}/template?format=json`)).toBe(
        true
      )
    );
    expect(global.URL.createObjectURL).toHaveBeenCalledTimes(2);
  });

  it('says so when the template cannot be loaded', async () => {
    mockApi();
    (authFetch as jest.Mock).mockImplementation(async (url: string) =>
      url.includes('/template') ? reply({}, 500) : reply({ stored: null })
    );
    renderPanel();
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Vorlage als JSON' }));
    expect(
      await screen.findByText('Die Vorlage konnte nicht geladen werden.')
    ).toBeInTheDocument();
  });

  it('says so when the saved plan cannot be loaded', async () => {
    (authFetch as jest.Mock).mockResolvedValue(reply({}, 500));
    renderPanel();
    fireEvent.click(
      screen.getByRole('button', { name: 'Plan-Dokument öffnen' })
    );
    expect(
      await screen.findByText(
        'Der gespeicherte Plan konnte nicht geladen werden.'
      )
    ).toBeInTheDocument();
  });
});

describe('ContentPlanPanel: upload and proposal', () => {
  it('reads an Excel file by script and shows every field with its source', async () => {
    mockApi({ parse: proposalAnswer() });
    const { container } = renderPanel();
    await open();
    chooseFile(container, xlsx());

    const heading = await screen.findByRole('heading', {
      name: 'Vorschlag aus plan.xlsx',
    });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(
      screen.getByText('Per Skript nach der Vorlage gelesen')
    ).toBeInTheDocument();
    expect(screen.queryByText('KI-Einschätzung, bitte prüfen')).toBeNull();

    // one table per part, a quote per field, every field switched on
    const post = calls('POST')[0];
    expect(post[0]).toBe(`${BASE}/parse`);
    const form = post[1].body as FormData;
    expect((form.get('file') as File).name).toBe('plan.xlsx');
    expect(form.get('ki')).toBeNull();
    expect(
      screen.getByRole('heading', { name: 'Gesamtzahlen' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Komponenten' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Beziehungen' })
    ).toBeInTheDocument();
    expect(screen.getAllByText('Blatt Gesamt, Zeile 2').length).toBe(
      scriptRows.length
    );
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes.every(b => (b as HTMLInputElement).checked)).toBe(true);
    expect(
      screen.getByRole('button', { name: `Übernehmen (${scriptRows.length})` })
    ).toBeEnabled();
    expect(
      screen.getByText(
        `${scriptRows.length} von ${scriptRows.length} Feldern ausgewählt`
      )
    ).toBeInTheDocument();
  });

  it('applies only the selected fields and the edited values', async () => {
    mockApi({
      parse: proposalAnswer(),
      put: reply({ catalogId: CAT, stored: storedPlan }),
    });
    const { container, onChanged } = renderPanel();
    await open();
    chooseFile(container, xlsx());
    await screen.findByRole('heading', { name: 'Vorschlag aus plan.xlsx' });

    // switch off the hours, change the enablers
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Feld Stunden gesamt übernehmen' })
    );
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Wert von Enabler' }),
      {
        target: { value: '230' },
      }
    );
    expect(
      screen.getByText(
        `${scriptRows.length - 1} von ${scriptRows.length} Feldern ausgewählt`
      )
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', {
        name: `Übernehmen (${scriptRows.length - 1})`,
      })
    );

    await waitFor(() => expect(calls('PUT')).toHaveLength(1));
    const body = JSON.parse(calls('PUT')[0][1].body);
    expect(body).toEqual({
      plan: {
        totals: { enablers: 230 },
        components: [{ code: 'K1', title: 'Grundlagen', hours: 80 }],
        relations: [
          { type: 'enabler_learning_field', from: 'K1-a', to: 'LF1' },
        ],
        notes: ['Ein Hinweis'],
      },
      fileName: 'plan.xlsx',
      method: 'script',
    });
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(toast.success).toHaveBeenCalledWith(
      'Plan gespeichert. Die manuellen Soll-Zahlen sind unverändert.'
    );
    // the proposal is gone, the focus is back on the upload button
    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { name: 'Vorschlag aus plan.xlsx' })
      ).toBeNull()
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Dokument hochladen' })
      ).toHaveFocus()
    );
  });

  it('does not save an invalid edit, marks the field and says so', async () => {
    mockApi({ parse: proposalAnswer() });
    const { container } = renderPanel();
    await open();
    chooseFile(container, xlsx());
    await screen.findByRole('heading', { name: 'Vorschlag aus plan.xlsx' });
    // the rows are drawn once more shortly after the heading (the proposal settles):
    // let it settle, then ask the DOM for the field and change it
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });
    const field = screen.getByRole('textbox', { name: 'Wert von Enabler' });
    fireEvent.change(field, { target: { value: '-5' } });
    fireEvent.click(
      screen.getByRole('button', { name: `Übernehmen (${scriptRows.length})` })
    );
    await waitFor(() => expect(field).toHaveAttribute('aria-invalid', 'true'));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        '1 Felder haben einen ungültigen Wert'
      )
    );
    expect(calls('PUT')).toHaveLength(0);
  });

  it('select all and clear all, and nothing can be applied without a field', async () => {
    mockApi({ parse: proposalAnswer() });
    const { container } = renderPanel();
    await open();
    chooseFile(container, xlsx());
    await screen.findByRole('heading', { name: 'Vorschlag aus plan.xlsx' });
    const all = screen.getByRole('checkbox', { name: 'Alle Felder auswählen' });
    expect(all).toBeChecked();
    fireEvent.click(all);
    expect(all).not.toBeChecked();
    expect(
      screen.getByRole('button', { name: 'Übernehmen (0)' })
    ).toBeDisabled();
    fireEvent.click(all);
    expect(all).toBeChecked();
  });

  it('discards the proposal', async () => {
    mockApi({ parse: proposalAnswer() });
    const { container } = renderPanel();
    await open();
    chooseFile(container, xlsx());
    await screen.findByRole('heading', { name: 'Vorschlag aus plan.xlsx' });
    fireEvent.click(screen.getByRole('button', { name: 'Verwerfen' }));
    expect(
      screen.queryByRole('heading', { name: 'Vorschlag aus plan.xlsx' })
    ).toBeNull();
    expect(calls('PUT')).toHaveLength(0);
    expect(toast.success).toHaveBeenCalledWith('Vorschlag verworfen.');
  });

  it('warns about the unchanged template and does not preselect it', async () => {
    mockApi({ parse: proposalAnswer({ warnings: ['EXAMPLE_TEMPLATE'] }) });
    const { container } = renderPanel();
    await open();
    chooseFile(container, xlsx());
    await screen.findByRole('heading', { name: 'Vorschlag aus plan.xlsx' });
    expect(
      screen.getByText(/unveränderte Vorlage mit erfundenen Beispielwerten/)
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Übernehmen (0)' })
    ).toBeDisabled();
  });

  it('lists what could not be read, with the place', async () => {
    mockApi({
      parse: proposalAnswer({
        issues: [{ where: 'Blatt Gesamt, Zeile 4', message: 'invalid_value' }],
      }),
    });
    const { container } = renderPanel();
    await open();
    chooseFile(container, xlsx());
    await screen.findByRole('heading', { name: 'Vorschlag aus plan.xlsx' });
    expect(
      screen.getByText(
        '1 Angaben konnten nicht gelesen werden und fehlen im Vorschlag'
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Blatt Gesamt, Zeile 4: ungültiger Wert oder außerhalb der Grenzen/
      )
    ).toBeInTheDocument();
  });

  it('reads by drag and drop', async () => {
    mockApi({ parse: proposalAnswer() });
    renderPanel();
    await open();
    const zone = screen
      .getByRole('button', { name: /Dokument hochladen/ })
      .closest('div') as HTMLElement;
    fireEvent.dragOver(zone);
    expect(screen.getByText('Zum Ablegen loslassen')).toBeInTheDocument();
    fireEvent.drop(zone, { dataTransfer: { files: [xlsx()] } });
    await screen.findByRole('heading', { name: 'Vorschlag aus plan.xlsx' });
    expect(calls('POST')).toHaveLength(1);
  });

  it('the upload button opens the file dialog (keyboard)', async () => {
    mockApi();
    const { container } = renderPanel();
    await open();
    const input = container.querySelector(
      'input[type=file]'
    ) as HTMLInputElement;
    const click = jest.spyOn(input, 'click');
    const button = screen.getByRole('button', { name: 'Dokument hochladen' });
    button.focus();
    fireEvent.click(button);
    expect(click).toHaveBeenCalled();
    expect(input).toHaveAttribute('accept', '.docx,.xlsx,.csv,.json,.pdf');
  });
});

describe('ContentPlanPanel: checks before the upload and errors', () => {
  it.each([
    ['plan.exe', 'Dieser Dateityp wird nicht gelesen'],
    ['leer.csv', 'Die Datei ist leer'],
  ])('refuses %s on the client side as well', async (name, text) => {
    mockApi();
    const { container } = renderPanel();
    await open();
    chooseFile(container, new File(name === 'leer.csv' ? [] : ['x'], name));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(text)
    );
    expect(calls('POST')).toHaveLength(0);
  });

  it('refuses a file above 5 MB without sending it', async () => {
    mockApi();
    const { container } = renderPanel();
    await open();
    const big = new File(['x'], 'gross.xlsx');
    Object.defineProperty(big, 'size', { value: 5 * 1024 * 1024 + 1 });
    chooseFile(container, big);
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('größer als 5 MB')
    );
    expect(calls('POST')).toHaveLength(0);
  });

  it('shows the message for the code of the server', async () => {
    mockApi({ parse: reply({ code: 'NO_PLAN_TABLE' }, 422) });
    const { container } = renderPanel();
    await open();
    chooseFile(container, xlsx());
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'keine Tabelle nach der Vorlage gefunden'
      )
    );
    mockApi({ parse: reply({ code: 'WHATEVER' }, 500) });
    chooseFile(container, xlsx());
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Das Dokument konnte nicht gelesen werden.'
      )
    );
  });

  it('says so when saving fails and keeps the proposal', async () => {
    mockApi({ parse: proposalAnswer(), put: reply({}, 500) });
    const { container } = renderPanel();
    await open();
    chooseFile(container, xlsx());
    await screen.findByRole('heading', { name: 'Vorschlag aus plan.xlsx' });
    fireEvent.click(
      screen.getByRole('button', { name: `Übernehmen (${scriptRows.length})` })
    );
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Der Plan konnte nicht gespeichert werden.'
      )
    );
    expect(
      screen.getByRole('heading', { name: 'Vorschlag aus plan.xlsx' })
    ).toBeInTheDocument();
  });
});

describe('ContentPlanPanel: Word and PDF with the AI', () => {
  const kiRows = planToRows(
    { totals: { components: 12 } },
    'Die Ausbildung umfasst 12 Komponenten'
  );

  it('asks first, nothing is sent before the person agrees', async () => {
    mockApi({
      parse: proposalAnswer({
        method: 'ki',
        rows: kiRows,
        fileName: 'plan.docx',
        warnings: ['KI_REVIEW'],
        ki: { accepted: 1, dropped: 2 },
      }),
    });
    const { container } = renderPanel();
    await open();
    chooseFile(container, new File(['PK'], 'plan.docx'));

    expect(
      await screen.findByText('Dieses Dokument mit der KI lesen?')
    ).toBeInTheDocument();
    expect(screen.getByText(/kein Fremdanbieter/)).toBeInTheDocument();
    expect(calls('POST')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Mit KI lesen' }));
    await screen.findByRole('heading', { name: 'Vorschlag aus plan.docx' });
    const form = calls('POST')[0][1].body as FormData;
    expect(form.get('ki')).toBe('true');
    // the warning is there, the quote is shown as a quote
    expect(
      screen.getByText('KI-Einschätzung, bitte prüfen')
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Die KI hat nur Angaben mit einer Fundstelle im Text übernommen: 1 Felder übernommen, 2 verworfen.'
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText('„Die Ausbildung umfasst 12 Komponenten“')
    ).toBeInTheDocument();
  });

  it('can say no', async () => {
    mockApi();
    const { container } = renderPanel();
    await open();
    chooseFile(container, new File(['%PDF-'], 'plan.pdf'));
    await screen.findByText('Dieses Dokument mit der KI lesen?');
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(screen.queryByText('Dieses Dokument mit der KI lesen?')).toBeNull();
    expect(calls('POST')).toHaveLength(0);
  });

  it('says why the AI could not be used', async () => {
    mockApi({ parse: reply({ code: 'KI_DISABLED' }, 503) });
    const { container } = renderPanel();
    await open();
    chooseFile(container, new File(['PK'], 'plan.docx'));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Mit KI lesen' })
    );
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Die KI-Stufe ist nicht eingeschaltet'
      )
    );
  });
});

describe('ContentStatsView: where a target comes from', () => {
  const metric = (id: string, actual: number, target: number | null) => ({
    id,
    actual,
    active: null,
    target,
    ...compareToTarget(actual, target),
  });
  const answer = (): ContentStatsResponse =>
    ({
      targetsVisible: true,
      canEditTargets: true,
      catalogs: [
        {
          catalogId: CAT,
          code: 'KFBM',
          title: 'Kaufleute für Büromanagement',
          isActive: true,
          metrics: [
            metric('components', 27, null),
            metric('enablers', 226, 226),
            metric('scenarios', 225, 226),
            metric('useCases', 225, null),
            metric('lessonQuizzes', 678, null),
            metric('globalQuizzes', 27, null),
            metric('learningFields', 13, null),
          ],
          targetSources: {
            enablers: { origin: 'manual', manual: 226, plan: 225 },
            scenarios: { origin: 'plan', manual: null, plan: 226 },
          },
          questions: 0,
          mappings: 0,
        },
      ],
    }) as ContentStatsResponse;

  const itemOf = (label: string) =>
    within(screen.getByRole('list', { name: /Inhaltsstatistik/ }))
      .getAllByRole('listitem')
      .find(li => within(li).queryByText(label, { exact: true }))!;

  it('a small label per target and a hint where manual and plan differ', async () => {
    (authFetch as jest.Mock).mockImplementation(async () => reply(answer()));
    renderWithProviders(<ContentStatsView />);
    await screen.findByText('Kaufleute für Büromanagement');

    const enablers = itemOf('Enabler');
    expect(within(enablers).getByText('manuell')).toBeInTheDocument();
    expect(
      within(enablers).getByText('Herkunft des Solls: manuell')
    ).toBeInTheDocument();
    expect(
      within(enablers).getByText(
        'Manuell 226, laut Plan 225. Die manuelle Zahl gilt.'
      )
    ).toBeInTheDocument();

    const scenarios = itemOf('Szenarien');
    expect(within(scenarios).getByText('Plan')).toBeInTheDocument();
    expect(within(scenarios).queryByText(/Die manuelle Zahl gilt/)).toBeNull();

    // no target, no label
    expect(within(itemOf('Komponenten')).queryByText('Plan')).toBeNull();
    expect(within(itemOf('Komponenten')).queryByText('manuell')).toBeNull();
  });

  it('puts one plan section per catalog under the targets, only for the platform admin', async () => {
    (authFetch as jest.Mock).mockImplementation(async () => reply(answer()));
    const { unmount } = renderWithProviders(<ContentStatsView />);
    await screen.findByText('Kaufleute für Büromanagement');
    expect(
      screen.getAllByRole('group', { name: 'Plan-Dokument' })
    ).toHaveLength(1);
    unmount();

    const org = answer();
    org.canEditTargets = false;
    org.targetsVisible = false;
    delete org.catalogs[0].targetSources;
    (authFetch as jest.Mock).mockImplementation(async () => reply(org));
    renderWithProviders(<ContentStatsView />);
    await screen.findByText('Kaufleute für Büromanagement');
    expect(screen.queryByRole('group', { name: 'Plan-Dokument' })).toBeNull();
    expect(screen.queryByText('manuell')).toBeNull();
  });

  it('the target form edits the manual number only, a plan number is not saved as manual', async () => {
    (authFetch as jest.Mock).mockImplementation(async () => reply(answer()));
    renderWithProviders(<ContentStatsView />);
    await screen.findByText('Kaufleute für Büromanagement');
    fireEvent.click(
      screen.getByRole('button', { name: 'Soll-Werte bearbeiten' })
    );
    const form = await screen.findByRole('form');
    expect(within(form).getByLabelText('Enabler')).toHaveValue('226');
    // scenarios: the 226 comes from the plan, the manual field stays empty
    expect(within(form).getByLabelText('Szenarien')).toHaveValue('');
  });
});

import { screen, waitFor, fireEvent, within } from '@testing-library/react';
import toast from 'react-hot-toast';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import { ContentStatsView } from '@/components/admin/ContentStatsView';
import { authFetch } from '@/lib/authFetch';
import type {
  CatalogContentStats,
  ContentMetric,
  ContentMetricId,
  ContentStatsResponse,
} from '@/lib/catalog/content-targets';
import { compareToTarget } from '@/lib/catalog/content-targets';

jest.mock('@/lib/authFetch', () => ({ authFetch: jest.fn() }));
jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { success: jest.fn(), error: jest.fn() },
}));

const KFBM = '00000000-0000-4000-8000-000000000002';
const FIAE = '00000000-0000-4000-8000-000000000001';

function metric(
  id: ContentMetricId,
  actual: number,
  target: number | null,
  active: number | null = null
): ContentMetric {
  return { id, actual, active, target, ...compareToTarget(actual, target) };
}

function kfbm(withTargets: boolean): CatalogContentStats {
  const t = (n: number) => (withTargets ? n : null);
  return {
    catalogId: KFBM,
    code: 'KFBM',
    title: 'Kaufleute für Büromanagement',
    isActive: false,
    metrics: [
      metric('components', 27, null),
      metric('enablers', 226, t(226), 200),
      metric('scenarios', 225, t(226)),
      metric('useCases', 225, t(220), 0),
      metric('lessonQuizzes', 678, null, 600),
      metric('globalQuizzes', 27, null, 27),
      metric('learningFields', 13, null),
    ],
    questions: 4000,
    mappings: 451,
  };
}

const fiae: CatalogContentStats = {
  catalogId: FIAE,
  code: 'FIAE',
  title: 'Fachinformatiker Anwendungsentwicklung',
  isActive: true,
  metrics: [
    metric('components', 12, null),
    metric('enablers', 0, null),
    metric('scenarios', 0, null),
    metric('useCases', 0, null),
    metric('lessonQuizzes', 0, null),
    metric('globalQuizzes', 0, null),
    metric('learningFields', 0, null),
  ],
  questions: 0,
  mappings: 0,
};

const platformAnswer = (): ContentStatsResponse => ({
  targetsVisible: true,
  canEditTargets: true,
  catalogs: [fiae, kfbm(true)],
});
const orgAnswer = (): ContentStatsResponse => ({
  targetsVisible: false,
  canEditTargets: false,
  catalogs: [kfbm(false)],
});

function reply(data: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => data } as Response;
}

function mockApi(
  answer: ContentStatsResponse | Response,
  put?: Response | (() => Response)
) {
  (authFetch as jest.Mock).mockImplementation(
    async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        return typeof put === 'function'
          ? put()
          : (put ?? reply({ catalogId: KFBM, targets: {} }));
      }
      if (url === '/api/admin/content-stats') {
        return 'ok' in (answer as Response) &&
          typeof (answer as Response).json === 'function'
          ? (answer as Response)
          : reply(answer);
      }
      throw new Error(`unexpected request ${url}`);
    }
  );
}

const card = (title: string) =>
  screen.getByRole('region', { name: new RegExp(title) });
const item = (cardName: string, label: string) => {
  const list = within(card(cardName)).getByRole('list', {
    name: /Inhaltsstatistik/,
  });
  return within(list)
    .getAllByRole('listitem')
    .find(li => within(li).queryByText(label, { exact: true }))!;
};

describe('ContentStatsView: platform admin', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows actual, target, difference and status per kind of content', async () => {
    mockApi(platformAnswer());
    renderWithProviders(<ContentStatsView />);
    await screen.findByText('Kaufleute für Büromanagement');

    // FIAE first, both cards present, state of the catalog in words
    const headings = screen
      .getAllByRole('heading', { level: 2 })
      .map(h => h.textContent);
    expect(headings).toEqual([
      'Fachinformatiker Anwendungsentwicklung',
      'Kaufleute für Büromanagement',
    ]);
    expect(screen.getByText('Ausbildung inaktiv')).toBeInTheDocument();
    expect(screen.getByText('Ausbildung aktiv')).toBeInTheDocument();

    const scenarios = item('Kaufleute', 'Szenarien');
    expect(within(scenarios).getByText('fehlt')).toBeInTheDocument();
    expect(within(scenarios).getByText('225')).toBeInTheDocument();
    expect(within(scenarios).getByText('226')).toBeInTheDocument();
    // a real minus sign
    expect(within(scenarios).getByText('−1')).toBeInTheDocument();

    const enablers = item('Kaufleute', 'Enabler');
    expect(within(enablers).getByText('erfüllt')).toBeInTheDocument();
    expect(within(enablers).getByText('0')).toBeInTheDocument();
    expect(
      within(enablers).getByText('davon aktiv 200, inaktiv 26')
    ).toBeInTheDocument();

    const useCases = item('Kaufleute', 'Use Cases');
    expect(within(useCases).getByText('mehr als Soll')).toBeInTheDocument();
    expect(within(useCases).getByText('+5')).toBeInTheDocument();

    const components = item('Kaufleute', 'Komponenten');
    expect(
      within(components).getByText('kein Soll', { selector: 'span' })
    ).toBeInTheDocument();
    expect(within(components).queryByRole('progressbar')).toBeNull();

    expect(within(card('Kaufleute')).getByText('4.000')).toBeInTheDocument();
    expect(within(card('Kaufleute')).getByText('451')).toBeInTheDocument();
  });

  it('the progress bar says its value in words and never shows 100 for a missing item', async () => {
    mockApi(platformAnswer());
    renderWithProviders(<ContentStatsView />);
    await screen.findByText('Kaufleute für Büromanagement');
    const bar = within(item('Kaufleute', 'Szenarien')).getByRole(
      'progressbar',
      { name: 'Szenarien' }
    );
    expect(bar).toHaveAttribute('aria-valuenow', '99');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(bar).toHaveAttribute(
      'aria-valuetext',
      'Szenarien: 99 Prozent des Solls von 226'
    );
    const full = within(item('Kaufleute', 'Enabler')).getByRole('progressbar');
    expect(full).toHaveAttribute('aria-valuenow', '100');
  });

  it('offers the edit button for every catalog', async () => {
    mockApi(platformAnswer());
    renderWithProviders(<ContentStatsView />);
    await screen.findByText('Kaufleute für Büromanagement');
    expect(
      screen.getAllByRole('button', { name: 'Soll-Werte bearbeiten' })
    ).toHaveLength(2);
  });

  it('reloads on demand', async () => {
    mockApi(platformAnswer());
    renderWithProviders(<ContentStatsView />);
    await screen.findByText('Kaufleute für Büromanagement');
    fireEvent.click(screen.getByRole('button', { name: 'Aktualisieren' }));
    await waitFor(() => expect(authFetch).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Aktualisieren' })
      ).toBeEnabled()
    );
  });
});

describe('ContentStatsView: organization admin', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows the actual numbers only, no target, no status, no edit', async () => {
    mockApi(orgAnswer());
    renderWithProviders(<ContentStatsView />);
    await screen.findByText('Kaufleute für Büromanagement');
    expect(screen.queryAllByRole('progressbar')).toHaveLength(0);
    expect(screen.queryByText('Soll')).toBeNull();
    expect(screen.queryByText('Abweichung')).toBeNull();
    expect(screen.queryByText('fehlt')).toBeNull();
    expect(screen.queryByText('erfüllt')).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Soll-Werte bearbeiten' })
    ).toBeNull();
    expect(
      screen.getByText(
        'Soll-Werte und Abweichungen sehen nur Plattform-Administratoren.'
      )
    ).toBeInTheDocument();
    expect(
      within(item('Kaufleute', 'Szenarien')).getByText('225')
    ).toBeInTheDocument();
  });
});

describe('ContentStatsView: states', () => {
  beforeEach(() => jest.clearAllMocks());

  it('says so when the organization has no training', async () => {
    mockApi({ targetsVisible: false, canEditTargets: false, catalogs: [] });
    renderWithProviders(<ContentStatsView />);
    expect(
      await screen.findByText(
        'Für Ihre Organisation ist keine Ausbildung freigeschaltet.'
      )
    ).toBeInTheDocument();
  });

  it('shows an alert when the statistics cannot be loaded', async () => {
    mockApi(reply({ error: 'x' }, 500));
    renderWithProviders(<ContentStatsView />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Die Inhaltsstatistik konnte nicht geladen werden.'
    );
  });
});

describe('ContentStatsView: targets form', () => {
  beforeEach(() => jest.clearAllMocks());

  async function openForm() {
    mockApi(platformAnswer());
    renderWithProviders(<ContentStatsView />);
    await screen.findByText('Kaufleute für Büromanagement');
    const buttons = screen.getAllByRole('button', {
      name: 'Soll-Werte bearbeiten',
    });
    fireEvent.click(buttons[1]);
    return screen.getByRole('form', {
      name: 'Soll-Werte für Kaufleute für Büromanagement',
    });
  }

  it('opens with the stored targets, labelled fields and the first field focused', async () => {
    const form = await openForm();
    expect(within(form).getByLabelText('Enabler')).toHaveValue('226');
    expect(within(form).getByLabelText('Komponenten')).toHaveValue('');
    expect(within(form).getByLabelText('Komponenten')).toHaveFocus();
    expect(
      within(form).getByText(
        'Ganze Zahlen von 0 bis 100000. Ein leeres Feld bedeutet: kein Soll.'
      )
    ).toBeInTheDocument();
    // the button that opened it is gone while the form is open
    expect(
      screen.getAllByRole('button', { name: 'Soll-Werte bearbeiten' })
    ).toHaveLength(1);
  });

  it('refuses bad input before anything is sent, with a message at the field', async () => {
    const form = await openForm();
    for (const bad of ['abc', '-3', '1.5', '100001', '1e3']) {
      fireEvent.change(within(form).getByLabelText('Szenarien'), {
        target: { value: bad },
      });
      fireEvent.click(
        within(form).getByRole('button', { name: 'Soll-Werte speichern' })
      );
      const field = within(form).getByLabelText('Szenarien');
      expect(field).toHaveAttribute('aria-invalid', 'true');
      // focus goes to the field that needs the correction
      expect(field).toHaveFocus();
      expect(
        within(form).getAllByText(
          'Szenarien: bitte eine ganze Zahl von 0 bis 100000 eingeben.'
        ).length
      ).toBeGreaterThan(0);
    }
    expect(
      (authFetch as jest.Mock).mock.calls.filter(
        ([, init]) => init?.method === 'PUT'
      )
    ).toHaveLength(0);
  });

  it('saves the whole set (empty means no target), reloads and closes', async () => {
    const form = await openForm();
    fireEvent.change(within(form).getByLabelText('Szenarien'), {
      target: { value: ' 226 ' },
    });
    fireEvent.change(within(form).getByLabelText('Enabler'), {
      target: { value: '' },
    });
    fireEvent.change(within(form).getByLabelText('Komponenten'), {
      target: { value: '0' },
    });
    fireEvent.click(
      within(form).getByRole('button', { name: 'Soll-Werte speichern' })
    );

    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    const putCall = (authFetch as jest.Mock).mock.calls.find(
      ([, init]) => init?.method === 'PUT'
    )!;
    expect(putCall[0]).toBe(`/api/admin/catalogs/${KFBM}/content-targets`);
    expect(JSON.parse(putCall[1].body)).toEqual({
      targets: {
        components: 0,
        enablers: null,
        scenarios: 226,
        useCases: 220,
        lessonQuizzes: null,
        globalQuizzes: null,
        learningFields: null,
      },
    });
    // statistics were loaded again and the form is closed, focus is back
    await waitFor(() =>
      expect(
        (authFetch as jest.Mock).mock.calls.filter(
          ([u, init]) => u === '/api/admin/content-stats' && !init?.method
        )
      ).toHaveLength(2)
    );
    expect(screen.queryByRole('form')).toBeNull();
  });

  it('tells the failure in the form and keeps the input', async () => {
    mockApi(platformAnswer(), () => reply({ code: 'X' }, 500));
    renderWithProviders(<ContentStatsView />);
    await screen.findByText('Kaufleute für Büromanagement');
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Soll-Werte bearbeiten' })[1]
    );
    const form = screen.getByRole('form');
    fireEvent.change(within(form).getByLabelText('Szenarien'), {
      target: { value: '9' },
    });
    fireEvent.click(
      within(form).getByRole('button', { name: 'Soll-Werte speichern' })
    );
    expect(
      await within(form).findByText(
        'Die Soll-Werte konnten nicht gespeichert werden.'
      )
    ).toBeInTheDocument();
    expect(within(form).getByLabelText('Szenarien')).toHaveValue('9');
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('names a catalog that vanished', async () => {
    mockApi(platformAnswer(), () => reply({ code: 'CATALOG_NOT_FOUND' }, 404));
    renderWithProviders(<ContentStatsView />);
    await screen.findByText('Kaufleute für Büromanagement');
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Soll-Werte bearbeiten' })[1]
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Soll-Werte speichern' })
    );
    expect(
      await screen.findByText('Die Ausbildung wurde nicht gefunden.')
    ).toBeInTheDocument();
  });

  it('cancel closes the form without a request and gives the focus back', async () => {
    await openForm();
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(screen.queryByRole('form')).toBeNull();
    const buttons = screen.getAllByRole('button', {
      name: 'Soll-Werte bearbeiten',
    });
    expect(buttons[1]).toHaveFocus();
    expect(
      (authFetch as jest.Mock).mock.calls.filter(
        ([, init]) => init?.method === 'PUT'
      )
    ).toHaveLength(0);
  });
});

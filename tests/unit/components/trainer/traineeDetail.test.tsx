import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import toast from 'react-hot-toast';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import { useAuth } from '@/contexts/AuthContext';
import { useBreadcrumbs } from '@/contexts/BreadcrumbContext';
import { authFetch } from '@/lib/authFetch';
import TraineeDetail from '@/components/trainer/TraineeDetail';

// Detail page of a trainee (Jira WMCNL-2984 to 2994, second round): name check
// and confirmation, confirmation before the order of work changes, a share
// that is refused, one vocabulary for filter and badge, grouped lists, summaries.

const UUID = '11111111-2222-4333-8444-555555555555';

jest.mock('@/contexts/AuthContext');
jest.mock('@/contexts/BreadcrumbContext');
jest.mock('@/lib/authFetch');
jest.mock('next/navigation', () => ({
  __esModule: true,
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  usePathname: () => `/trainer/trainees/${UUID}`,
}));
jest.mock('react-hot-toast', () => {
  const fn: any = jest.fn();
  fn.success = jest.fn();
  fn.error = jest.fn();
  return { __esModule: true, default: fn };
});
// The drawing of the PDF is tested on its own (trainee-report.test.ts)
jest.mock('@/lib/trainer/trainee-report', () => ({
  buildTraineeReport: jest.fn(() => []),
  renderTraineeReportPdf: jest.fn(async () => new Uint8Array([37, 80, 68, 70])),
}));

const authFetchMock = authFetch as jest.MockedFunction<typeof authFetch>;
const toastMock = toast as unknown as jest.Mock & {
  success: jest.Mock;
  error: jest.Mock;
};

const json = (body: unknown, ok = true, status = 200) =>
  ({ ok, status, json: async () => body }) as Response;

const baseEnabler = {
  courseId: 'c1',
  courseTitle: 'Zusammenarbeit und Kommunikation gestalten',
  courseCode: 'K1',
  isActive: true,
  sequenceEnforced: true,
  override: null as boolean | null,
  lockReason: null,
  lockedBy: null,
  link: '/x',
};

function overviewBody(extra: Record<string, unknown> = {}) {
  return {
    stats: {
      progressPct: 33,
      completedEnablers: 1,
      totalEnablers: 3,
      pending: { quizzes: 0, useCases: 0 },
    },
    enablers: [
      {
        ...baseEnabler,
        id: 'e1',
        title: 'Betriebliche Kommunikationssysteme',
        completed: true,
        state: 'completed',
        summaryStatus: 'REJECTED',
      },
      {
        ...baseEnabler,
        id: 'e2',
        title: 'Aufgaben im Team planen',
        completed: false,
        state: 'open',
        summaryStatus: null,
      },
      {
        ...baseEnabler,
        id: 'e3',
        title: 'Wertschätzung und Vertrauen',
        completed: false,
        state: 'locked',
        lockReason: 'SEQUENCE',
        lockedBy: { id: 'e2', title: 'Aufgaben im Team planen' },
      },
      {
        ...baseEnabler,
        id: 'e4',
        title: 'Freigegebener Themenkreis',
        completed: false,
        state: 'open',
        override: true,
      },
      {
        ...baseEnabler,
        id: 'e5',
        title: 'Ausgeschalteter Themenkreis',
        completed: false,
        isActive: false,
        state: null,
      },
    ],
    useCases: [
      {
        id: 'u1',
        title: 'Telefonat führen',
        courseId: 'c1',
        courseTitle: 'Zusammenarbeit und Kommunikation gestalten',
        status: 'REJECTED',
        isActive: true,
        link: '/u1',
      },
      {
        id: 'u2',
        title: 'Angebot schreiben',
        courseId: 'c1',
        courseTitle: 'Zusammenarbeit und Kommunikation gestalten',
        status: null,
        isActive: true,
        link: '/u2',
      },
    ],
    summaries: [
      {
        enablerId: 'e1',
        enablerTitle: 'Betriebliche Kommunikationssysteme',
        courseId: 'c1',
        courseTitle: 'Zusammenarbeit und Kommunikation gestalten',
        status: 'REJECTED',
        attemptNumber: 1,
      },
    ],
    enablerQuizzes: [
      {
        enablerId: 'e1',
        enablerTitle: 'Betriebliche Kommunikationssysteme',
        courseId: 'c1',
        courseTitle: 'Zusammenarbeit und Kommunikation gestalten',
        quizId: 'q1',
        difficulty: 'LOW',
        lastScore: 80,
        attemptNumber: 1,
        isReviewed: false,
        link: '/q1',
      },
      {
        enablerId: 'e1',
        enablerTitle: 'Betriebliche Kommunikationssysteme',
        courseId: 'c1',
        courseTitle: 'Zusammenarbeit und Kommunikation gestalten',
        quizId: 'q2',
        difficulty: 'HIGH',
        lastScore: null,
        attemptNumber: null,
        isReviewed: null,
        link: '/q2',
      },
    ],
    globalQuizzes: [],
    ...extra,
  };
}

let overview = overviewBody();
let patchBodies: any[] = [];
let activateResponse: Response;

function mockApi() {
  authFetchMock.mockImplementation(async (input: any, init?: any) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.endsWith('/overview')) return json(overview);
    if (url.endsWith('/activate') && method === 'PATCH') {
      patchBodies.push({ url, body: JSON.parse(init.body) });
      return activateResponse;
    }
    if (method === 'PATCH') {
      patchBodies.push({ url, body: JSON.parse(init.body) });
      return json({
        trainee: {
          id: UUID,
          full_name: 'Leon Neu',
          avatar_url: null,
          training_start_date: null,
          ausbildung_duration_years: 3,
        },
      });
    }
    return json({
      trainee: {
        id: UUID,
        full_name: 'Leon Moretz',
        avatar_url: null,
        training_start_date: null,
        ausbildung_duration_years: 3,
        progress: 33,
      },
    });
  });
}

const setBreadcrumbs = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  overview = overviewBody();
  patchBodies = [];
  activateResponse = json({ ok: true });
  (useAuth as jest.Mock).mockReturnValue({
    profile: { id: 'tr1', role: 'TRAINER' },
    loading: false,
  });
  (useBreadcrumbs as jest.Mock).mockReturnValue({
    breadcrumbs: [
      { label: 'Ausbilder', href: '/trainer/dashboard' },
      { label: 'Auszubildende', href: '/trainer/trainees' },
      { label: 'Details', href: `/trainer/trainees/${UUID}` },
    ],
    setBreadcrumbs,
  });
  mockApi();
});

async function renderPage() {
  const view = renderWithProviders(<TraineeDetail traineeId={UUID} />);
  await screen.findByRole('heading', { level: 1, name: 'Leon Moretz' });
  return view;
}

describe('header (WMCNL-2994)', () => {
  it('names the page after the trainee and shows no technical id', async () => {
    const { container } = await renderPage();
    await waitFor(() => expect(setBreadcrumbs).toHaveBeenCalled());
    const items = setBreadcrumbs.mock.calls[0][0];
    expect(items[2]).toEqual({
      label: 'Leon Moretz',
      href: `/trainer/trainees/${UUID}`,
    });
    expect(container.textContent).not.toContain(UUID);
    expect(container.textContent).not.toContain('ID:');
  });

  it('shows the initials instead of a trend symbol and keeps the button on one line', async () => {
    await renderPage();
    expect(screen.getByText('LM')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Bearbeiten' }).className
    ).toContain('whitespace-nowrap');
  });

  it('uses one set of words for the sections (Themenkreise, Use Cases, Zusammenfassungen)', async () => {
    await renderPage();
    const headings = screen
      .getAllByRole('heading', { level: 3 })
      .map(h => h.textContent);
    expect(headings).toEqual([
      'Themenkreise',
      'Themenkreis-Quizze',
      'Use Cases',
      'Zusammenfassungen',
      'Globale Quizze',
    ]);
  });
});

describe('edit the master data (WMCNL-2985)', () => {
  async function openEdit() {
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Bearbeiten' }));
    return screen.getByLabelText('Vollständiger Name') as HTMLInputElement;
  }

  it('does not save an empty name and says why', async () => {
    const input = await openEdit();
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Bitte gib einen Namen ein.'
    );
    expect(patchBodies).toHaveLength(0);
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it('does not save a picture address that is no web address', async () => {
    await openEdit();
    fireEvent.change(screen.getByLabelText('Adresse des Profilbilds (URL)'), {
      target: { value: 'javascript:alert(1)' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'http:// oder https://'
    );
    expect(patchBodies).toHaveLength(0);
  });

  it('saves a valid name and confirms it', async () => {
    const input = await openEdit();
    fireEvent.change(input, { target: { value: 'Leon Neu' } });
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith(
        'Die Stammdaten wurden gespeichert.'
      )
    );
    expect(patchBodies[0].body.full_name).toBe('Leon Neu');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Leon Neu' })
    ).toBeInTheDocument();
  });

  it('shows the answer of the server when it refuses the name', async () => {
    authFetchMock.mockImplementation(async (input: any, init?: any) => {
      if (init?.method === 'PATCH') {
        return json({ code: 'FULL_NAME_REQUIRED' }, false, 400);
      }
      if (String(input).endsWith('/overview')) return json(overview);
      return json({
        trainee: {
          id: UUID,
          full_name: 'Leon Moretz',
          ausbildung_duration_years: 3,
          progress: 0,
        },
      });
    });
    const input = await openEdit();
    fireEvent.change(input, { target: { value: 'Leon' } });
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Bitte gib einen Namen ein.'
    );
  });
});

describe('order of work: confirmation (WMCNL-2993)', () => {
  const lockButton = () =>
    screen.getByRole('button', {
      name: 'Sperren: Aufgaben im Team planen',
    });

  it('asks before an enabler is locked, nothing is saved before the answer', async () => {
    await renderPage();
    fireEvent.click(lockButton());
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText('Themenkreis für diesen Azubi sperren?')
    ).toBeInTheDocument();
    expect(dialog).toHaveTextContent('Aufgaben im Team planen');
    expect(patchBodies).toHaveLength(0);
  });

  it('Escape and Abbrechen close the dialog without a change', async () => {
    await renderPage();
    fireEvent.click(lockButton());
    await screen.findByRole('dialog');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    );
    fireEvent.click(lockButton());
    fireEvent.click(await screen.findByRole('button', { name: 'Abbrechen' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    );
    expect(patchBodies).toHaveLength(0);
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it('locks after the confirmation and says that it did', async () => {
    await renderPage();
    fireEvent.click(lockButton());
    fireEvent.click(await screen.findByRole('button', { name: 'Ja, ändern' }));
    await waitFor(() => expect(patchBodies).toHaveLength(1));
    expect(patchBodies[0].body).toEqual({
      itemType: 'ENABLER',
      itemId: 'e2',
      isActive: false,
    });
    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith(
        '„Aufgaben im Team planen“ wurde für den Azubi gesperrt.'
      )
    );
  });

  it('also asks before releasing out of turn and before the way back to the order', async () => {
    await renderPage();
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Außer der Reihe freigeben: Wertschätzung und Vertrauen',
      })
    );
    expect(
      await screen.findByText('Themenkreis außer der Reihe freigeben?')
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Zurück zur Reihenfolge: Freigegebener Themenkreis',
      })
    );
    expect(
      await screen.findByText('Zurück zur Reihenfolge?')
    ).toBeInTheDocument();
    expect(patchBodies).toHaveLength(0);
  });

  it('an enabler released out of turn can be locked directly', async () => {
    await renderPage();
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Sperren: Freigegebener Themenkreis',
      })
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Ja, ändern' }));
    await waitFor(() => expect(patchBodies).toHaveLength(1));
    expect(patchBodies[0].body).toMatchObject({
      itemId: 'e4',
      isActive: false,
    });
  });

  it('shows no success message when the change failed', async () => {
    activateResponse = json({}, false, 500);
    await renderPage();
    fireEvent.click(lockButton());
    fireEvent.click(await screen.findByRole('button', { name: 'Ja, ändern' }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    expect(toastMock.success).not.toHaveBeenCalled();
  });
});

describe('modules: one vocabulary for filter and badge (WMCNL-2988, 2984, 2992)', () => {
  it('has no "Aktiv" badge on a card and a filter with the words of the states', async () => {
    await renderPage();
    const cards = screen.getAllByTestId('enabler-card');
    for (const card of cards) {
      expect(within(card).queryByText('Aktiv')).not.toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: 'Aktiv' })).toBeNull();
    for (const name of [
      'Alle',
      'Abgeschlossen',
      'Offen',
      'Gesperrt',
      'Inaktiv',
    ]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('the filter "Offen" shows exactly the cards that say "Offen"', async () => {
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Offen' }));
    const cards = screen.getAllByTestId('enabler-card');
    expect(
      cards.map(c => within(c).getByText(/Themenkreis|Aufgaben/).textContent)
    ).toEqual(['Aufgaben im Team planen', 'Freigegebener Themenkreis']);
    for (const card of cards) {
      expect(
        within(card).getByTestId('enabler-state-open')
      ).toBeInTheDocument();
    }
  });

  it('the filter "Inaktiv" shows the enabler that is switched off, "Gesperrt" the locked one', async () => {
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Inaktiv' }));
    expect(screen.getAllByTestId('enabler-card')).toHaveLength(1);
    expect(screen.getByText('Ausgeschalteter Themenkreis')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Gesperrt' }));
    expect(screen.getAllByTestId('enabler-card')).toHaveLength(1);
    expect(screen.getByText('Wertschätzung und Vertrauen')).toBeInTheDocument();
  });

  it('tells a rejected summary on the card of the enabler (it is not simply "Abgeschlossen")', async () => {
    await renderPage();
    const card = screen
      .getAllByTestId('enabler-card')
      .find(c =>
        c.textContent?.includes('Betriebliche Kommunikationssysteme')
      )!;
    expect(within(card).getByTestId('summary-status')).toHaveTextContent(
      'Zusammenfassung: Überarbeitung erforderlich'
    );
    expect(card).toHaveTextContent('Die Zusammenfassung wurde abgelehnt');
    // an enabler without a summary shows no such badge
    const other = screen
      .getAllByTestId('enabler-card')
      .find(c => c.textContent?.includes('Aufgaben im Team planen'))!;
    expect(within(other).queryByTestId('summary-status')).toBeNull();
  });

  it('two courses with one title are two groups, never one list with two open enablers', async () => {
    overview = overviewBody({
      enablers: [
        {
          ...baseEnabler,
          id: 'a1',
          title: 'Erster',
          completed: false,
          state: 'open',
        },
        {
          ...baseEnabler,
          id: 'b1',
          title: 'Zweiter',
          courseId: 'c2',
          courseCode: 'K7',
          completed: false,
          state: 'open',
        },
      ],
    });
    await renderPage();
    expect(
      screen.getByText('Zusammenarbeit und Kommunikation gestalten (K1)')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Zusammenarbeit und Kommunikation gestalten (K7)')
    ).toBeInTheDocument();
  });
});

describe('lesson quizzes grouped (WMCNL-2989)', () => {
  async function openQuizzes() {
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Themenkreis-Quizze/ }));
  }

  it('counts the quizzes worked on and groups them by course, closed at first', async () => {
    await openQuizzes();
    expect(screen.getAllByText('1 von 2 bearbeitet').length).toBeGreaterThan(0);
    expect(screen.queryByText('Niedrig')).toBeNull();
    const group = screen.getAllByTestId('lesson-quizzes-group')[0];
    fireEvent.click(within(group).getAllByRole('button')[0]);
    expect(within(group).getByText(/Niedrig/)).toBeInTheDocument();
    expect(within(group).getByText(/Hoch/)).toBeInTheDocument();
    expect(group.textContent).not.toMatch(/LOW|HIGH|MEDIUM/);
    expect(group).toHaveTextContent('Zur Überprüfung');
  });

  it('can show only the quizzes that were worked on', async () => {
    await openQuizzes();
    fireEvent.click(screen.getByLabelText('Nur bearbeitete anzeigen'));
    const group = screen.getAllByTestId('lesson-quizzes-group')[0];
    fireEvent.click(within(group).getAllByRole('button')[0]);
    expect(within(group).getByText(/Niedrig/)).toBeInTheDocument();
    expect(within(group).queryByText(/Hoch/)).toBeNull();
  });
});

describe('use cases and summaries (WMCNL-2990)', () => {
  it('calls the section Use Cases, shows the status in German and only submitted ones at first', async () => {
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Use Cases/ }));
    expect(screen.getByText('Telefonat führen')).toBeInTheDocument();
    expect(screen.queryByText('Angebot schreiben')).toBeNull();
    expect(screen.queryByText('REJECTED')).toBeNull();
    const section = screen.getByText('Telefonat führen').closest('section')!;
    expect(
      within(section).getByText('Überarbeitung erforderlich')
    ).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Nur eingereichte anzeigen'));
    fireEvent.click(
      within(section)
        .getAllByTestId('use-cases-group')[0]
        .querySelector('button')!
    );
    expect(await screen.findByText('Angebot schreiben')).toBeInTheDocument();
    expect(within(section).getByText('Nicht eingereicht')).toBeInTheDocument();
  });

  it('shows the summaries the trainee handed in', async () => {
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Zusammenfassungen/ }));
    const section = screen
      .getByRole('heading', { level: 3, name: 'Zusammenfassungen' })
      .closest('section')!;
    expect(
      within(section).getByText('Betriebliche Kommunikationssysteme')
    ).toBeInTheDocument();
    expect(
      within(section).getByText('Überarbeitung erforderlich')
    ).toBeInTheDocument();
    expect(within(section).getByText('Versuch 1')).toBeInTheDocument();
  });

  it('says so when no summary was handed in', async () => {
    overview = overviewBody({ summaries: [] });
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Zusammenfassungen/ }));
    expect(
      await screen.findByText(
        'Es wurde noch keine Zusammenfassung eingereicht.'
      )
    ).toBeInTheDocument();
  });
});

describe('share (WMCNL-2987)', () => {
  const originalShare = (navigator as any).share;
  const originalCanShare = (navigator as any).canShare;
  let download: jest.SpyInstance;

  beforeEach(() => {
    (URL as any).createObjectURL = jest.fn(() => 'blob:x');
    (URL as any).revokeObjectURL = jest.fn();
    download = jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
  });

  afterEach(() => {
    (navigator as any).share = originalShare;
    (navigator as any).canShare = originalCanShare;
    download.mockRestore();
  });

  const shareButton = () => screen.getByRole('button', { name: 'Teilen' });

  it('"Permission denied" falls back to the download with a German hint, no red English text', async () => {
    (navigator as any).canShare = () => true;
    (navigator as any).share = jest.fn(async () => {
      throw Object.assign(new Error('Permission denied'), {
        name: 'NotAllowedError',
      });
    });
    await renderPage();
    fireEvent.click(shareButton());
    await waitFor(() => expect(toastMock).toHaveBeenCalled());
    expect(toastMock.mock.calls[0][0]).toContain(
      'Der Browser erlaubt das Teilen hier nicht'
    );
    expect(download).toHaveBeenCalledTimes(1);
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it('closing the share sheet is silent', async () => {
    (navigator as any).canShare = () => true;
    (navigator as any).share = jest.fn(async () => {
      throw Object.assign(new Error('Share canceled'), { name: 'AbortError' });
    });
    await renderPage();
    fireEvent.click(shareButton());
    await waitFor(() => expect((navigator as any).share).toHaveBeenCalled());
    await waitFor(() => expect(shareButton()).not.toBeDisabled());
    expect(toastMock).not.toHaveBeenCalled();
    expect(toastMock.error).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
  });

  it('a browser without file sharing downloads the file and says why', async () => {
    (navigator as any).canShare = undefined;
    (navigator as any).share = undefined;
    await renderPage();
    fireEvent.click(shareButton());
    await waitFor(() => expect(toastMock).toHaveBeenCalled());
    expect(toastMock.mock.calls[0][0]).toContain(
      'Teilen wird von diesem Browser nicht unterstützt'
    );
    expect(download).toHaveBeenCalledTimes(1);
  });
});

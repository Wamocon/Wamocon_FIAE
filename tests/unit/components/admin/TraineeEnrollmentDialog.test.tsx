import { screen, waitFor, fireEvent, within } from '@testing-library/react';
import toast from 'react-hot-toast';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import { TraineeEnrollmentDialog } from '@/components/admin/TraineeEnrollmentDialog';
import { authFetch } from '@/lib/authFetch';

jest.mock('@/lib/authFetch', () => ({ authFetch: jest.fn() }));
jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { success: jest.fn(), error: jest.fn() },
}));

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';
const ITSE = '00000000-0000-4000-8000-000000000003';
const ORG = '11111111-1111-4111-8111-111111111111';
const TRAINEE = '33333333-3333-4333-8333-333333333333';

const entry = (
  id: string,
  code: string,
  isActive = true,
  isEnabled = true
) => ({
  trainingCatalogId: id,
  code,
  title: `Beruf ${code}`,
  isActive,
  isEnabled,
  traineeCount: 0,
});

const enrollment = (
  id: string,
  catalogId: string,
  code: string,
  startDate: string | null = '2026-09-01',
  durationYears = 3
) => ({
  id,
  trainingCatalogId: catalogId,
  code,
  title: `Beruf ${code}`,
  startDate,
  durationYears,
});

const view = (enrollments: ReturnType<typeof enrollment>[]) => ({
  enrollments,
  enrollment: enrollments[0] ?? null,
  effectiveCatalogId: enrollments[0]?.trainingCatalogId ?? FIAE,
  isImplicit: enrollments.length === 0,
});

function reply(data: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => data } as Response;
}

/** The API: GET, PUT and DELETE of the enrollment route, the catalogs of the organization. */
function mockApi(
  options: {
    enrollments?: ReturnType<typeof enrollment>[];
    put?: Response;
    del?: Response;
  } = {}
) {
  const enrollments = options.enrollments ?? [
    enrollment('e1', FIAE, 'FIAE', '2025-09-01'),
  ];
  (authFetch as jest.Mock).mockImplementation(
    async (url: string, init?: RequestInit) => {
      if (url === `/api/admin/users/${TRAINEE}/enrollment`) {
        if (init?.method === 'PUT') {
          return (
            options.put ??
            reply({
              ...view([...enrollments, enrollment('e2', KFBM, 'KFBM')]),
              changed: true,
              enrollmentCount: enrollments.length + 1,
            })
          );
        }
        if (init?.method === 'DELETE') {
          return (
            options.del ??
            reply({
              ...view(enrollments.filter(e => e.code !== 'KFBM')),
              removed: KFBM,
              remaining: enrollments.length - 1,
            })
          );
        }
        return reply(view(enrollments));
      }
      if (url === `/api/admin/organizations/${ORG}/catalogs`) {
        return reply({
          organizationId: ORG,
          catalogs: [
            entry(FIAE, 'FIAE'),
            entry(KFBM, 'KFBM'),
            entry(ITSE, 'ITSE'),
            // not offered: inactive on the platform, not enabled for the org
            entry('a', 'INACTIVE', false, true),
            entry('b', 'NOTENABLED', true, false),
          ],
        });
      }
      throw new Error(`unexpected request ${url}`);
    }
  );
}

function renderDialog() {
  const onClose = jest.fn();
  const onSaved = jest.fn();
  renderWithProviders(
    <TraineeEnrollmentDialog
      trainee={{ id: TRAINEE, name: 'Max Mustermann', organizationId: ORG }}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
  return { onClose, onSaved };
}

const callsWith = (method: string) =>
  (authFetch as jest.Mock).mock.calls.filter(
    ([, init]) => init?.method === method
  );

describe('TraineeEnrollmentDialog', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('the trainings of the trainee', () => {
    it('lists every enrollment with its start and duration, the first one marked', async () => {
      mockApi({
        enrollments: [
          enrollment('e1', FIAE, 'FIAE', '2025-09-01', 3),
          enrollment('e2', KFBM, 'KFBM', null, 2),
        ],
      });
      renderDialog();
      const list = await screen.findByRole('list', {
        name: 'Eingeschrieben in',
      });
      const rows = within(list).getAllByRole('listitem');
      expect(rows).toHaveLength(2);
      expect(rows[0]).toHaveTextContent('Beruf FIAE');
      expect(rows[0]).toHaveTextContent('Erste Ausbildung');
      expect(rows[0]).toHaveTextContent('Beginn 01.09.2025, 3 Jahre');
      expect(rows[1]).toHaveTextContent('Beruf KFBM');
      expect(rows[1]).not.toHaveTextContent('Erste Ausbildung');
      expect(rows[1]).toHaveTextContent('Beginn offen, 2 Jahre');
    });

    it('marks FIAE as the default for a trainee without an enrollment', async () => {
      mockApi({ enrollments: [] });
      renderDialog();
      expect(
        await screen.findByText('(Standard, keine Einschreibung)')
      ).toBeInTheDocument();
      expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    });
  });

  describe('adding a training', () => {
    it('offers only active occupations enabled for the organization that the trainee is not in yet', async () => {
      mockApi();
      renderDialog();
      const select = await screen.findByLabelText('Neue Ausbildung');
      const options = within(select).getAllByRole('option');
      expect(options.map(o => o.textContent)).toEqual([
        'Beruf KFBM (KFBM)',
        'Beruf ITSE (ITSE)',
      ]);
      // already enrolled, inactive, not enabled
      expect(within(select).queryByRole('option', { name: /FIAE/ })).toBeNull();
      expect(
        within(select).queryByRole('option', { name: /INACTIVE/ })
      ).toBeNull();
      expect(
        within(select).queryByRole('option', { name: /NOTENABLED/ })
      ).toBeNull();
    });

    it('says so when the trainee is in every training that is offered', async () => {
      mockApi({
        enrollments: [
          enrollment('e1', FIAE, 'FIAE'),
          enrollment('e2', KFBM, 'KFBM'),
          enrollment('e3', ITSE, 'ITSE'),
        ],
      });
      renderDialog();
      expect(
        await screen.findByText(
          'Der Azubi ist in allen freigeschalteten Ausbildungen eingeschrieben.'
        )
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Ausbildung hinzufügen' })
      ).toBeNull();
    });

    it('adds the chosen training with PUT, keeps the dialog open and shows the new list', async () => {
      mockApi();
      const { onClose, onSaved } = renderDialog();
      const select = await screen.findByLabelText('Neue Ausbildung');
      fireEvent.change(select, { target: { value: KFBM } });
      fireEvent.click(
        screen.getByRole('button', { name: 'Ausbildung hinzufügen' })
      );

      await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
      expect(toast.success).toHaveBeenCalledWith('Ausbildung hinzugefügt');
      expect(onClose).not.toHaveBeenCalled();
      const [url, init] = callsWith('PUT')[0];
      expect(url).toBe(`/api/admin/users/${TRAINEE}/enrollment`);
      // no start date and no duration given: the profile values count
      expect(JSON.parse(init.body)).toEqual({ catalogId: KFBM });
      // the list now shows both trainings
      const list = await screen.findByRole('list', {
        name: 'Eingeschrieben in',
      });
      expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    });

    it('sends the start date and duration the admin gave', async () => {
      mockApi();
      renderDialog();
      fireEvent.change(await screen.findByLabelText('Neue Ausbildung'), {
        target: { value: KFBM },
      });
      fireEvent.change(screen.getByLabelText('Beginn (leer: wie beim Azubi)'), {
        target: { value: '2027-03-01' },
      });
      fireEvent.change(screen.getByLabelText('Dauer'), {
        target: { value: '2' },
      });
      fireEvent.click(
        screen.getByRole('button', { name: 'Ausbildung hinzufügen' })
      );
      await waitFor(() => expect(callsWith('PUT')).toHaveLength(1));
      expect(JSON.parse(callsWith('PUT')[0][1].body)).toEqual({
        catalogId: KFBM,
        startDate: '2027-03-01',
        durationYears: 2,
      });
    });

    it('shows the German reason when the API refuses', async () => {
      mockApi({
        put: reply({ error: 'not enabled', code: 'CATALOG_NOT_ENABLED' }, 400),
      });
      const { onSaved } = renderDialog();
      fireEvent.change(await screen.findByLabelText('Neue Ausbildung'), {
        target: { value: KFBM },
      });
      fireEvent.click(
        screen.getByRole('button', { name: 'Ausbildung hinzufügen' })
      );
      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(
          'Der Beruf ist für die Organisation des Azubis nicht freigeschaltet.'
        )
      );
      expect(onSaved).not.toHaveBeenCalled();
    });

    it('says "already enrolled" when nothing changed', async () => {
      mockApi({
        put: reply({
          ...view([enrollment('e1', FIAE, 'FIAE')]),
          changed: false,
        }),
      });
      renderDialog();
      fireEvent.change(await screen.findByLabelText('Neue Ausbildung'), {
        target: { value: KFBM },
      });
      fireEvent.click(
        screen.getByRole('button', { name: 'Ausbildung hinzufügen' })
      );
      await waitFor(() =>
        expect(toast.success).toHaveBeenCalledWith(
          'Der Azubi ist schon in dieser Ausbildung eingeschrieben'
        )
      );
    });
  });

  describe('removing a training', () => {
    const two = () => [
      enrollment('e1', FIAE, 'FIAE'),
      enrollment('e2', KFBM, 'KFBM'),
    ];

    it('asks first and sends nothing before the confirmation', async () => {
      mockApi({ enrollments: two() });
      renderDialog();
      const row = (await screen.findAllByRole('listitem'))[1];
      fireEvent.click(
        within(row).getByRole('button', { name: /Ausbildung entfernen/ })
      );
      expect(
        screen.getByText(
          /wirklich entfernen\? Die gewählten Wahlqualifikationen/
        )
      ).toBeInTheDocument();
      expect(callsWith('DELETE')).toHaveLength(0);

      // cancelling the question changes nothing
      fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
      expect(callsWith('DELETE')).toHaveLength(0);
      expect(screen.queryByText(/wirklich entfernen/)).toBeNull();
    });

    it('removes with DELETE and the explicit confirmation, then shows the rest', async () => {
      mockApi({ enrollments: two() });
      const { onSaved, onClose } = renderDialog();
      const row = (await screen.findAllByRole('listitem'))[1];
      fireEvent.click(
        within(row).getByRole('button', { name: /Ausbildung entfernen/ })
      );
      fireEvent.click(screen.getByRole('button', { name: 'Ja, entfernen' }));

      await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
      expect(toast.success).toHaveBeenCalledWith('Ausbildung entfernt');
      expect(onClose).not.toHaveBeenCalled();
      const [url, init] = callsWith('DELETE')[0];
      expect(url).toBe(`/api/admin/users/${TRAINEE}/enrollment`);
      expect(JSON.parse(init.body)).toEqual({ catalogId: KFBM, confirm: true });
      await waitFor(() =>
        expect(screen.getAllByRole('listitem')).toHaveLength(1)
      );
    });

    it('cannot remove the last training', async () => {
      mockApi({ enrollments: [enrollment('e1', FIAE, 'FIAE')] });
      renderDialog();
      const button = await screen.findByRole('button', {
        name: /Ausbildung entfernen/,
      });
      // aria-disabled, not disabled: it stays reachable by keyboard and the
      // reason is read out (description), the click does nothing
      expect(button).toHaveAttribute('aria-disabled', 'true');
      expect(button).toHaveAccessibleDescription(
        'Die letzte Ausbildung kann nicht entfernt werden'
      );
      fireEvent.click(button);
      expect(screen.queryByText(/wirklich entfernen/)).toBeNull();
      expect(callsWith('DELETE')).toHaveLength(0);
    });

    it('shows the German reason when the API refuses', async () => {
      mockApi({
        enrollments: two(),
        del: reply({ error: 'last', code: 'LAST_ENROLLMENT' }, 409),
      });
      const { onSaved } = renderDialog();
      const row = (await screen.findAllByRole('listitem'))[1];
      fireEvent.click(
        within(row).getByRole('button', { name: /Ausbildung entfernen/ })
      );
      fireEvent.click(screen.getByRole('button', { name: 'Ja, entfernen' }));
      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith(
          'Die letzte Ausbildung eines Azubis kann nicht entfernt werden. Zuerst die andere Ausbildung hinzufügen.'
        )
      );
      expect(onSaved).not.toHaveBeenCalled();
    });
  });

  it('warns what happens with elective components, assignments and submissions', async () => {
    mockApi();
    renderDialog();
    expect(
      await screen.findByText(
        /Neue Ausbildungen ändern die bestehenden nicht\. Beim Entfernen verfallen die gewählten Wahlqualifikationen dieser Ausbildung/
      )
    ).toBeInTheDocument();
  });

  it('closes with the close button, with Done and with Escape', async () => {
    mockApi();
    const { onClose } = renderDialog();
    await screen.findByLabelText('Neue Ausbildung');
    fireEvent.click(screen.getByRole('button', { name: 'Schließen' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Fertig' }));
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('Escape closes an open question first and the dialog with the next key', async () => {
    mockApi({
      enrollments: [
        enrollment('e1', FIAE, 'FIAE'),
        enrollment('e2', KFBM, 'KFBM'),
      ],
    });
    const { onClose } = renderDialog();
    const row = (await screen.findAllByRole('listitem'))[1];
    fireEvent.click(
      within(row).getByRole('button', { name: /Ausbildung entfernen/ })
    );
    expect(screen.getByText(/wirklich entfernen/)).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText(/wirklich entfernen/)).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows an error when the enrollments cannot be loaded', async () => {
    (authFetch as jest.Mock).mockResolvedValue(
      reply({ error: 'x', code: 'NOT_A_TRAINEE' }, 400)
    );
    renderDialog();
    expect(
      await screen.findByText(
        'Nur Azubis können einem Beruf zugeordnet werden.'
      )
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Ausbildung hinzufügen' })
    ).toBeNull();
  });
});

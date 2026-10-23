import { screen, waitFor, fireEvent } from '@testing-library/react';
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

function reply(data: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => data } as Response;
}

function mockApi(put?: Response) {
  (authFetch as jest.Mock).mockImplementation(
    async (url: string, init?: RequestInit) => {
      if (url === `/api/admin/users/${TRAINEE}/enrollment`) {
        if (init?.method === 'PUT') {
          return (
            put ??
            reply({
              enrollment: null,
              effectiveCatalogId: KFBM,
              isImplicit: false,
              changed: true,
              replaced: 0,
            })
          );
        }
        return reply({
          enrollment: null,
          effectiveCatalogId: FIAE,
          isImplicit: true,
        });
      }
      if (url === `/api/admin/organizations/${ORG}/catalogs`) {
        return reply({
          organizationId: ORG,
          catalogs: [
            entry(FIAE, 'FIAE'),
            entry(KFBM, 'KFBM'),
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

describe('TraineeEnrollmentDialog', () => {
  beforeEach(() => jest.clearAllMocks());

  it('offers only active occupations that are enabled for the organization', async () => {
    mockApi();
    renderDialog();
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2));
    expect(screen.getByRole('option', { name: /FIAE/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /KFBM/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /INACTIVE/ })).toBeNull();
    expect(screen.queryByRole('option', { name: /NOTENABLED/ })).toBeNull();
  });

  it('warns that chosen elective components lapse', async () => {
    mockApi();
    renderDialog();
    expect(
      await screen.findByText(
        /verfallen die bereits gewählten Wahlqualifikationen/
      )
    ).toBeInTheDocument();
  });

  it('marks FIAE as the default for a trainee without an enrollment', async () => {
    mockApi();
    renderDialog();
    expect(
      await screen.findByText('(Standard, keine Einschreibung)')
    ).toBeInTheDocument();
  });

  it('cannot save while the current occupation is selected', async () => {
    mockApi();
    renderDialog();
    const save = await screen.findByRole('button', { name: 'Beruf speichern' });
    expect(save).toBeDisabled();
  });

  it('saves the chosen occupation with PUT', async () => {
    mockApi();
    const { onClose, onSaved } = renderDialog();
    const select = await screen.findByLabelText('Neuer Beruf');
    fireEvent.change(select, { target: { value: KFBM } });
    fireEvent.click(screen.getByRole('button', { name: 'Beruf speichern' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith('Beruf gespeichert');
    const putCall = (authFetch as jest.Mock).mock.calls.find(
      ([, init]) => init?.method === 'PUT'
    );
    expect(putCall?.[0]).toBe(`/api/admin/users/${TRAINEE}/enrollment`);
    expect(JSON.parse(putCall?.[1].body)).toEqual({ catalogId: KFBM });
  });

  it('shows the German reason when the API refuses the change', async () => {
    mockApi(reply({ error: 'not enabled', code: 'CATALOG_NOT_ENABLED' }, 400));
    const { onClose, onSaved } = renderDialog();
    const select = await screen.findByLabelText('Neuer Beruf');
    fireEvent.change(select, { target: { value: KFBM } });
    fireEvent.click(screen.getByRole('button', { name: 'Beruf speichern' }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Der Beruf ist für die Organisation des Azubis nicht freigeschaltet.'
      )
    );
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes with the cancel button and with Escape', async () => {
    mockApi();
    const { onClose } = renderDialog();
    await screen.findByLabelText('Neuer Beruf');
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('shows an error when the enrollment cannot be loaded', async () => {
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
      screen.getByRole('button', { name: 'Beruf speichern' })
    ).toBeDisabled();
  });
});

import { screen, waitFor, fireEvent } from '@testing-library/react';
import toast from 'react-hot-toast';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import { CatalogActivationPanel } from '@/components/admin/CatalogActivationPanel';
import { authFetch } from '@/lib/authFetch';

jest.mock('@/lib/authFetch', () => ({ authFetch: jest.fn() }));
jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { success: jest.fn(), error: jest.fn() },
}));

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';

const catalog = (
  id: string,
  code: string,
  isActive: boolean,
  traineeCount = 0
) => ({
  id,
  code,
  title: `Beruf ${code}`,
  description: null,
  isActive,
  durationYears: 3,
  electivePickCount: 0,
  traineeCount,
  organizationCount: 1,
});

function reply(data: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => data } as Response;
}

function mockApi(patch?: Response, kfbmActive = true) {
  (authFetch as jest.Mock).mockImplementation(
    async (url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') return patch ?? reply({ catalog: {} });
      if (url === '/api/admin/catalogs') {
        return reply({
          catalogs: [
            catalog(FIAE, 'FIAE', true, 12),
            catalog(KFBM, 'KFBM', kfbmActive),
          ],
        });
      }
      throw new Error(`unexpected request ${url}`);
    }
  );
}

describe('CatalogActivationPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.confirm = jest.fn(() => true);
  });

  it('lists the catalogs with state and usage', async () => {
    mockApi();
    renderWithProviders(<CatalogActivationPanel />);
    expect(await screen.findByText('Beruf FIAE')).toBeInTheDocument();
    expect(screen.getByText('Beruf KFBM')).toBeInTheDocument();
    expect(screen.getByText('Standardberuf')).toBeInTheDocument();
    expect(screen.getByText(/12 Azubis/)).toBeInTheDocument();
  });

  it('says that a trainee in two trainings is counted in each but takes one seat', async () => {
    mockApi();
    renderWithProviders(<CatalogActivationPanel />);
    expect(
      await screen.findByText(
        'Ein Azubi in zwei Ausbildungen wird in jeder gezählt, belegt aber nur einen Platz.'
      )
    ).toBeInTheDocument();
  });

  it('does not offer to deactivate FIAE', async () => {
    mockApi();
    renderWithProviders(<CatalogActivationPanel />);
    await screen.findByText('Beruf FIAE');
    const buttons = screen.getAllByRole('button', { name: 'Deaktivieren' });
    // FIAE is first and stays disabled, KfBM can be switched off
    expect(buttons[0]).toBeDisabled();
    expect(buttons[1]).toBeEnabled();
  });

  it('deactivates a catalog after confirmation and tells the parent', async () => {
    mockApi();
    const onChanged = jest.fn();
    renderWithProviders(<CatalogActivationPanel onChanged={onChanged} />);
    await screen.findByText('Beruf KFBM');
    fireEvent.click(screen.getAllByRole('button', { name: 'Deaktivieren' })[1]);

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(window.confirm).toHaveBeenCalledWith(
      'Beruf "Beruf KFBM" für die ganze Plattform deaktivieren?'
    );
    const patchCall = (authFetch as jest.Mock).mock.calls.find(
      ([, init]) => init?.method === 'PATCH'
    );
    expect(patchCall?.[0]).toBe(`/api/admin/catalogs/${KFBM}`);
    expect(JSON.parse(patchCall?.[1].body)).toEqual({ isActive: false });
    expect(toast.success).toHaveBeenCalledWith('Beruf deaktiviert');
  });

  it('does nothing when the confirmation is declined', async () => {
    mockApi();
    window.confirm = jest.fn(() => false);
    renderWithProviders(<CatalogActivationPanel />);
    await screen.findByText('Beruf KFBM');
    fireEvent.click(screen.getAllByRole('button', { name: 'Deaktivieren' })[1]);
    const patchCalls = (authFetch as jest.Mock).mock.calls.filter(
      ([, init]) => init?.method === 'PATCH'
    );
    expect(patchCalls).toHaveLength(0);
  });

  it('activates an inactive catalog without asking', async () => {
    mockApi(undefined, false);
    renderWithProviders(<CatalogActivationPanel />);
    await screen.findByText('Beruf KFBM');
    fireEvent.click(screen.getByRole('button', { name: 'Aktivieren' }));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Beruf aktiviert')
    );
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it('shows the German reason with the count when the API answers 409', async () => {
    mockApi(reply({ error: 'in use', code: 'CATALOG_IN_USE', count: 4 }, 409));
    const onChanged = jest.fn();
    renderWithProviders(<CatalogActivationPanel onChanged={onChanged} />);
    await screen.findByText('Beruf KFBM');
    fireEvent.click(screen.getAllByRole('button', { name: 'Deaktivieren' })[1]);
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Der Beruf kann nicht abgeschaltet werden, solange 4 Azubis darin eingeschrieben sind.'
      )
    );
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('falls back to a general message for an unknown code', async () => {
    mockApi(reply({ error: 'boom' }, 500));
    renderWithProviders(<CatalogActivationPanel />);
    await screen.findByText('Beruf KFBM');
    fireEvent.click(screen.getAllByRole('button', { name: 'Deaktivieren' })[1]);
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Der Beruf konnte nicht geändert werden'
      )
    );
  });

  it('shows an error when the list cannot be loaded', async () => {
    (authFetch as jest.Mock).mockResolvedValue(reply({ error: 'x' }, 403));
    renderWithProviders(<CatalogActivationPanel />);
    expect(
      await screen.findByText('Ausbildungsberufe konnten nicht geladen werden')
    ).toBeInTheDocument();
  });
});

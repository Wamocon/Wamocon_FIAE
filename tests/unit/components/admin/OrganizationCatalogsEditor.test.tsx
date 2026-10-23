import { act, screen, waitFor, fireEvent } from '@testing-library/react';
import toast from 'react-hot-toast';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import { OrganizationCatalogsEditor } from '@/components/admin/OrganizationCatalogsEditor';
import { authFetch } from '@/lib/authFetch';

jest.mock('@/lib/authFetch', () => ({ authFetch: jest.fn() }));
jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { success: jest.fn(), error: jest.fn() },
}));

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';
const ORG = '11111111-1111-4111-8111-111111111111';

const entry = (
  id: string,
  code: string,
  isEnabled: boolean,
  isActive = true
) => ({
  trainingCatalogId: id,
  code,
  title: `Beruf ${code}`,
  isActive,
  isEnabled,
  traineeCount: 3,
});

function reply(data: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => data } as Response;
}

const listUrl = `/api/admin/organizations/${ORG}/catalogs`;

function mockApi(put?: Response) {
  (authFetch as jest.Mock).mockImplementation(
    async (url: string, init?: RequestInit) => {
      if (url !== listUrl) throw new Error(`unexpected request ${url}`);
      if (init?.method === 'PUT') {
        return (
          put ??
          reply({
            organizationId: ORG,
            catalogs: [entry(FIAE, 'FIAE', true), entry(KFBM, 'KFBM', true)],
          })
        );
      }
      return reply({
        organizationId: ORG,
        catalogs: [
          entry(FIAE, 'FIAE', true),
          entry(KFBM, 'KFBM', false, false),
        ],
      });
    }
  );
}

describe('OrganizationCatalogsEditor', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows which catalogs are enabled and which are inactive on the platform', async () => {
    mockApi();
    renderWithProviders(<OrganizationCatalogsEditor organizationId={ORG} />);
    const fiae = await screen.findByRole('checkbox', { name: /FIAE/ });
    const kfbm = screen.getByRole('checkbox', { name: /KFBM/ });
    expect(fiae).toBeChecked();
    expect(kfbm).not.toBeChecked();
    expect(screen.getByText('Plattform: inaktiv')).toBeInTheDocument();
  });

  it('enables a catalog with PUT and shows the new state', async () => {
    mockApi();
    renderWithProviders(<OrganizationCatalogsEditor organizationId={ORG} />);
    fireEvent.click(await screen.findByRole('checkbox', { name: /KFBM/ }));

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Freischaltung gespeichert')
    );
    const putCall = (authFetch as jest.Mock).mock.calls.find(
      ([, init]) => init?.method === 'PUT'
    );
    expect(JSON.parse(putCall?.[1].body)).toEqual({
      catalogId: KFBM,
      isEnabled: true,
    });
    await waitFor(() => {
      const kfbm = screen.getByRole('checkbox', { name: /KFBM/ });
      expect(kfbm).toBeChecked();
      expect(kfbm).toBeEnabled();
    });
  });

  it('shows the German reason when the last catalog is switched off', async () => {
    mockApi(reply({ error: 'last', code: 'LAST_ENABLED_CATALOG' }, 409));
    renderWithProviders(<OrganizationCatalogsEditor organizationId={ORG} />);
    fireEvent.click(await screen.findByRole('checkbox', { name: /FIAE/ }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Das ist der letzte freigeschaltete und aktive Beruf einer Organisation und kann nicht abgeschaltet werden.'
      )
    );
    // the state of the server is kept
    await waitFor(() => {
      const fiae = screen.getByRole('checkbox', { name: /FIAE/ });
      expect(fiae).toBeChecked();
      expect(fiae).toBeEnabled();
    });
  });

  it('reloads when the refresh key changes', async () => {
    mockApi();
    const { rerender } = renderWithProviders(
      <OrganizationCatalogsEditor organizationId={ORG} refreshKey={0} />
    );
    await screen.findByRole('checkbox', { name: /FIAE/ });
    const loads = () =>
      (authFetch as jest.Mock).mock.calls.filter(
        ([, init]) => init?.method !== 'PUT'
      ).length;
    expect(loads()).toBe(1);
    rerender(
      <OrganizationCatalogsEditor organizationId={ORG} refreshKey={1} />
    );
    await waitFor(() => expect(loads()).toBe(2));
    // let the second answer arrive before the test ends
    await act(async () => {});
  });

  it('shows an error when the catalogs cannot be loaded', async () => {
    (authFetch as jest.Mock).mockResolvedValue(reply({ error: 'x' }, 404));
    renderWithProviders(<OrganizationCatalogsEditor organizationId={ORG} />);
    expect(
      await screen.findByText('Ausbildungsberufe konnten nicht geladen werden')
    ).toBeInTheDocument();
  });
});

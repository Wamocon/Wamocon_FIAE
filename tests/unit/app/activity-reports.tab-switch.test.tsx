import { waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../helpers/renderWithProviders';
import TraineeActivityReportsPage from '@/app/trainee/activity-reports/page';
import TrainerActivityReportsPage from '@/app/trainer/activity-reports/page';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/lib/authFetch';
import { useRequestCatalog } from '@/lib/hooks/useRequestCatalog';
import { withCatalogParam } from '@/lib/catalog/request-catalog';

// A report (Ausbildungsnachweis) belongs to one occupation. The pages show the
// reports of the chosen occupation tab only and load them again when the tab
// changes: the trainee page asks for the occupation in the url of the list (a
// new query per occupation), the trainer page reloads its list.

jest.mock('@/contexts/AuthContext');
jest.mock('@/lib/authFetch');
jest.mock('@/lib/hooks/useRequestCatalog');
jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { success: jest.fn(), error: jest.fn() },
}));

const authFetchMock = authFetch as jest.MockedFunction<typeof authFetch>;
const useRequestCatalogMock = useRequestCatalog as jest.MockedFunction<
  typeof useRequestCatalog
>;

function json(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

/** The occupation the mocked hook reports, like the tab of the user. */
function chooseTab(catalog: string, ready = true) {
  useRequestCatalogMock.mockReturnValue({
    ready,
    catalog,
    withCatalog: (url: string) => withCatalogParam(url, catalog),
    phaseOneMonthsFor: () => undefined,
  } as ReturnType<typeof useRequestCatalog>);
}

const urls = (prefix: string) =>
  authFetchMock.mock.calls
    .map(call => String(call[0]))
    .filter(url => url.startsWith(prefix));

describe('occupation tabs of the Ausbildungsnachweis pages', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    authFetchMock.mockImplementation(async input => {
      const url = String(input);
      if (url.startsWith('/api/training-components')) {
        return json({ components: [] });
      }
      if (url.startsWith('/api/training-use-cases')) {
        return json({ useCases: [] });
      }
      if (url.startsWith('/api/trainer/trainees')) {
        return json({ trainees: [] });
      }
      if (url.startsWith('/api/trainer/activity-reports')) {
        return json({ reports: [] });
      }
      if (url.startsWith('/api/activity-reports')) {
        return json({ reports: [] });
      }
      return json({});
    });
  });

  describe('trainee page', () => {
    beforeEach(() => {
      (useAuth as jest.Mock).mockReturnValue({
        profile: { id: 'trainee-1', role: 'trainee' },
        loading: false,
        refreshProfile: jest.fn(() => Promise.resolve()),
      });
    });

    it('FIAE tab: the plain list url, exactly as before', async () => {
      chooseTab('FIAE');
      renderWithProviders(<TraineeActivityReportsPage />);
      await waitFor(() =>
        expect(urls('/api/activity-reports')).toContain(
          '/api/activity-reports?userId=trainee-1&limit=500'
        )
      );
      expect(
        urls('/api/activity-reports').some(url => url.includes('catalog='))
      ).toBe(false);
    });

    it('KfBM tab: asks for the reports of KfBM', async () => {
      chooseTab('KFBM');
      renderWithProviders(<TraineeActivityReportsPage />);
      await waitFor(() =>
        expect(urls('/api/activity-reports')).toContain(
          '/api/activity-reports?userId=trainee-1&limit=500&catalog=KFBM'
        )
      );
    });

    it('a switch of the tab asks for the list of the new occupation', async () => {
      chooseTab('FIAE');
      const { rerender } = renderWithProviders(<TraineeActivityReportsPage />);
      await waitFor(() =>
        expect(urls('/api/activity-reports')).toContain(
          '/api/activity-reports?userId=trainee-1&limit=500'
        )
      );
      chooseTab('KFBM');
      rerender(<TraineeActivityReportsPage />);
      await waitFor(() =>
        expect(urls('/api/activity-reports')).toContain(
          '/api/activity-reports?userId=trainee-1&limit=500&catalog=KFBM'
        )
      );
    });

    it('does not ask for the reports before the occupation is known', async () => {
      chooseTab('KFBM', false);
      renderWithProviders(<TraineeActivityReportsPage />);
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(urls('/api/activity-reports')).toHaveLength(0);
    });
  });

  describe('trainer page', () => {
    beforeEach(() => {
      (useAuth as jest.Mock).mockReturnValue({
        profile: { id: 'trainer-1', role: 'trainer' },
        loading: false,
      });
    });

    it('loads the report list once for the first tab', async () => {
      chooseTab('FIAE');
      renderWithProviders(<TrainerActivityReportsPage />);
      await waitFor(() =>
        expect(urls('/api/trainer/activity-reports')).toHaveLength(1)
      );
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(urls('/api/trainer/activity-reports')).toHaveLength(1);
    });

    it('a switch of the tab loads the list again, with the lists of the new occupation', async () => {
      chooseTab('FIAE');
      const { rerender } = renderWithProviders(<TrainerActivityReportsPage />);
      await waitFor(() =>
        expect(urls('/api/trainer/activity-reports')).toHaveLength(1)
      );
      chooseTab('KFBM');
      rerender(<TrainerActivityReportsPage />);
      await waitFor(() =>
        expect(urls('/api/trainer/activity-reports')).toHaveLength(2)
      );
      expect(urls('/api/training-components')).toEqual([
        '/api/training-components',
        '/api/training-components?catalog=KFBM',
      ]);
    });
  });
});

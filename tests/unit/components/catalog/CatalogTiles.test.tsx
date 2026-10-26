import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import { CatalogTiles } from '@/components/catalog/CatalogTiles';
import { useAuth } from '@/contexts/AuthContext';
import { useCatalog } from '@/contexts/CatalogContext';
import { DEFAULT_CATALOG_BRANDING } from '@/lib/catalog/branding';

jest.mock('@/contexts/AuthContext');
jest.mock('@/contexts/CatalogContext');
jest.mock('@/lib/authFetch', () => ({ authFetch: jest.fn() }));

const push = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: jest.fn() }),
}));

const FIAE_TITLE = 'Fachinformatiker/in Anwendungsentwicklung';
const KFBM_TITLE = 'Kaufmann/-frau für Büromanagement';

// The public list of the active occupations (GET /api/catalogs)
const PUBLIC_FIAE = {
  code: 'FIAE',
  title: FIAE_TITLE,
  description: 'Software entwickeln und betreuen.',
  durationYears: 3,
  phaseMonths: [18, 18],
};
const PUBLIC_KFBM = {
  code: 'KFBM',
  title: KFBM_TITLE,
  description: 'Büroprozesse organisieren.',
  durationYears: 3,
  phaseMonths: [15, 21],
};

// The occupations of the user (CatalogContext, from GET /api/me/catalogs)
const MINE_FIAE = {
  code: 'FIAE',
  title: FIAE_TITLE,
  branding: DEFAULT_CATALOG_BRANDING,
};
const MINE_KFBM = {
  code: 'KFBM',
  title: KFBM_TITLE,
  branding: {
    title: 'KfBM Lernplattform',
    shortName: 'KfBM',
    accent: '#0f766e',
  },
};

const selectCatalog = jest.fn();

function setup({
  role = 'trainer',
  mine = [MINE_FIAE],
  activeCode = 'FIAE',
  status = 'ready',
  list = [PUBLIC_FIAE, PUBLIC_KFBM] as unknown,
  fetchImpl,
}: {
  role?: string;
  mine?: unknown[];
  activeCode?: string | null;
  status?: string;
  list?: unknown;
  fetchImpl?: jest.Mock;
} = {}) {
  (useAuth as jest.Mock).mockReturnValue({
    profile: { id: 'u1', role, full_name: 'Test Person' },
  });
  (useCatalog as jest.Mock).mockReturnValue({
    status,
    catalogs: mine,
    activeCode,
    isMultiple: mine.length > 1,
    selectCatalog,
  });
  global.fetch = (fetchImpl ??
    jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ catalogs: list }),
      })
    )) as unknown as typeof fetch;
  const user = userEvent.setup();
  renderWithProviders(<CatalogTiles />);
  return { user };
}

const tile = (title: string) => screen.findByRole('article', { name: title });

describe('CatalogTiles', () => {
  const originalFetch = global.fetch;
  beforeAll(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = false;
  });
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('only FIAE is enabled', () => {
    it('shows one open tile and the other occupation greyed out, not hidden', async () => {
      setup();
      const fiae = await tile(FIAE_TITLE);
      const kfbm = await tile(KFBM_TITLE);

      expect(
        within(fiae).getByRole('button', { name: `Weiter mit ${FIAE_TITLE}` })
      ).toBeEnabled();
      expect(within(fiae).queryByText('Nicht freigeschaltet')).toBeNull();

      expect(
        within(kfbm).getByText('Nicht freigeschaltet')
      ).toBeInTheDocument();
      expect(
        within(kfbm).queryByRole('button', { name: /^Weiter/ })
      ).toBeNull();
    });

    it('keeps the greyed tile reachable with the keyboard (aria-disabled, not disabled)', async () => {
      const { user } = setup();
      await tile(KFBM_TITLE);
      const locked = screen.getByRole('button', {
        name: `Abo anfragen für ${KFBM_TITLE}`,
      });
      expect(locked).not.toBeDisabled();
      expect(locked).toHaveAttribute('aria-disabled', 'true');
      expect(locked).toHaveAttribute('aria-haspopup', 'dialog');

      await user.tab();
      expect(
        screen.getByRole('button', { name: `Weiter mit ${FIAE_TITLE}` })
      ).toHaveFocus();
      await user.tab();
      expect(locked).toHaveFocus();
    });

    it('opens the request dialog by click and by keyboard, and names the occupation', async () => {
      const { user } = setup();
      await tile(KFBM_TITLE);
      const locked = screen.getByRole('button', {
        name: `Abo anfragen für ${KFBM_TITLE}`,
      });
      await user.click(locked);
      expect(
        await screen.findByRole('dialog', {
          name: `Abo anfragen: ${KFBM_TITLE}`,
        })
      ).toBeInTheDocument();
      await user.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      // the focus is back on the tile that opened it
      await waitFor(() => expect(locked).toHaveFocus());

      await user.keyboard('{Enter}');
      expect(await screen.findByRole('dialog')).toBeInTheDocument();
    });

    it('does not select the greyed occupation', async () => {
      const { user } = setup();
      await tile(KFBM_TITLE);
      await user.click(
        screen.getByRole('button', { name: `Abo anfragen für ${KFBM_TITLE}` })
      );
      expect(selectCatalog).not.toHaveBeenCalled();
      expect(push).not.toHaveBeenCalled();
    });
  });

  describe('choosing an occupation', () => {
    it('goes to the trainer dashboard for the occupation that is already active (no reload)', async () => {
      const { user } = setup({ role: 'admin' });
      await tile(FIAE_TITLE);
      await user.click(
        screen.getByRole('button', { name: `Weiter mit ${FIAE_TITLE}` })
      );
      expect(push).toHaveBeenCalledWith('/trainer/dashboard');
      expect(selectCatalog).not.toHaveBeenCalled();
    });

    it('goes to the trainee dashboard for a trainee', async () => {
      const { user } = setup({ role: 'trainee' });
      await tile(FIAE_TITLE);
      await user.click(
        screen.getByRole('button', { name: `Weiter mit ${FIAE_TITLE}` })
      );
      expect(push).toHaveBeenCalledWith('/trainee/dashboard');
    });

    it('sets another occupation through the context, which stores the choice', async () => {
      const { user } = setup({
        mine: [MINE_FIAE, MINE_KFBM],
        activeCode: 'FIAE',
      });
      await tile(KFBM_TITLE);
      await user.click(
        screen.getByRole('button', { name: `Weiter mit ${KFBM_TITLE}` })
      );
      expect(selectCatalog).toHaveBeenCalledWith('KFBM', '/trainer/dashboard');
      expect(push).not.toHaveBeenCalled();
    });

    it('shows no greyed tile when both occupations are enabled', async () => {
      setup({ mine: [MINE_FIAE, MINE_KFBM] });
      await tile(KFBM_TITLE);
      expect(screen.queryByText('Nicht freigeschaltet')).toBeNull();
      expect(screen.queryByText('Abo anfragen')).toBeNull();
      expect(screen.getAllByRole('button')).toHaveLength(2);
    });

    it('opens every active occupation for a platform administrator', async () => {
      // /api/me/catalogs gives a SUPER_ADMIN every occupation, also an inactive one
      const inactive = {
        code: 'OLD',
        title: 'Alter Beruf',
        branding: DEFAULT_CATALOG_BRANDING,
      };
      setup({ role: 'super_admin', mine: [MINE_FIAE, MINE_KFBM, inactive] });
      await tile(KFBM_TITLE);
      expect(screen.queryByText('Nicht freigeschaltet')).toBeNull();
      // only active occupations are tiles
      expect(screen.queryByText('Alter Beruf')).toBeNull();
      expect(screen.getAllByRole('article')).toHaveLength(2);
    });

    it('opens the dashboard for a user whose occupation is not FIAE', async () => {
      const { user } = setup({
        mine: [MINE_KFBM],
        activeCode: 'KFBM',
      });
      const fiae = await tile(FIAE_TITLE);
      // FIAE is the greyed one here
      expect(
        within(fiae).getByText('Nicht freigeschaltet')
      ).toBeInTheDocument();
      await user.click(
        screen.getByRole('button', { name: `Weiter mit ${KFBM_TITLE}` })
      );
      expect(push).toHaveBeenCalledWith('/trainer/dashboard');
    });
  });

  describe('a trainee', () => {
    it('sees the note instead of a request, on the greyed tile', async () => {
      const { user } = setup({ role: 'trainee' });
      const kfbm = await tile(KFBM_TITLE);
      expect(
        within(kfbm).getByText(
          'Für Ihren Betrieb nicht freigeschaltet. Bitte wenden Sie sich an Ihren Ausbilder.'
        )
      ).toBeInTheDocument();
      expect(within(kfbm).queryByRole('button')).toBeNull();
      await user.click(kfbm);
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('is not offered the request on any tile', async () => {
      setup({ role: 'TRAINEE' });
      await tile(KFBM_TITLE);
      expect(screen.queryByText('Abo anfragen')).toBeNull();
    });
  });

  describe('what a tile shows', () => {
    it('takes title, description, duration and phases from the data', async () => {
      setup({ mine: [MINE_FIAE, MINE_KFBM] });
      const kfbm = await tile(KFBM_TITLE);
      expect(
        within(kfbm).getByRole('heading', { name: KFBM_TITLE })
      ).toBeInTheDocument();
      expect(
        within(kfbm).getByText('Büroprozesse organisieren.')
      ).toBeInTheDocument();
      expect(
        within(kfbm).getByText('3 Jahre Ausbildungsdauer')
      ).toBeInTheDocument();
      expect(
        within(kfbm).getByText('Phasen: 15 und 21 Monate')
      ).toBeInTheDocument();
      const fiae = await tile(FIAE_TITLE);
      expect(
        within(fiae).getByText('Phasen: 18 und 18 Monate')
      ).toBeInTheDocument();
    });

    it('leaves out what is not delivered and writes no fixed months', async () => {
      setup({
        list: [{ code: 'FIAE', title: FIAE_TITLE, durationYears: 2 }],
      });
      const fiae = await tile(FIAE_TITLE);
      expect(
        within(fiae).getByText('2 Jahre Ausbildungsdauer')
      ).toBeInTheDocument();
      expect(within(fiae).queryByText(/Phasen/)).toBeNull();
    });

    it('shows the accent only on an open tile that has a branding', async () => {
      setup({ mine: [MINE_FIAE, MINE_KFBM] });
      await tile(KFBM_TITLE);
      expect(screen.getByTestId('tile-accent-KFBM')).toHaveStyle({
        backgroundColor: '#0f766e',
      });
      // FIAE keeps today's look
      expect(screen.queryByTestId('tile-accent-FIAE')).toBeNull();
    });

    it('shows no accent on a greyed tile and none for FIAE, even if one is stored', async () => {
      setup({
        mine: [{ ...MINE_FIAE, branding: MINE_KFBM.branding }],
      });
      await tile(KFBM_TITLE);
      expect(screen.queryByTestId('tile-accent-FIAE')).toBeNull();
      expect(screen.queryByTestId('tile-accent-KFBM')).toBeNull();
    });

    it('lists FIAE first', async () => {
      setup({
        mine: [MINE_FIAE, MINE_KFBM],
        list: [{ ...PUBLIC_KFBM, code: 'BUERO', title: 'Büro' }, PUBLIC_FIAE],
      });
      await tile(FIAE_TITLE);
      const titles = screen
        .getAllByRole('heading', { level: 2 })
        .map(h => h.textContent);
      expect(titles).toEqual([FIAE_TITLE, 'Büro']);
    });

    it('asks for the public list once', async () => {
      setup();
      await tile(FIAE_TITLE);
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(global.fetch).toHaveBeenCalledWith('/api/catalogs');
    });
  });

  describe('states', () => {
    it('says that the occupations are loading', () => {
      setup({ status: 'loading' });
      expect(screen.getByRole('status')).toHaveTextContent(
        'Die Berufe werden geladen'
      );
    });

    it('waits for the occupations of the user, not only for the public list', async () => {
      setup({ status: 'loading' });
      await waitFor(() => expect(global.fetch).toHaveBeenCalled());
      expect(screen.queryByRole('article')).toBeNull();
    });

    it('shows an error with a retry when the public list cannot be loaded', async () => {
      const fetchImpl = jest.fn().mockRejectedValue(new Error('offline'));
      const { user } = setup({ fetchImpl });
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(
        'Die Berufe konnten nicht geladen werden'
      );
      fetchImpl.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ catalogs: [PUBLIC_FIAE] }),
      });
      await user.click(
        screen.getByRole('button', { name: 'Erneut versuchen' })
      );
      expect(await tile(FIAE_TITLE)).toBeInTheDocument();
    });

    it('says so when there is no active occupation', async () => {
      setup({ list: [] });
      expect(
        await screen.findByText('Zurzeit sind keine Ausbildungsberufe aktiv.')
      ).toBeInTheDocument();
    });

    it('lets the user go on to the dashboard when their own occupations could not be loaded', async () => {
      const { user } = setup({ status: 'error', mine: [], activeCode: null });
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Ihre Berufe konnten nicht geladen werden.'
      );
      await user.click(screen.getByRole('button', { name: 'Zum Dashboard' }));
      expect(push).toHaveBeenCalledWith('/trainer/dashboard');
    });
  });
});

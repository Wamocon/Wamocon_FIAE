import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import { CatalogSelection } from '@/components/catalog/CatalogSelection';

const FIAE = {
  code: 'FIAE',
  title: 'Fachinformatiker/in Anwendungsentwicklung',
  description: null,
  durationYears: 3,
  occupationCode: 'FIAE',
  regulationVersion: '2020',
  phaseMonths: [18, 18],
  schoolOrganization: 'block',
};
const KFBM = {
  code: 'KFBM',
  title: 'Kaufmann/-frau für Büromanagement',
  description: 'Büro, Organisation und Kommunikation',
  durationYears: 3,
  occupationCode: 'KFBM',
  regulationVersion: '2025',
  phaseMonths: [15, 21],
  schoolOrganization: 'weekdays',
};

const ok = (catalogs: unknown[]) =>
  Promise.resolve({ ok: true, json: () => Promise.resolve({ catalogs }) });

describe('CatalogSelection', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('loads the active occupations from the public list and shows each as a card', async () => {
    global.fetch = jest.fn(() => ok([FIAE, KFBM])) as any;
    renderWithProviders(<CatalogSelection />);

    expect(screen.getByText('Die Berufe werden geladen')).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', {
        level: 2,
        name: 'Kaufmann/-frau für Büromanagement',
      })
    ).toBeInTheDocument();

    expect(global.fetch).toHaveBeenCalledWith('/api/catalogs');
    expect(
      screen.getByRole('list', { name: 'Verfügbare Ausbildungsberufe' })
    ).toBeInTheDocument();
    // one card (article) per occupation, the detail lines are a nested list
    expect(screen.getAllByRole('article')).toHaveLength(2);
  });

  it('shows duration, phases from the settings, school form and regulation per occupation', async () => {
    global.fetch = jest.fn(() => ok([FIAE, KFBM])) as any;
    renderWithProviders(<CatalogSelection />);
    await screen.findByText('Phasen: 15 und 21 Monate');

    expect(screen.getByText('Phasen: 18 und 18 Monate')).toBeInTheDocument();
    expect(screen.getAllByText('3 Jahre Ausbildungsdauer')).toHaveLength(2);
    expect(
      screen.getByText('Berufsschule an festen Wochentagen')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Berufsschule im Blockunterricht')
    ).toBeInTheDocument();
    expect(screen.getByText('Ordnungsfassung 2025')).toBeInTheDocument();
    expect(screen.getByText('Ordnungsfassung 2020')).toBeInTheDocument();
    expect(
      screen.getByText('Büro, Organisation und Kommunikation')
    ).toBeInTheDocument();
  });

  it('leads every occupation to the existing sign in', async () => {
    global.fetch = jest.fn(() => ok([FIAE, KFBM])) as any;
    renderWithProviders(<CatalogSelection />);
    await screen.findByText('Phasen: 15 und 21 Monate');

    const links = screen.getAllByRole('link', { name: /Zur Anmeldung/ });
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link).toHaveAttribute('href', '/login');
    }
  });

  it('shows a hint instead of an empty list when no occupation is active', async () => {
    global.fetch = jest.fn(() => ok([])) as any;
    renderWithProviders(<CatalogSelection />);
    expect(
      await screen.findByText(
        'Zurzeit sind keine Ausbildungsberufe freigeschaltet.'
      )
    ).toBeInTheDocument();
    expect(screen.queryAllByRole('article')).toHaveLength(0);
  });

  it('shows an error with a retry that loads the list again', async () => {
    const fetchMock = jest
      .fn()
      .mockImplementationOnce(() => Promise.resolve({ ok: false }))
      .mockImplementation(() => ok([KFBM]));
    global.fetch = fetchMock as any;
    renderWithProviders(<CatalogSelection />);

    expect(
      await screen.findByText(
        'Die Berufe konnten nicht geladen werden. Bitte versuchen Sie es später erneut.'
      )
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(
      await screen.findByRole('heading', {
        level: 2,
        name: 'Kaufmann/-frau für Büromanagement',
      })
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('treats a network failure like a failed request', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('offline'))) as any;
    renderWithProviders(<CatalogSelection />);
    await waitFor(() =>
      expect(
        screen.getByText(
          'Die Berufe konnten nicht geladen werden. Bitte versuchen Sie es später erneut.'
        )
      ).toBeInTheDocument()
    );
  });

  it('survives an occupation without optional fields', async () => {
    global.fetch = jest.fn(() =>
      ok([
        {
          code: 'X',
          title: 'Neuer Beruf',
          durationYears: 2,
          phaseMonths: [12, 12],
        },
      ])
    ) as any;
    renderWithProviders(<CatalogSelection />);
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Neuer Beruf' })
    ).toBeInTheDocument();
    expect(screen.getByText('2 Jahre Ausbildungsdauer')).toBeInTheDocument();
    expect(screen.queryByText(/Ordnungsfassung/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Berufsschule/)).not.toBeInTheDocument();
  });
});

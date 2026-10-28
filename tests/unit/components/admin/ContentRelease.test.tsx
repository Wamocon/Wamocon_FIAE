import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import { ContentReleasePanel } from '@/components/admin/ContentReleasePanel';
import { TraineeContentAssign } from '@/components/admin/TraineeContentAssign';
import { authFetch } from '@/lib/authFetch';

jest.mock('@/lib/authFetch', () => ({ authFetch: jest.fn() }));
jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { success: jest.fn(), error: jest.fn() },
}));

const authFetchMock = authFetch as jest.Mock;

function reply(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as Response;
}

const counts = (n: number) => ({
  courses: n,
  enablers: n,
  useCases: n,
  lessonQuizzes: n,
  globalQuizzes: n,
});

function result(over: Record<string, unknown> = {}) {
  return {
    mode: 'release',
    dryRun: true,
    changes: counts(0),
    total: counts(10),
    active: counts(0),
    catalogActive: true,
    logged: false,
    ...over,
  };
}

describe('ContentReleasePanel', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows the numbers, needs a trial run and the typed code before it writes', async () => {
    authFetchMock.mockImplementation(async (_url: string, init: any) => {
      const body = JSON.parse(init.body);
      if (body.execute === true) {
        return reply(
          result({ dryRun: false, changes: counts(10), logged: true })
        );
      }
      return reply(result({ changes: counts(10) }));
    });
    renderWithProviders(
      <ContentReleasePanel
        catalogId="cat-1"
        catalogCode="KFBM"
        onClose={() => undefined}
      />
    );
    // the numbers come from a trial run on open
    expect(await screen.findByText('Komponenten')).toBeInTheDocument();
    expect(JSON.parse(authFetchMock.mock.calls[0][1].body)).toEqual({
      mode: 'release',
      execute: false,
    });

    // no run button before the trial
    expect(
      screen.queryByRole('button', { name: 'Jetzt freigeben' })
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Probelauf' }));
    const run = await screen.findByRole('button', { name: 'Jetzt freigeben' });
    expect(run).toBeDisabled();

    // a wrong code keeps it disabled, the right one enables it
    const input = screen.getByLabelText(/KFBM eintippen/);
    fireEvent.change(input, { target: { value: 'kfbm' } });
    expect(run).toBeDisabled();
    fireEvent.change(input, { target: { value: 'KFBM' } });
    expect(run).toBeEnabled();

    fireEvent.click(run);
    await waitFor(() =>
      expect(
        authFetchMock.mock.calls.some(
          c => JSON.parse(c[1].body).execute === true
        )
      ).toBe(true)
    );
    const last = authFetchMock.mock.calls.find(
      c => JSON.parse(c[1].body).execute === true
    )!;
    expect(JSON.parse(last[1].body)).toEqual({
      mode: 'release',
      execute: true,
      confirmCode: 'KFBM',
    });
  });

  it('a changed action resets the trial and the confirmation', async () => {
    authFetchMock.mockResolvedValue(reply(result({ changes: counts(3) })));
    renderWithProviders(
      <ContentReleasePanel
        catalogId="cat-1"
        catalogCode="KFBM"
        onClose={() => undefined}
      />
    );
    await screen.findByText('Komponenten');
    fireEvent.click(screen.getByRole('button', { name: 'Probelauf' }));
    await screen.findByRole('button', { name: 'Jetzt freigeben' });
    fireEvent.click(screen.getByLabelText('Sperren'));
    expect(
      screen.queryByRole('button', { name: 'Jetzt freigeben' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Jetzt sperren' })
    ).not.toBeInTheDocument();
  });

  it('offers no run when nothing would change (idempotent)', async () => {
    authFetchMock.mockResolvedValue(reply(result()));
    renderWithProviders(
      <ContentReleasePanel
        catalogId="cat-1"
        catalogCode="KFBM"
        onClose={() => undefined}
      />
    );
    await screen.findByText('Komponenten');
    fireEvent.click(screen.getByRole('button', { name: 'Probelauf' }));
    expect(await screen.findByText(/Nichts zu ändern/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/KFBM eintippen/), {
      target: { value: 'KFBM' },
    });
    expect(
      screen.getByRole('button', { name: 'Jetzt freigeben' })
    ).toBeDisabled();
  });

  it('shows a message when the numbers cannot be loaded', async () => {
    authFetchMock.mockResolvedValue(reply({}, 500));
    renderWithProviders(
      <ContentReleasePanel
        catalogId="cat-1"
        catalogCode="KFBM"
        onClose={() => undefined}
      />
    );
    expect(
      await screen.findByText('Die Zahlen konnten nicht geladen werden.')
    ).toBeInTheDocument();
  });
});

describe('TraineeContentAssign', () => {
  beforeEach(() => jest.clearAllMocks());

  const catalogs = {
    catalogs: [
      {
        trainingCatalogId: 'c-k',
        code: 'KFBM',
        title: 'KfBM',
        isActive: true,
        isEnabled: true,
        traineeCount: 2,
      },
      {
        trainingCatalogId: 'c-off',
        code: 'OFF',
        title: 'Nicht freigeschaltet',
        isActive: true,
        isEnabled: false,
        traineeCount: 0,
      },
    ],
  };

  it('lists only the occupations enabled and active for the organization, trial before assigning', async () => {
    authFetchMock.mockImplementation(async (url: string, init: any) => {
      if (url.includes('/catalogs') && !init?.method) return reply(catalogs);
      const body = JSON.parse(init.body);
      return reply({
        dryRun: !body.execute,
        trainees: 3,
        traineesChanged: 2,
        skippedNoOrganization: 1,
        courseMembersMissing: 7,
        quizAssignmentsMissing: 5,
        courseMembersAdded: body.execute ? 7 : 0,
        quizAssignmentsAdded: body.execute ? 5 : 0,
      });
    });
    renderWithProviders(<TraineeContentAssign organizationId="org-1" />);

    expect(await screen.findByText('KfBM')).toBeInTheDocument();
    expect(screen.queryByText('Nicht freigeschaltet')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Zuweisen' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Probelauf' }));
    expect(
      await screen.findByText(/3 Azubis geprüft, bei 2 fehlt etwas/)
    ).toBeInTheDocument();
    expect(
      screen.getByText('1 Azubis ohne Organisation wurden übersprungen.')
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Jetzt zuweisen' }));
    await waitFor(() => {
      const call = authFetchMock.mock.calls.find(
        c => c[1]?.body && JSON.parse(c[1].body).execute === true
      );
      expect(call).toBeDefined();
      expect(call![0]).toBe('/api/admin/catalogs/c-k/trainee-content');
      expect(JSON.parse(call![1].body)).toEqual({
        execute: true,
        organizationId: 'org-1',
      });
    });
  });

  it('renders nothing for an organization without a usable occupation', async () => {
    authFetchMock.mockResolvedValue(
      reply({ catalogs: [catalogs.catalogs[1]] })
    );
    const { container } = renderWithProviders(
      <TraineeContentAssign organizationId="org-1" />
    );
    await waitFor(() => expect(authFetchMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});

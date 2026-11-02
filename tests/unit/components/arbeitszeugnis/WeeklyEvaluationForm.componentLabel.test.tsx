import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import WeeklyEvaluationForm from '@/components/arbeitszeugnis/WeeklyEvaluationForm';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/lib/authFetch';

// The selected topic shows the label of a FIAE component ([2.2]), not its code
// (2-P2). Without a label the code is shown as before.

jest.mock('@/contexts/AuthContext');
jest.mock('@/lib/authFetch');
jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));

const authFetchMock = authFetch as jest.MockedFunction<typeof authFetch>;

function json(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

const evaluation = {
  id: 'e1',
  weekNumber: 10,
  year: 2027,
  ausbildungsjahr: 1,
  selfRating: null,
  selfComment: null,
  trainerRating: null,
  trainerComment: null,
  status: 'DRAFT' as const,
  arpUseCaseId: 'u1',
  arpThemeText: null,
  rejectionReason: null,
};

function render(component: Record<string, unknown>) {
  authFetchMock.mockResolvedValue(
    json({ catalogs: [{ code: 'FIAE', title: 'F' }], activeCode: 'FIAE' })
  );
  global.fetch = jest.fn(async () =>
    json({
      useCases: [
        {
          id: 'u1',
          letter: 'a',
          description: 'Kundenberatung planen',
          componentId: 'c1',
          component,
        },
      ],
    })
  ) as unknown as typeof fetch;
  return renderWithProviders(
    <WeeklyEvaluationForm
      weekNumber={10}
      year={2027}
      ausbildungsjahr={1}
      existingEvaluation={evaluation}
    />
  );
}

describe('WeeklyEvaluationForm: the label of a component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useAuth as jest.Mock).mockReturnValue({
      profile: { id: 'trainee-1', role: 'trainee' },
    });
  });

  it('shows [2.2] for the component 2-P2 in the selected topic', async () => {
    render({ code: '2-P2', label: '2.2', title: 'Informieren (Vertiefung)' });
    await waitFor(() =>
      expect(screen.getByText(/\[2\.2\]/)).toBeInTheDocument()
    );
    expect(screen.queryByText(/2-P2/)).not.toBeInTheDocument();
  });

  it('shows the code when the answer has no label', async () => {
    render({ code: 'K1', title: 'Thema' });
    await waitFor(() => expect(screen.getByText(/\[K1\]/)).toBeInTheDocument());
  });
});

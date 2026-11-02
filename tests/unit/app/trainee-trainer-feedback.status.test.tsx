import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../helpers/renderWithProviders';
import TraineeFeedbackPage from '@/app/trainee/trainer-feedback/page';
import { useAuth } from '@/contexts/AuthContext';
import { useApiQuery } from '@/lib/hooks/useApiQuery';

// WMCNL-2949: the status of a submission stood there as the value of the
// database (PENDING, APPROVED, REJECTED) in the German page. The lists are
// called "Themenkreis-Einreichungen", not "Lesson".

jest.mock('@/contexts/AuthContext');
jest.mock('@/lib/hooks/useApiQuery');

const submission = (id: string, status: string) => ({
  id,
  enablerId: `en-${id}`,
  enablerTitle: `Themenkreis ${id}`,
  status,
  submittedAt: '2026-10-29T10:00:00.000Z',
  attemptNumber: 1,
  trainerFeedback: null,
  feedbacks: null,
  solutionText: null,
  solutions: null,
});

describe('trainee feedback page: status and names', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useAuth as jest.Mock).mockReturnValue({
      profile: { id: 'p1', role: 'trainee' },
      loading: false,
    });
    (useApiQuery as jest.Mock).mockReturnValue({
      isLoading: false,
      data: {
        enablerResults: [
          submission('a', 'PENDING'),
          submission('b', 'APPROVED'),
          submission('c', 'REJECTED'),
        ],
        useCaseResults: [
          {
            id: 'u1',
            useCaseId: 'uc1',
            useCaseTitle: 'Use Case 1',
            status: 'PENDING',
            submittedAt: '2026-10-29T10:00:00.000Z',
          },
        ],
        enablerQuizResults: [],
        globalQuizResults: [],
      },
    });
  });

  it('shows the status in German', () => {
    renderWithProviders(<TraineeFeedbackPage />);
    // two submissions are in review (one Themenkreis, one use case)
    expect(screen.getAllByText('In Prüfung')).toHaveLength(2);
    expect(screen.getByText('Genehmigt')).toBeInTheDocument();
    expect(screen.getByText('Abgelehnt')).toBeInTheDocument();
    for (const raw of ['PENDING', 'APPROVED', 'REJECTED']) {
      expect(screen.queryByText(raw)).not.toBeInTheDocument();
    }
  });

  it('calls the lists Themenkreis, not Lesson', () => {
    renderWithProviders(<TraineeFeedbackPage />);
    expect(screen.getByText('Themenkreis-Einreichungen')).toBeInTheDocument();
    expect(screen.getByText('Themenkreis-Quiz Ergebnisse')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Lesson/);
  });
});

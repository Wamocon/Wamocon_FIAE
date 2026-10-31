import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import TraineeDashboard from '@/components/dashboard/TraineeDashboard';
import TrainerDashboard from '@/components/dashboard/TrainerDashboard';
import { SchoolView } from '@/components/school/SchoolView';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter, useSearchParams } from 'next/navigation';

// KFB-1167: the card "Anstehende Termine" of the trainee dashboard did not open
// the calendar and did not show the appointments of the calendar.
// KFB-1168/1172: the card "Offene Reviews" opened the tab of the enablers even
// when only quizzes waited, so the list behind the number looked empty.

jest.mock('@/contexts/AuthContext');
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  useSearchParams: jest.fn(),
}));
jest.mock('@/components/dashboard/DashboardCharts', () => ({
  ProgressTrendChart: () => null,
  ModuleProgressChart: () => null,
}));
jest.mock('@/components/dashboard/TraineeDashboardCharts', () => ({
  WeeklyProgressChart: () => null,
  SkillRadarChart: () => null,
  ModuleBarChart: () => null,
}));
jest.mock('@/components/school/BlockCalendar', () => ({
  BlockCalendar: () => <div>calendar-tab</div>,
}));
jest.mock('@/components/school/ExamManager', () => ({
  ExamManager: () => <div>exams-tab</div>,
}));
jest.mock('@/components/school/ActivityReportsList', () => ({
  ActivityReportsList: () => null,
}));
jest.mock('@/components/school/LernfeldNotes', () => ({
  LernfeldNotes: () => null,
}));
jest.mock('@/components/school/LernfelderTab', () => ({
  LernfelderTab: () => <div>lernfelder-tab</div>,
}));

const push = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  (useRouter as jest.Mock).mockReturnValue({ push });
  (useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams());
});

const respond = (body: unknown) =>
  (global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => body,
  }));

const traineeData = (over: Record<string, unknown> = {}) => ({
  modules: [],
  nextItem: null,
  weeklyProgress: [],
  skillRadar: [],
  achievements: [],
  deadlines: [],
  appointments: [],
  ...over,
});

describe('trainee dashboard: card "Anstehende Termine"', () => {
  beforeEach(() => {
    (useAuth as jest.Mock).mockReturnValue({
      user: { id: 'u1' },
      profile: { id: 'p1', role: 'trainee', birth_date: '2000-01-01' },
    });
  });

  it('opens the calendar tab when the card is pressed', async () => {
    respond(traineeData());
    renderWithProviders(<TraineeDashboard />);
    const heading = await screen.findByText('Anstehende Termine');
    fireEvent.click(heading);
    expect(push).toHaveBeenCalledWith('/trainee/school?tab=calendar');
  });

  it('can be used with the keyboard', async () => {
    respond(traineeData());
    renderWithProviders(<TraineeDashboard />);
    const card = (await screen.findByText('Anstehende Termine')).closest(
      '[role="link"]'
    ) as HTMLElement;
    expect(card).not.toBeNull();
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(push).toHaveBeenCalledWith('/trainee/school?tab=calendar');
  });

  it('shows the appointments of the calendar', async () => {
    respond(
      traineeData({
        appointments: [
          {
            id: 'b1',
            label: 'Zahnarzt',
            kind: 'PERSONAL',
            source: 'block',
            startDate: '2026-11-08T07:00:00.000Z',
            endDate: '2026-11-08T08:00:00.000Z',
          },
          {
            id: 'e1',
            label: null,
            kind: 'EXAM',
            source: 'block',
            startDate: '2026-11-12T07:00:00.000Z',
            endDate: '2026-11-12T10:00:00.000Z',
          },
        ],
      })
    );
    renderWithProviders(<TraineeDashboard />);
    await waitFor(() =>
      expect(screen.getByText(/Zahnarzt/)).toBeInTheDocument()
    );
    // an entry without a text is named by its kind
    expect(screen.getByText(/Prüfung/)).toBeInTheDocument();
    expect(screen.queryByText('Keine anstehenden Termine')).toBeNull();
  });

  it('says so when nothing is coming up, and still opens the calendar', async () => {
    respond(traineeData());
    renderWithProviders(<TraineeDashboard />);
    expect(
      await screen.findByText('Keine anstehenden Termine')
    ).toBeInTheDocument();
  });
});

describe('school page: deep links', () => {
  beforeEach(() => {
    (useAuth as jest.Mock).mockReturnValue({
      profile: { id: 'p1', role: 'trainee' },
      loading: false,
    });
    respond({ exams: [], blocks: [], meta: {} });
  });

  it('tab=calendar opens the calendar', async () => {
    (useSearchParams as jest.Mock).mockReturnValue(
      new URLSearchParams('tab=calendar')
    );
    renderWithProviders(<SchoolView />);
    expect(await screen.findByText('calendar-tab')).toBeInTheDocument();
  });

  it('tab=blocks (links of older notifications) opens the calendar too', async () => {
    (useSearchParams as jest.Mock).mockReturnValue(
      new URLSearchParams('tab=blocks')
    );
    renderWithProviders(<SchoolView />);
    expect(await screen.findByText('calendar-tab')).toBeInTheDocument();
  });
});

describe('trainer dashboard: card "Offene Reviews" opens the tab with work', () => {
  beforeEach(() => {
    (useAuth as jest.Mock).mockReturnValue({
      user: { id: 'u1' },
      profile: { id: 'p1', role: 'TRAINER' },
    });
  });

  const trainerData = (counts: Record<string, number>) => ({
    trainees: [],
    counts: {
      activeTrainees: 0,
      pendingReviews: 0,
      pendingQuiz: 0,
      pendingUseCases: 0,
      pendingEnablers: 0,
      ...counts,
    },
    charts: { progressTrend: [], moduleProgress: [] },
  });

  const reviewButton = async () => {
    const buttons = await screen.findAllByRole('button', { name: 'Prüfen' });
    // the first card is the proofs, the second the reviews
    return buttons[1];
  };

  it.each([
    [{ pendingReviews: 2, pendingQuiz: 2 }, 'quizzes'],
    [{ pendingReviews: 3, pendingUseCases: 3 }, 'usecases'],
    [{ pendingReviews: 4, pendingEnablers: 1, pendingQuiz: 3 }, 'enablers'],
  ])('%j opens the %s tab', async (counts, view) => {
    respond(trainerData(counts));
    renderWithProviders(<TrainerDashboard />);
    await screen.findByText(String(counts.pendingReviews));
    fireEvent.click(await reviewButton());
    expect(push).toHaveBeenCalledWith(
      `/trainer/reviews?onlyPending=true&view=${view}`
    );
  });
});

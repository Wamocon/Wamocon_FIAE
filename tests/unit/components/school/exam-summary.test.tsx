import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import { ExamManager } from '@/components/school/ExamManager';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/lib/authFetch';

// WMCNL-2961: "1 anstehende Prüfungen" (plural for one exam).

jest.mock('@/contexts/AuthContext');
jest.mock('@/lib/authFetch');

const authFetchMock = authFetch as jest.MockedFunction<typeof authFetch>;

const exams = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `e${i}`,
    examDate: '2026-12-01T00:00:00.000Z',
    dayOfWeek: null,
    period: null,
    teacher: null,
    subject: `Fach ${i}`,
    examTypeValue: null,
    lernfeldCode: null,
    notes: null,
    isPersonal: true,
    result: null,
    meta: { daysUntil: 20, isPast: false, isToday: false, isSoon: false },
  }));

function listOf(n: number) {
  authFetchMock.mockImplementation(
    async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({ exams: exams(n) }),
      }) as Response
  );
}

describe('ExamManager summary line', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useAuth as jest.Mock).mockReturnValue({
      profile: { id: 'trainee-1', role: 'trainee' },
      loading: false,
    });
  });

  it('uses the singular for one exam', async () => {
    listOf(1);
    renderWithProviders(<ExamManager />);
    expect(await screen.findByText('1 anstehende Prüfung')).toBeInTheDocument();
  });

  it('uses the plural for several exams and for none', async () => {
    listOf(2);
    const first = renderWithProviders(<ExamManager />);
    expect(
      await screen.findByText('2 anstehende Prüfungen')
    ).toBeInTheDocument();
    first.unmount();

    listOf(0);
    renderWithProviders(<ExamManager />);
    expect(
      await screen.findByText('0 anstehende Prüfungen')
    ).toBeInTheDocument();
  });
});

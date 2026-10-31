import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../../helpers/renderWithProviders';
import { ExamManager } from '@/components/school/ExamManager';
import { ExamResultsOverview } from '@/components/school/ExamResultsOverview';
import { SchoolView } from '@/components/school/SchoolView';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/lib/authFetch';

// The school routes of a trainee answer only with the session token (the
// trainee comes from the token). Every component that calls them has to use
// authFetch, a plain fetch would get 401 and the school page would stay empty.
// ActivityReportsList and BlockCalendar are covered by phase-labels.test.tsx,
// authFetchCallers.test.ts checks every call site in the source.

jest.mock('@/contexts/AuthContext');
jest.mock('@/lib/authFetch');
// The tabs of SchoolView are not under test here
jest.mock('@/components/school/BlockCalendar', () => ({
  BlockCalendar: () => null,
}));
jest.mock('@/components/school/ActivityReportsList', () => ({
  ActivityReportsList: () => null,
}));
jest.mock('@/components/school/LernfeldNotes', () => ({
  LernfeldNotes: () => null,
}));
jest.mock('@/components/school/LernfelderTab', () => ({
  LernfelderTab: () => null,
}));

const authFetchMock = authFetch as jest.MockedFunction<typeof authFetch>;
const plainFetch = jest.fn();

function json(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response;
}

const urlsOfAuthFetch = () =>
  authFetchMock.mock.calls.map(call => String(call[0]));

describe('school components call the school routes with authFetch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    (global as any).fetch = plainFetch;
    plainFetch.mockRejectedValue(new Error('plain fetch must not be used'));
    (useAuth as jest.Mock).mockReturnValue({
      profile: { id: 'trainee-1', role: 'trainee' },
      loading: false,
    });
    authFetchMock.mockImplementation(async () =>
      json({ exams: [], reports: [], blocks: [], meta: {} })
    );
  });

  it('ExamManager loads the exams with authFetch', async () => {
    renderWithProviders(<ExamManager />);
    await waitFor(() =>
      expect(urlsOfAuthFetch()).toContain(
        '/api/trainee/school/exams?traineeId=trainee-1&upcoming=true'
      )
    );
    expect(plainFetch).not.toHaveBeenCalled();
  });

  it('ExamResultsOverview loads the exams with authFetch', async () => {
    renderWithProviders(<ExamResultsOverview />);
    await waitFor(() =>
      expect(urlsOfAuthFetch()).toContain(
        '/api/trainee/school/exams?traineeId=trainee-1'
      )
    );
    expect(plainFetch).not.toHaveBeenCalled();
  });

  it('SchoolView loads the overview (exams, reports, blocks) with authFetch', async () => {
    renderWithProviders(<SchoolView />);
    await waitFor(() => expect(urlsOfAuthFetch()).toHaveLength(3));
    const urls = urlsOfAuthFetch();
    expect(urls.some(u => u.startsWith('/api/trainee/school/exams?'))).toBe(
      true
    );
    expect(urls.some(u => u.startsWith('/api/trainee/school/reports?'))).toBe(
      true
    );
    expect(urls.some(u => u.startsWith('/api/trainee/school/blocks?'))).toBe(
      true
    );
    expect(plainFetch).not.toHaveBeenCalled();
    // The page rendered (no crash for the empty answers)
    expect(screen.getAllByRole('button').length).toBeGreaterThan(0);
  });
});

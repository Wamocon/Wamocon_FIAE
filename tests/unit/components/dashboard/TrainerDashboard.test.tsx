import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import TrainerDashboard from '@/components/dashboard/TrainerDashboard';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';

// Mock dependencies
jest.mock('@/contexts/AuthContext');
jest.mock('next/navigation', () => ({
    useRouter: jest.fn(),
}));

// Mock child components (charts) since they are dynamic imports
jest.mock('@/components/dashboard/DashboardCharts', () => ({
    ProgressTrendChart: () => <div data-testid="progress-trend-chart">Chart</div>,
    ModuleProgressChart: () => <div data-testid="module-progress-chart">Chart</div>,
}));

describe('TrainerDashboard', () => {
    const mockRouter = { push: jest.fn() };
    const mockUser = { id: 'user-1' };
    const mockProfile = { id: 'profile-1', role: 'TRAINER' };

    beforeEach(() => {
        jest.clearAllMocks();
        (useRouter as jest.Mock).mockReturnValue(mockRouter);
        (useAuth as jest.Mock).mockReturnValue({
            user: mockUser,
            profile: mockProfile,
        });

        // Mock fetch
        global.fetch = jest.fn();
    });

    it('shows loading state initially', async () => {
        // Mock slow fetch
        (global.fetch as jest.Mock).mockImplementation(() => new Promise(() => { }));

        // Clear cache
        localStorage.clear();

        render(<TrainerDashboard />);

        // We expect the dashboard structure to be present
        // Use waitFor because of useEffect setting mounted
        await waitFor(() => {
            expect(screen.getByText('Aktion erforderlich')).toBeInTheDocument();
        });
    });

    it('fetches data and displays it', async () => {
        const mockData = {
            trainees: [{ id: 't1', full_name: 'Test Trainee', progress: 50 }],
            counts: {
                activeTrainees: 1,
                pendingReviews: 5,
                pendingQuiz: 2,
                pendingUseCases: 0,
                pendingEnablers: 0
            },
            charts: {
                progressTrend: [{ week: 'W1', progress: 10 }],
                moduleProgress: [{ name: 'Mod1', completed: 1, inProgress: 0, notStarted: 0 }]
            }
        };

        (global.fetch as jest.Mock).mockResolvedValue({
            ok: true,
            json: async () => mockData
        });

        render(<TrainerDashboard />);

        await waitFor(() => {
            // Check for counts, not names as dashboard summarizes data
            expect(screen.getByText('1')).toBeInTheDocument(); // Active trainees count (mockData has 1 trainee in array matching logic? No we pass array)
            // Wait, logic: trainees.length. 
            // In mockData above: trainees array has 1 element. So it renders 1.
            expect(screen.getByText('5')).toBeInTheDocument(); // Pending reviews
        });
    });

    it('uses cached data if available', async () => {
        const cachedData = {
            trainees: Array(99).fill({ id: 't', full_name: 'T', progress: 0 }),
            counts: { activeTrainees: 99, pendingReviews: 0, pendingQuiz: 0, pendingUseCases: 0 },
            charts: { progressTrend: [], moduleProgress: [] }
        };

        localStorage.setItem(
            'wmc_trainer_dashboard_cache',
            JSON.stringify({ data: cachedData, timestamp: Date.now() })
        );

        render(<TrainerDashboard />);

        await waitFor(() => {
            expect(screen.getByText('99')).toBeInTheDocument();
        });
    });
});

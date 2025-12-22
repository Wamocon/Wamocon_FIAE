import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { Profile } from '@/components/profile/Profile';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';

// Mock dependencies
jest.mock('@/contexts/AuthContext');
jest.mock('@/lib/supabase', () => ({
    supabase: {
        auth: {
            updateUser: jest.fn(),
        },
        storage: {
            from: jest.fn(() => ({
                upload: jest.fn(),
                getPublicUrl: jest.fn(() => ({ data: { publicUrl: 'http://test.com/avatar.png' } })),
            })),
        },
    },
}));

describe('Profile', () => {
    const mockUser = { id: 'u1', email: 'test@example.com' };
    const mockProfile = { id: 'u1', full_name: 'Test Usesr', role: 'TRAINER', email: 'test@example.com', training_start_date: '2023-01-01', avatar_url: null };

    beforeEach(() => {
        jest.clearAllMocks();
        (useAuth as jest.Mock).mockReturnValue({
            user: mockUser,
            profile: mockProfile,
            refreshProfile: jest.fn(),
        });
    });

    it('renders profile information', () => {
        render(<Profile />);
        expect(screen.getAllByText('Test Usesr').length).toBeGreaterThan(0);
        expect(screen.getByTestId('user-email')).toHaveTextContent('test@example.com');
    });

    it('toggles edit mode', async () => {
        render(<Profile />);
        await waitFor(() => {
            const editBtn = screen.getByLabelText('Profil bearbeiten');
            fireEvent.click(editBtn);
        });
        await waitFor(() => {
            expect(screen.getByText('Speichern')).toBeInTheDocument();
        });
    });

    // Add more tests for interactions
});

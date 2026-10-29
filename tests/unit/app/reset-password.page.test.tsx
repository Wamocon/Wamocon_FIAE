import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../../helpers/renderWithProviders';
import ResetPasswordPage from '@/app/reset-password/page';

// The page behind the link of the password reset e-mail: the new password
// follows the same rule as everywhere else (at least 8 characters).

const mockUpdateUser = jest.fn();
jest.mock('@supabase/auth-helpers-nextjs', () => ({
  createClientComponentClient: () => ({
    auth: { updateUser: (...args: unknown[]) => mockUpdateUser(...args) },
  }),
}));
const mockRouter = { push: jest.fn(), replace: jest.fn() };
jest.mock('next/navigation', () => ({ useRouter: () => mockRouter }));
jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { error: jest.fn(), success: jest.fn() },
}));
jest.mock('@/components/ui/ThemeToggle', () => ({ ThemeToggle: () => null }));
jest.mock('@/components/ui/LanguageToggle', () => ({
  LanguageToggle: () => null,
}));

function fill(password: string, confirm: string) {
  fireEvent.change(screen.getByLabelText('Neues Passwort'), {
    target: { value: password },
  });
  fireEvent.change(screen.getByLabelText('Passwort bestätigen'), {
    target: { value: confirm },
  });
}

const button = () => screen.getByRole('button', { name: 'Passwort ändern' });

describe('ResetPasswordPage', () => {
  beforeAll(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = false;
  });
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdateUser.mockResolvedValue({ error: null });
    // the page only works on its own path
    window.history.pushState({}, '', '/reset-password');
  });

  it.each(['1234567', 'sechs6', 'a'])(
    'a password of %j is too short: the button stays disabled and nothing is sent',
    password => {
      renderWithProviders(<ResetPasswordPage />);
      fill(password, password);
      expect(button()).toBeDisabled();
      fireEvent.submit(button().closest('form') as HTMLFormElement);
      expect(mockUpdateUser).not.toHaveBeenCalled();
    }
  );

  it('the submit of a short password says why (8 characters)', async () => {
    renderWithProviders(<ResetPasswordPage />);
    fill('1234567', '1234567');
    fireEvent.submit(button().closest('form') as HTMLFormElement);
    expect(
      await screen.findByText('Passwort muss mindestens 8 Zeichen lang sein.')
    ).toBeTruthy();
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('8 characters that match are accepted, nothing else is demanded', async () => {
    renderWithProviders(<ResetPasswordPage />);
    fill('aaaaaaaa', 'aaaaaaaa');
    expect(button()).toBeEnabled();
    fireEvent.click(button());
    await waitFor(() =>
      expect(mockUpdateUser).toHaveBeenCalledWith({ password: 'aaaaaaaa' })
    );
  });

  it('a password that does not match the confirmation is not sent', () => {
    renderWithProviders(<ResetPasswordPage />);
    fill('aaaaaaaa', 'aaaaaaab');
    expect(button()).toBeDisabled();
  });
});

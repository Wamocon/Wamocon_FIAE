import { render, screen } from '@testing-library/react';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { AccessGate } from '@/components/admin/content-upload/AccessGate';

const replace = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { error: jest.fn(), success: jest.fn() },
}));
const auth = { loading: false };
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth }));
let allowed = true;
jest.mock('@/lib/hooks/useIsSuperAdmin', () => ({
  useIsSuperAdmin: () => allowed,
}));

import toast from 'react-hot-toast';

const renderGate = () =>
  render(
    <LanguageProvider>
      <AccessGate>
        <p>Inhalt</p>
      </AccessGate>
    </LanguageProvider>
  );

beforeEach(() => {
  replace.mockClear();
  (toast.error as jest.Mock).mockClear();
  auth.loading = false;
  allowed = true;
});

describe('AccessGate', () => {
  it('shows the page to a person who may write curriculum content', () => {
    renderGate();
    expect(screen.getByText('Inhalt')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('shows nothing of the page while the session is loading and does not send anybody away yet', () => {
    auth.loading = true;
    allowed = false;
    renderGate();
    expect(screen.queryByText('Inhalt')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('sends everybody else back to the dashboard with a note, and shows nothing of the page', () => {
    allowed = false;
    renderGate();
    expect(screen.queryByText('Inhalt')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'nur Administratoren der Plattform'
    );
    expect(replace).toHaveBeenCalledWith('/trainer/dashboard');
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining('Administratoren der Plattform')
    );
  });
});

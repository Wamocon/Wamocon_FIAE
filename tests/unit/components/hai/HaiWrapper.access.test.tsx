import { render, screen } from '@testing-library/react';
import { HaiWrapper } from '@/components/hai/HaiWrapper';
import { useAuth } from '@/contexts/AuthContext';

// The HAI button and chat are not offered to an account that is stopped (not
// released yet, deactivated): the notice page is all that person sees, and the
// server answers 403 to every request of such an account anyway. Module under
// test: src/components/hai/HaiWrapper.tsx (no older test).

jest.mock('@/contexts/AuthContext');
jest.mock('next/dynamic', () => ({
  __esModule: true,
  default: () => {
    const Stub = () => <div data-testid="hai-widget" />;
    return Stub;
  },
}));
jest.mock('@/components/hai/HaiProvider', () => ({
  HaiProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="hai-provider">{children}</div>
  ),
}));

function auth(profile: Record<string, unknown> | null, plan = 'PRO') {
  (useAuth as jest.Mock).mockReturnValue({
    user: { id: 'u1' },
    profile,
    subscriptionPlan: plan,
  });
}

describe('HaiWrapper for accounts that are stopped', () => {
  beforeEach(() => jest.clearAllMocks());

  it('offers HAI to a released account of a PRO organization (as before)', () => {
    auth({ id: 'u1', role: 'trainee', trainerActivated: true });
    render(
      <HaiWrapper>
        <div data-testid="page" />
      </HaiWrapper>
    );
    expect(screen.getByTestId('page')).toBeInTheDocument();
    expect(screen.getByTestId('hai-provider')).toBeInTheDocument();
  });

  it.each([
    ['not released', { trainerActivated: false }],
    ['deactivated', { isActive: false }],
    ['organization deactivated', { organization: { isActive: false } }],
  ])('offers no HAI to an account that is %s', (_label, extra) => {
    auth({ id: 'u1', role: 'trainee', ...extra });
    render(
      <HaiWrapper>
        <div data-testid="page" />
      </HaiWrapper>
    );
    expect(screen.getByTestId('page')).toBeInTheDocument();
    expect(screen.queryByTestId('hai-provider')).toBeNull();
    expect(screen.queryByTestId('hai-widget')).toBeNull();
  });
});

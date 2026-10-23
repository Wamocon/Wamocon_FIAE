import { renderHook } from '@testing-library/react';
import { useAuth } from '@/contexts/AuthContext';
import { useIsSuperAdmin } from '@/lib/hooks/useIsSuperAdmin';

jest.mock('@/contexts/AuthContext');

function asUser(role: string | null, isPlatformOwner = false) {
  (useAuth as jest.Mock).mockReturnValue({
    profile: role ? { id: 'u1', role } : null,
    isPlatformOwner,
  });
}

describe('useIsSuperAdmin', () => {
  beforeEach(() => jest.clearAllMocks());

  it('is true for a SUPER_ADMIN (the profile holds the role in lower case)', () => {
    asUser('super_admin');
    expect(renderHook(() => useIsSuperAdmin()).result.current).toBe(true);
  });

  it('is true for an ADMIN of the platform-owner organization', () => {
    asUser('admin', true);
    expect(renderHook(() => useIsSuperAdmin()).result.current).toBe(true);
  });

  it('is false for an ADMIN of a customer organization', () => {
    asUser('admin', false);
    expect(renderHook(() => useIsSuperAdmin()).result.current).toBe(false);
  });

  it.each(['temp_admin', 'trainer', 'trainee'])(
    'is false for %s, also in the platform-owner organization',
    role => {
      asUser(role, true);
      expect(renderHook(() => useIsSuperAdmin()).result.current).toBe(false);
    }
  );

  it('is false without a profile', () => {
    asUser(null, false);
    expect(renderHook(() => useIsSuperAdmin()).result.current).toBe(false);
  });

  it('follows a change of the user', () => {
    asUser('trainer');
    const { result, rerender } = renderHook(() => useIsSuperAdmin());
    expect(result.current).toBe(false);
    asUser('super_admin');
    rerender();
    expect(result.current).toBe(true);
  });
});

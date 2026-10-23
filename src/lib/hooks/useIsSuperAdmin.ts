'use client';

import { useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { isSuperAdmin } from '@/lib/auth/roles';

/**
 * Whether the signed-in user is the platform admin: SUPER_ADMIN, or an ADMIN of
 * the platform-owner organization (the rule lives in isSuperAdmin).
 *
 * This only decides what the UI shows. The API checks the role itself on every
 * call, so hiding a control here is never the protection.
 */
export function useIsSuperAdmin(): boolean {
  const { profile, isPlatformOwner } = useAuth();
  const role = profile?.role;
  return useMemo(
    () => isSuperAdmin({ role, isPlatformOwner }),
    [role, isPlatformOwner]
  );
}

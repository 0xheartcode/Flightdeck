import { useMemo } from 'react';
import { ApiError } from '@/api';
import { useMe } from '@/hooks/useMe';
import { permissionsFrom, type Permissions } from '@/lib/permissions';

/**
 * The permission helper every screen uses. Wraps GET /api/me and derives the
 * view/act/reveal gates, treating a 401 as "identity on, not signed in".
 */
export function usePermissions(): Permissions & { loading: boolean } {
  const { data: me, error, isLoading } = useMe();
  const unauthorized = error instanceof ApiError && error.status === 401;
  return useMemo(
    () => ({ ...permissionsFrom(me, unauthorized), loading: isLoading }),
    [me, unauthorized, isLoading],
  );
}

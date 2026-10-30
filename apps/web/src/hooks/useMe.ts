import { useQuery } from '@tanstack/react-query';
import { fetchMe } from '@/api';

/**
 * Fetch the caller's identity and permissions. A 401 (no or invalid token) is
 * surfaced as the query's error state rather than thrown, so the UI can prompt
 * for a token instead of tripping the error boundary.
 */
export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: fetchMe,
    retry: false,
  });
}

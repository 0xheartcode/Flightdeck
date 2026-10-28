import { useQuery } from '@tanstack/react-query';
import { fetchServices } from '@/api';

/** Poll the service registry. Live logs come over WebSocket separately. */
export function useServices() {
  return useQuery({
    queryKey: ['services'],
    queryFn: fetchServices,
    refetchInterval: 5000,
  });
}

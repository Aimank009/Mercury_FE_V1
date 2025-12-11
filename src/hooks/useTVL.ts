import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabaseClient';
import { useEffect } from 'react';

export function useTVL() {
  const queryClient = useQueryClient();

  // Use RPC function to get SUM directly from database (efficient)
  const query = useQuery({
    queryKey: ['tvl'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_total_tvl');

      if (error) {
        console.error('Error fetching TVL:', error);
        throw error;
      }

      return data || 0;
    },
    staleTime: 60_000, // 1 minute - TVL doesn't change that frequently
    gcTime: 10 * 60 * 1000, // 10 minutes
    refetchInterval: 60_000, // Refetch every minute instead of 30s
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });

  // Realtime subscription with debounced refetch
  useEffect(() => {
    let debounceTimer: NodeJS.Timeout | null = null;
    
    const channel = supabase
      .channel('tvl-realtime-changes')
      .on(
        'postgres_changes' as any,
        {
          event: 'INSERT',
          schema: 'public',
          table: 'bet_placed_with_session'
        },
        () => {
          // Debounce: wait 2 seconds after last event before refetching
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            queryClient.refetchQueries({ queryKey: ['tvl'] });
          }, 2000);
        }
      )
      .subscribe();

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  return query;
}
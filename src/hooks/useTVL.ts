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
    staleTime: 5000,
    refetchInterval: 30000,
  });

  // Realtime subscription
  useEffect(() => {
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
          queryClient.refetchQueries({ queryKey: ['tvl'] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  return query;
}
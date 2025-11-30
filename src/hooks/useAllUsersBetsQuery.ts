import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';
import { fetchAllUsersBets } from '../lib/allUsersBets';
import { UserBet } from '../hooks/useRealtimeBets';

interface UseAllUsersBetsQueryOptions {
  currentTime: number;
  priceMin: number;
  priceMax: number;
  timeWindowSeconds?: number;
  enabled?: boolean;
}

export function useAllUsersBetsQuery({
  currentTime,
  priceMin,
  priceMax,
  timeWindowSeconds = 300,
  enabled = true,
}: UseAllUsersBetsQueryOptions) {
  const queryClient = useQueryClient();
  const subscriptionRef = useRef<any>(null);

  // Query key based on filters
  const queryKey = ['allUsersBets', currentTime, priceMin, priceMax, timeWindowSeconds];

  // Main query with very short stale time for instant updates
  const {
    data: bets = [],
    isLoading,
    error,
    refetch,
  } = useQuery<UserBet[]>({
    queryKey,
    queryFn: () => fetchAllUsersBets(currentTime, priceMin, priceMax, timeWindowSeconds),
    enabled,
    staleTime: 0, // Always consider data stale to allow refetch
    gcTime: 5 * 60 * 1000, // Keep in cache for 5 minutes
    refetchOnWindowFocus: false,
    refetchOnMount: true,
  });

  // Set up Supabase Realtime subscription for instant updates
  useEffect(() => {
    if (!enabled) return;

    const channelName = `all-users-bets-${Math.random().toString(36).substring(7)}`;
    
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes' as any,
        {
          event: 'INSERT',
          schema: 'public',
          table: 'bet_placed_with_session',
        },
        async (payload: any) => {
          const newBet = payload.new;
          
          // Transform to UserBet format
          const priceMinDollars = parseFloat(newBet.price_min) / 1e8;
          const priceMaxDollars = parseFloat(newBet.price_max) / 1e8;
          const priceLevel = (priceMinDollars + priceMaxDollars) / 2;
          const gridId = `${newBet.timeperiod_id}_${priceMinDollars.toFixed(2)}_${priceMaxDollars.toFixed(2)}`;
          
          const amount = parseFloat(newBet.amount) / 1e6;
          const shares = parseFloat(newBet.shares_received) / 1e6;
          const multiplier = shares > 0 ? (amount / shares) : 0;

          const bet: UserBet = {
            grid_id: gridId,
            user_address: newBet.user_address,
            timeperiod_id: parseInt(newBet.timeperiod_id),
            price_level: priceLevel,
            amount,
            shares,
            multiplier,
            created_at: newBet.created_at,
            session_id: newBet.session_key,
          };

          // ⚡ OPTIMISTIC UPDATE: Add bet to cache immediately
          queryClient.setQueryData<UserBet[]>(queryKey, (oldBets = []) => {
            // Check if bet already exists
            const exists = oldBets.some(
              b => b.grid_id === bet.grid_id && b.user_address === bet.user_address
            );
            
            if (exists) {
              return oldBets;
            }
            
            console.log('⚡ Optimistic update: Adding bet immediately', bet);
            return [...oldBets, bet];
          });

          // Refetch in background to ensure data consistency (non-blocking)
          setTimeout(() => {
            refetch();
          }, 100);
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          // console.log('✅ Supabase Realtime subscription active for all users bets');
        }
      });

    subscriptionRef.current = channel;

    return () => {
      if (subscriptionRef.current) {
        supabase.removeChannel(subscriptionRef.current);
      }
    };
  }, [enabled, queryKey, queryClient, refetch]);

  return {
    bets,
    isLoading,
    error,
    refetch,
  };
}


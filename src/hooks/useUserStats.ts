import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabaseClient';
import { useAccount } from 'wagmi';

export interface UserStats {
  totalBets: number;
  totalWagered: number;
  totalWon: number;
  netProfit: number;
  winRate: number;
}

export function useUserStats() {
  const { address, isConnected } = useAccount();
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['userStats', address?.toLowerCase()],
    queryFn: async (): Promise<UserStats> => {
      if (!address) throw new Error('No address connected');

      const { data, error } = await supabase
        .from('bet_placed_with_session')
        .select('amount, multiplier, status')
        .ilike('user_address', address.toLowerCase());

      if (error) throw error;

      let totalBets = 0;
      let totalWagered = 0;
      let totalWon = 0;
      let wins = 0;
      let losses = 0;

      data?.forEach(bet => {
        const amount = parseFloat(bet.amount || '0') / 1e6;
        const multiplier = bet.multiplier || 0;
        const status = bet.status?.toLowerCase();

        totalBets++;
        totalWagered += amount;

        if (status === 'won') {
          wins++;
          // If multiplier is 0 for a won bet, fallback to 1 (refund) or similar logic? 
          // Based on previous code: (dbMultiplier > 0 ? dbMultiplier : 1)
          const effectiveMultiplier = multiplier > 0 ? multiplier : 1;
          totalWon += amount * effectiveMultiplier;
        } else if (status === 'lost') {
          losses++;
        }
      });

      const resolvedBets = wins + losses;
      const winRate = resolvedBets > 0 ? (wins / resolvedBets) * 100 : 0;
      const netProfit = totalWon - totalWagered;

      return {
        totalBets,
        totalWagered,
        totalWon,
        netProfit,
        winRate
      };
    },
    enabled: !!address,
    staleTime: 30000, // Cache for 30 seconds
    refetchInterval: 60_000, // Refetch every minute as fallback
  });

  // Supabase Realtime subscription for real-time stats updates
  useEffect(() => {
    if (!address || !isConnected) return;

    console.log('📡 Setting up realtime subscription for user stats');

    const channel = supabase
      .channel(`user_stats_${address}`)
      .on(
        'postgres_changes',
        {
          event: '*', // Listen to INSERT, UPDATE, DELETE
          schema: 'public',
          table: 'bet_placed_with_session',
          filter: `user_address=ilike.${address}`,
        },
        (payload) => {
          console.log('📡 Realtime stats update received:', payload);
          // Refetch to get updated stats
          refetch();
        }
      )
      .subscribe((status) => {
        console.log('📡 User stats subscription status:', status);
      });

    return () => {
      console.log('📡 Cleaning up user stats subscription');
      supabase.removeChannel(channel);
    };
  }, [address, isConnected, refetch, queryClient]);

  return { data, isLoading, error, refetch };
}

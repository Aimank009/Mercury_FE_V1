import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAccount } from 'wagmi';
import { supabase } from '../lib/supabaseClient';

export interface Transaction {
  id: number;
  type: 'deposit' | 'withdrawal';
  amount: number;
  newBalance: number;
  timestamp: Date;
  eventId: string;
}

/**
 * Fetch deposits and withdrawals for a user
 * Uses case-sensitive address matching
 * Includes real-time updates via Supabase Realtime
 */
export function useDepositsWithdrawals() {
  const { address, isConnected } = useAccount();
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['depositsWithdrawals', address],
    queryFn: async (): Promise<Transaction[]> => {
      if (!address) return [];

      console.log('📊 Fetching deposits and withdrawals for:', address);

      // Fetch deposits (case-sensitive)
      const { data: deposits, error: depositsError } = await supabase
        .from('deposited')
        .select('id, event_id, amount, new_balance, timestamp, created_at')
        .eq('user_address', address) // Case-sensitive match
        .order('timestamp', { ascending: false })
        .limit(1000);

      if (depositsError) {
        console.error('❌ Error fetching deposits:', depositsError);
      }

      // Fetch withdrawals (case-sensitive)
      const { data: withdrawals, error: withdrawalsError } = await supabase
        .from('withdrawn')
        .select('id, event_id, amount, new_balance, timestamp, created_at')
        .eq('user_address', address) // Case-sensitive match
        .order('timestamp', { ascending: false })
        .limit(1000);

      if (withdrawalsError) {
        console.error('❌ Error fetching withdrawals:', withdrawalsError);
      }

      // Process and combine transactions
      const transactions: Transaction[] = [];

      // Process deposits
      (deposits || []).forEach((d) => {
        const timestamp = d.timestamp 
          ? new Date(d.timestamp) 
          : d.created_at 
          ? new Date(d.created_at) 
          : new Date();
        
        transactions.push({
          id: d.id,
          type: 'deposit',
          amount: parseFloat(d.amount || '0') / 1e6, // Convert from USDC precision
          newBalance: parseFloat(d.new_balance || '0') / 1e6,
          timestamp,
          eventId: d.event_id,
        });
      });

      // Process withdrawals
      (withdrawals || []).forEach((w) => {
        const timestamp = w.timestamp 
          ? new Date(w.timestamp) 
          : w.created_at 
          ? new Date(w.created_at) 
          : new Date();
        
        transactions.push({
          id: w.id,
          type: 'withdrawal',
          amount: parseFloat(w.amount || '0') / 1e6, // Convert from USDC precision
          newBalance: parseFloat(w.new_balance || '0') / 1e6,
          timestamp,
          eventId: w.event_id,
        });
      });

      // Sort by timestamp (most recent first)
      transactions.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

      console.log(`✅ Fetched ${transactions.length} transactions (${deposits?.length || 0} deposits, ${withdrawals?.length || 0} withdrawals)`);

      return transactions;
    },
    enabled: !!address && isConnected,
    staleTime: 30_000, // 30 seconds
    refetchInterval: 60_000, // Refetch every minute as fallback
  });

  // Supabase Realtime subscription for real-time updates
  useEffect(() => {
    if (!address || !isConnected) return;

    console.log('📡 Setting up realtime subscription for deposits/withdrawals');

    // Listen to deposits
    const depositsChannel = supabase
      .channel(`deposits_${address}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'deposited',
          filter: `user_address=eq.${address}`,
        },
        (payload) => {
          console.log('📡 Realtime deposit received:', payload);
          refetch();
        }
      )
      .subscribe((status) => {
        console.log('📡 Deposits subscription status:', status);
      });

    // Listen to withdrawals
    const withdrawalsChannel = supabase
      .channel(`withdrawals_${address}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'withdrawn',
          filter: `user_address=eq.${address}`,
        },
        (payload) => {
          console.log('📡 Realtime withdrawal received:', payload);
          refetch();
        }
      )
      .subscribe((status) => {
        console.log('📡 Withdrawals subscription status:', status);
      });

    return () => {
      console.log('📡 Cleaning up deposits/withdrawals subscriptions');
      supabase.removeChannel(depositsChannel);
      supabase.removeChannel(withdrawalsChannel);
    };
  }, [address, isConnected, refetch, queryClient]);

  return { 
    transactions: data || [], 
    isLoading, 
    error, 
    refetch 
  };
}


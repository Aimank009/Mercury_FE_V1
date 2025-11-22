import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabaseClient';

interface BalanceData {
  balance: number;
  balanceUSD: number;
}

// Fetch wrapper balance from Supabase
async function fetchWrapperBalance(userAddress: string): Promise<BalanceData> {
  if (!userAddress) {
    return { balance: 0, balanceUSD: 0 };
  }

  const normalizedAddress = userAddress.toLowerCase();
  console.log('💰 [useWrapperBalance] Fetching balance for address:', normalizedAddress);

  // Add timeout detection
  const queryPromise = supabase
    .from('final_balance')
    .select('new_balance, timestamp')
    .ilike('user_address', normalizedAddress)
    .order('timestamp', { ascending: false })
    .limit(1);

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Balance query timeout after 5 seconds')), 5000)
  );

  const queryResult = await Promise.race([queryPromise, timeoutPromise]) as any;
  const { data, error: supabaseError } = queryResult;

  if (supabaseError) {
    console.error('❌ Supabase error:', supabaseError);
    return { balance: 0, balanceUSD: 0 };
  }

  if (!data || data.length === 0) {
    console.log('💰 No balance record found for address:', normalizedAddress);
    return { balance: 0, balanceUSD: 0 };
  }

  const latestRecord = data[0];
  const balanceRaw = BigInt(latestRecord.new_balance);
  const balanceUSDValue = Number(balanceRaw) / 1e6;

  console.log('💰 ✅ BALANCE LOADED:', {
    raw: latestRecord.new_balance,
    usd: balanceUSDValue,
    timestamp: latestRecord.timestamp
  });

  return {
    balance: Number(balanceRaw),
    balanceUSD: balanceUSDValue,
  };
}

/**
 * Hook to fetch user balance from Supabase final_balance table
 * Uses TanStack Query for caching and automatic refetching
 * Uses DIRECT Supabase real-time for instant updates
 */
export function useWrapperBalance(userAddress: string | undefined) {
  const queryClient = useQueryClient();

  const {
    data = { balance: 0, balanceUSD: 0 },
    isLoading,
    error,
    refetch,
  } = useQuery<BalanceData>({
    queryKey: ['wrapperBalance', userAddress?.toLowerCase()],
    queryFn: () => fetchWrapperBalance(userAddress!),
    enabled: !!userAddress,
    staleTime: 30_000, // Consider data fresh for 30 seconds
    gcTime: 5 * 60 * 1000, // Keep in cache for 5 minutes
    retry: 1,
    retryDelay: 1000,
  });

  // Set up real-time subscription
  useEffect(() => {
    if (!userAddress || !supabase) return;

    const normalizedAddress = userAddress.toLowerCase();
    console.log('💰 Setting up DIRECT Supabase real-time for balance...');

    const balanceChannel = supabase
      .channel('final_balance_changes')
      .on('postgres_changes' as any, {
        event: '*',
        schema: 'public',
        table: 'final_balance',
      }, (payload) => {
        console.log('💰 ⚡ DIRECT Supabase real-time event:', payload);
        
        // Check if this update is for the current user
        if (payload.new && (payload.new as any).user_address?.toLowerCase() === normalizedAddress) {
          console.log('💰 ⚡⚡ INSTANT BALANCE UPDATE for user!', payload.new);
          const newBalance = BigInt((payload.new as any).new_balance);
          const balanceUSDValue = Number(newBalance) / 1e6;
          
          // Update TanStack Query cache immediately
          queryClient.setQueryData<BalanceData>(
            ['wrapperBalance', normalizedAddress],
            {
              balance: Number(newBalance),
              balanceUSD: balanceUSDValue,
            }
          );
        }
      })
      .subscribe((status) => {
        console.log('💰 Supabase real-time subscription status:', status);
      });

    return () => {
      console.log('💰 Cleaning up Supabase real-time subscription');
      supabase.removeChannel(balanceChannel);
    };
  }, [userAddress, queryClient]);

  return {
    balance: data.balance,
    balanceUSD: data.balanceUSD,
    isLoading,
    error: error ? (error as Error).message : null,
    refetch,
  };
}

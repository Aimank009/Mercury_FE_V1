import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabaseClient';

interface BalanceData {
  balance: number;
  balanceUSD: number;
}

// Fetch wrapper balance from Supabase final_balance table
async function fetchWrapperBalance(userAddress: string): Promise<BalanceData> {
  if (!userAddress) {
    return { balance: 0, balanceUSD: 0 };
  }

  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) console.log('Fetching balance for address:', userAddress);

  try {
    // First try exact match with original address (mixed case as stored in DB)
    let { data, error } = await supabase
      .from('final_balance')
      .select('*')
      .eq('user_address', userAddress)
      .order('timestamp', { ascending: false })
      .limit(1);

    if (isDev) console.log('💰 [useWrapperBalance] Exact match result:', { data, error });

    // If no results, try with lowercase
    if ((!data || data.length === 0) && !error) {
      const result = await supabase
        .from('final_balance')
        .select('*')
        .ilike('user_address', userAddress.toLowerCase())
        .order('timestamp', { ascending: false })
        .limit(1);
      
      data = result.data;
      error = result.error;
      if (isDev) console.log('💰 [useWrapperBalance] ilike lowercase result:', { data, error });
    }

    // If still no results, try pattern match
    if ((!data || data.length === 0) && !error) {
      // Get the last 8 characters of the address for partial match
      const addressSuffix = userAddress.slice(-8);
      const result = await supabase
        .from('final_balance')
        .select('*')
        .ilike('user_address', `%${addressSuffix}`)
        .order('timestamp', { ascending: false })
        .limit(10);
      
      if (result.data && result.data.length > 0) {
        // Filter to find exact match (case-insensitive)
        const match = result.data.find(r => 
          r.user_address.toLowerCase() === userAddress.toLowerCase()
        );
        if (match) {
          data = [match];
          if (isDev) console.log('💰 [useWrapperBalance] Found via suffix match:', match);
        }
      }
    }

    if (error) {
      console.error('❌ Supabase error:', error);
      return { balance: 0, balanceUSD: 0 };
    }

    if (!data || data.length === 0) {
      if (isDev) console.log('💰 No balance record found for:', userAddress);
      return { balance: 0, balanceUSD: 0 };
    }

    const latestRecord = data[0];
    if (isDev) console.log('💰 Latest record:', latestRecord);
    
    const balanceValue = latestRecord.new_balance || latestRecord.balance || '0';
    const balanceRaw = BigInt(balanceValue);
    const balanceUSDValue = Number(balanceRaw) / 1e6;

    if (isDev) console.log('💰 ✅ BALANCE LOADED:', {
      raw: balanceValue,
      usd: balanceUSDValue
    });

    return {
      balance: Number(balanceRaw),
      balanceUSD: balanceUSDValue,
    };
  } catch (err) {
    console.error('❌ Exception fetching balance:', err);
    return { balance: 0, balanceUSD: 0 };
  }
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
    staleTime: Infinity,
    gcTime: 5 * 60 * 1000,
    retry: 1,
    retryDelay: 1000,
  });

  // Set up real-time subscription for final_balance table
  useEffect(() => {
    if (!userAddress || !supabase) return;

    const normalizedAddress = userAddress.toLowerCase();
    const isDev = process.env.NODE_ENV === 'development';
    if (isDev) console.log('Setting up Supabase real-time for final_balance...');

    const balanceChannel = supabase
      .channel('final_balance_changes')
      .on('postgres_changes' as any, {
        event: '*',
        schema: 'public',
        table: 'final_balance',
      }, (payload) => {
        if (isDev) console.log('💰 ⚡ Balance change event:', payload);
        
        if (payload.new && (payload.new as any).user_address?.toLowerCase() === normalizedAddress) {
          if (isDev) console.log('💰 ⚡⚡ INSTANT BALANCE UPDATE!', payload.new);
          const balanceValue = (payload.new as any).new_balance || (payload.new as any).balance || '0';
          const newBalance = BigInt(balanceValue);
          const balanceUSDValue = Number(newBalance) / 1e6;
          
          queryClient.setQueryData<BalanceData>(
            ['wrapperBalance', normalizedAddress],
            {
              balance: Number(newBalance),
              balanceUSD: balanceUSDValue,
            }
          );
        }
      })
      .subscribe();

    return () => {
      if (isDev) console.log('💰 Cleaning up Supabase real-time subscription');
      supabase.removeChannel(balanceChannel);
    };
  }, [userAddress, queryClient]);

  return {
    balance: data?.balance ?? 0,
    balanceUSD: data?.balanceUSD ?? 0,
    isLoading,
    error: error ? (error as Error).message : null,
    refetch,
  };
}

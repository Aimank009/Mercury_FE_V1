import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabaseClient';

// Fetch global liquidity from Supabase
async function fetchGlobalLiquidity(): Promise<string> {
  console.log('💧 Fetching initial global liquidity...');
  
  const { data, error: supabaseError } = await supabase
    .from('global_liquidity_updated')
    .select('new_total, timestamp')
    .order('timestamp', { ascending: false })
    .limit(1);

  if (supabaseError) {
    console.error('❌ Supabase error:', supabaseError);
    return '0';
  }

  if (!data || data.length === 0) {
    console.log('💧 No liquidity record found, defaulting to 0');
    return '0';
  }

  const latestRecord = data[0];
  const liquidityRaw = BigInt(latestRecord.new_total);
  const liquidityUSD = Number(liquidityRaw) / 1e6;

  console.log('💧 ✅ GLOBAL LIQUIDITY LOADED:', {
    raw: latestRecord.new_total,
    usd: liquidityUSD,
    timestamp: latestRecord.timestamp
  });

  return liquidityUSD.toString();
}

/**
 * Hook to fetch global liquidity from Supabase
 * Uses TanStack Query for caching and automatic refetching
 * Uses DIRECT Supabase real-time for instant updates
 */
export function useGlobalLiquidity() {
  const queryClient = useQueryClient();

  const {
    data: liquidityPool = '0',
    isLoading,
    error,
    refetch,
  } = useQuery<string>({
    queryKey: ['globalLiquidity'],
    queryFn: fetchGlobalLiquidity,
    staleTime: 30_000, // Consider data fresh for 30 seconds
    gcTime: 5 * 60 * 1000, // Keep in cache for 5 minutes
    retry: 1,
    retryDelay: 1000,
  });

  // Set up real-time subscription
  useEffect(() => {
    if (!supabase) return;

    console.log('💧 Setting up DIRECT Supabase real-time for liquidity...');

    const liquidityChannel = supabase
      .channel('global_liquidity_changes')
      .on('postgres_changes' as any, {
        event: '*',
        schema: 'public',
        table: 'global_liquidity_updated',
      }, (payload) => {
        console.log('💧 ⚡ DIRECT Supabase real-time event:', payload);
        
        if (payload.new && (payload.new as any).new_total) {
          const liquidityRaw = BigInt((payload.new as any).new_total);
          const liquidityUSD = Number(liquidityRaw) / 1e6;
          
          console.log('💧 ⚡⚡ INSTANT LIQUIDITY UPDATE!', {
            raw: (payload.new as any).new_total,
            usd: liquidityUSD
          });
          
          // Update TanStack Query cache immediately
          queryClient.setQueryData<string>(['globalLiquidity'], liquidityUSD.toString());
        }
      })
      .subscribe((status) => {
        console.log('💧 Supabase real-time subscription status:', status);
      });

    return () => {
      console.log('💧 Cleaning up Supabase real-time subscription');
      supabase.removeChannel(liquidityChannel);
    };
  }, [queryClient]);

  return {
    liquidityPool,
    isLoading,
    error: error ? (error as Error).message : null,
    refetch,
  };
}

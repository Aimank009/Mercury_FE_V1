import { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabaseClient';

const PNL_CACHE_KEY = 'mercury_pnl_cache';

// Get cached PnL from localStorage
function getCachedPnL(address: string): number | null {
  try {
    const cached = localStorage.getItem(`${PNL_CACHE_KEY}_${address}`);
    if (cached) {
      const { pnl, timestamp } = JSON.parse(cached);
      // Cache valid for 5 minutes
      if (Date.now() - timestamp < 5 * 60 * 1000) {
        return pnl;
      }
    }
  } catch (e) {
    // Ignore cache errors
  }
  return null;
}

// Save PnL to localStorage cache
function cachePnL(address: string, pnl: number) {
  try {
    localStorage.setItem(`${PNL_CACHE_KEY}_${address}`, JSON.stringify({
      pnl,
      timestamp: Date.now()
    }));
  } catch (e) {
    // Ignore cache errors
  }
}

/**
 * Get PnL from updated_pnl table
 * Uses case-sensitive address matching
 * Includes real-time updates via Supabase Realtime
 * Uses localStorage cache for instant loading
 */
export function usePnL() {
  const { address, isConnected } = useAccount();
  const queryClient = useQueryClient();
  
  // Initialize with cached value for instant display
  const cachedValue = address ? getCachedPnL(address) : null;
  const [pnl, setPnL] = useState<number>(cachedValue ?? 0);
  const [isLoading, setIsLoading] = useState(false);

  const { data, isLoading: queryLoading, error, refetch } = useQuery({
    queryKey: ['pnl', address],
    queryFn: async () => {
      if (!address || !isConnected) return 0;

      try {
        // Fetch the latest PnL from updated_pnl table
        const { data: pnlData, error: pnlError } = await supabase
          .from('updated_pnl')
          .select('pnl, created_at')
          .eq('user_address', address) // Case-sensitive match
          .order('created_at', { ascending: false })
          .limit(1);

        if (pnlError) {
          console.error('❌ Error fetching PnL:', pnlError);
          return 0;
        }

        if (!pnlData || pnlData.length === 0) {
          return 0;
        }

        // Get the latest PnL value and convert from USDC precision (6 decimals)
        const latestPnL = (parseFloat(pnlData[0].pnl) || 0) / 1e6;
        // console.log('💰 Latest PnL:', latestPnL);
        
        return latestPnL;
      } catch (error) {
        console.error('❌ Error fetching PnL:', error);
        return 0;
      }
    },
    enabled: !!address && isConnected,
    staleTime: 60_000, // 1 minute
    gcTime: 10 * 60 * 1000, // 10 minutes
    refetchInterval: 2 * 60_000, // Refetch every 2 minutes
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });

  useEffect(() => {
    if (data !== undefined) {
      setPnL(data);
      setIsLoading(queryLoading);
      // Cache the PnL value for instant loading next time
      if (address && data !== 0) {
        cachePnL(address, data);
      }
    }
  }, [data, queryLoading, address]);

  // Supabase Realtime subscription for real-time PnL updates (debounced)
  useEffect(() => {
    if (!address || !isConnected) return;

    let debounceTimer: NodeJS.Timeout | null = null;
    // console.log('📡 Setting up realtime subscription for PnL updates');

    const pnlChannel = supabase
      .channel(`pnl_updates_${address}`)
      .on(
        'postgres_changes',
        {
          event: '*', // Listen to all events (INSERT, UPDATE)
          schema: 'public',
          table: 'updated_pnl',
          filter: `user_address=eq.${address}`,
        },
        (payload) => {
          // console.log('📡 Realtime PnL update received:', payload);
          // Debounce: wait 3 seconds after last event
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            refetch();
          }, 3000);
        }
      )
      .subscribe();

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      // console.log('📡 Cleaning up PnL subscription');
      supabase.removeChannel(pnlChannel);
    };
  }, [address, isConnected, refetch]);

  return { pnl, isLoading: isLoading || queryLoading, error, refetch };
}


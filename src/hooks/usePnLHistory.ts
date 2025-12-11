import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAccount } from 'wagmi';
import { supabase } from '../lib/supabaseClient';

export interface PnLDataPoint {
  timestamp: number;
  pnl: number; // In USD
  cumulativePnL: number; // Cumulative PnL in USD
}

type TimePeriod = '1D' | '3D' | '7D' | '14D' | '30D' | '3M' | '6M' | '1Y';

function getTimePeriodInDays(period: TimePeriod): number {
  switch (period) {
    case '1D': return 1;
    case '3D': return 3;
    case '7D': return 7;
    case '14D': return 14;
    case '30D': return 30;
    case '3M': return 90;
    case '6M': return 180;
    case '1Y': return 365;
    default: return 30;
  }
}

/**
 * Fetch PnL history for a user over a specified time period
 * Includes real-time updates via Supabase Realtime
 */
export function usePnLHistory(timePeriod: TimePeriod = '30D') {
  const { address, isConnected } = useAccount();
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['pnlHistory', address, timePeriod],
    queryFn: async (): Promise<PnLDataPoint[]> => {
      if (!address || !isConnected) return [];

      try {
        const days = getTimePeriodInDays(timePeriod);
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        const startTimestamp = startDate.toISOString();

        console.log(`📊 Fetching PnL history for ${timePeriod} (${days} days)`);
        console.log(`📊 User address: ${address}`);
        console.log(`📊 Start timestamp: ${startTimestamp}`);

        // Fetch PnL updates for this user within the time period
        // Using case-sensitive match for user_address
        const { data: pnlData, error: pnlError } = await supabase
          .from('updated_pnl')
          .select('pnl, timestamp, created_at, block_num')
          .eq('user_address', address) // Case-sensitive exact match
          .gte('timestamp', startTimestamp)
          .order('timestamp', { ascending: true })
          .limit(10000);
        
        // console.log('📊 Query result:', {
        //   hasError: !!pnlError,
        //   errorMessage: pnlError?.message,
        //   dataLength: pnlData?.length || 0,
        //   sampleData: pnlData?.slice(0, 3)
        // });

        if (pnlError) {
          console.error('❌ Error fetching PnL history:', pnlError);
          // Try with created_at if timestamp doesn't work
          const { data: fallbackData, error: fallbackError } = await supabase
            .from('updated_pnl')
            .select('pnl, timestamp, created_at, block_num')
            .eq('user_address', address)
            .gte('created_at', startTimestamp)
            .order('created_at', { ascending: true })
            .limit(10000); // High limit to get all records

          if (fallbackError) {
            console.error('❌ Error with fallback query:', fallbackError);
            return [];
          }

          if (!fallbackData || fallbackData.length === 0) {
            console.log('⚠️ No PnL data found');
            return [];
          }

          // Process fallback data - use individual PnL values, not cumulative
          return fallbackData.map((item, index) => {
            const pnlValue = parseFloat(item.pnl || '0') / 1e6; // Convert from USDC format
            const timestamp = item.created_at 
              ? new Date(item.created_at).getTime() 
              : Date.now() - (fallbackData.length - index) * 60000; // Fallback: space evenly

            return {
              timestamp,
              pnl: pnlValue,
              cumulativePnL: pnlValue, // Store individual PnL value (not cumulative)
            };
          });
        }

        if (!pnlData || pnlData.length === 0) {
          console.log('⚠️ No PnL data found');
          return [];
        }

        // Process PnL data - plot each individual PnL value as-is (no cumulative, no averaging)
        // Each row represents an individual PnL event/value
        const processedData: PnLDataPoint[] = pnlData.map((item) => {
          const pnlValue = parseFloat(item.pnl || '0') / 1e6; // Convert from USDC format (1e6 precision)
          const timestamp = item.timestamp 
            ? new Date(item.timestamp).getTime() 
            : item.created_at 
            ? new Date(item.created_at).getTime()
            : Date.now();

          return {
            timestamp,
            pnl: pnlValue,
            cumulativePnL: pnlValue, // Store individual PnL value for plotting
          };
        });

        console.log(`✅ Fetched ${processedData.length} PnL data points`);
        console.log('📊 Sample PnL data:', {
          first: processedData[0],
          last: processedData[processedData.length - 1],
          allPnLValues: processedData.map(p => p.pnl).slice(0, 20), // Show first 20 individual PnL values
          allTimestamps: processedData.map(p => new Date(p.timestamp).toISOString()).slice(0, 10),
          minPnL: Math.min(...processedData.map(p => p.pnl)),
          maxPnL: Math.max(...processedData.map(p => p.pnl))
        });
        return processedData;
      } catch (error) {
        console.error('❌ Exception fetching PnL history:', error);
        return [];
      }
    },
    enabled: !!address && isConnected,
    staleTime: 30_000, // 30 seconds
    refetchInterval: 60_000, // Refetch every minute
  });

  // Supabase Realtime subscription for real-time PnL updates
  useEffect(() => {
    if (!address || !isConnected) return;

    console.log('📡 Setting up realtime subscription for PnL updates');

    const channel = supabase
      .channel(`pnl_updates_${address}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT', // Only listen to new PnL entries
          schema: 'public',
          table: 'updated_pnl',
          filter: `user_address=eq.${address}`,
        },
        (payload) => {
          console.log('📡 Realtime PnL update received:', payload);
          
          // Refetch to get the complete updated data
          // This ensures proper sorting and filtering
          refetch();
        }
      )
      .subscribe((status) => {
        console.log('📡 PnL subscription status:', status);
      });

    return () => {
      console.log('📡 Cleaning up PnL subscription');
      supabase.removeChannel(channel);
    };
  }, [address, isConnected, refetch, queryClient, timePeriod]);

  return { data: data || [], isLoading, error, refetch };
}


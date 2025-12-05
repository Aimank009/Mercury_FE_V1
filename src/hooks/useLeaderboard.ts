import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';
import { generateAvatarImage } from '../lib/avatarGenerator';

export interface LeaderboardEntry {
  position: number;
  username: string;
  wallet_address: string;
  pnl: string;
  referrals: number;
  points: number;
  avatar?: string;
}

interface UseLeaderboardOptions {
  limit?: number;
  enabled?: boolean;
}

async function fetchLeaderboard(limit: number): Promise<LeaderboardEntry[]> {
  // Fetch users with their PnL data, num_referral, xp, and user_referral code
  const { data: users, error } = await supabase
    .from('users')
    .select('username, wallet_address, avatar_url, num_referral, xp, used_referral, user_referral')
    .limit(limit);

  if (error) {
    console.error('Error fetching leaderboard:', error);
    throw error;
  }

  if (!users || users.length === 0) {
    return [];
  }

  // Fetch PnL data for all users
  const { data: pnlData, error: pnlError } = await supabase
    .from('updated_pnl')
    .select('user_address, pnl, created_at')
    .in('user_address', users.map(u => u.wallet_address))
    .order('created_at', { ascending: false });

  if (pnlError) {
    console.error('Error fetching PnL data:', pnlError);
  }

  // Create a map of user_address -> pnl for quick lookup (only keep the latest/first entry per user)
  const pnlMap = new Map<string, number>();
  if (pnlData) {
    console.log('🔍 Raw PnL data from database:', pnlData);
    pnlData.forEach(item => {
      const userAddressLower = item.user_address.toLowerCase();
      // Only set if not already set (first entry is the latest due to descending order)
      if (!pnlMap.has(userAddressLower)) {
        const rawValue = parseFloat(item.pnl) || 0;
        console.log(`User ${item.user_address}: raw=${item.pnl}, parsed=${rawValue} (latest)`);
        pnlMap.set(userAddressLower, rawValue);
      }
    });
  }

  // Count actual referrals for each user by matching their referral code with used_referral
  const referralCounts = new Map<string, number>();
  for (const user of users) {
    if (user.user_referral) {
      const { count, error: countError } = await supabase
        .from('users')
        .select('*', { count: 'exact', head: true })
        .eq('used_referral', user.user_referral);
      
      if (!countError && count !== null) {
        referralCounts.set(user.wallet_address.toLowerCase(), count);
      }
    }
  }

  // Generate avatars and combine data
  const leaderboardWithData = await Promise.all(
    users.map(async (user) => {
      let avatar = user.avatar_url;
      if (!avatar) {
        const avatarInfo = await generateAvatarImage(user.wallet_address);
        avatar = avatarInfo.dataURL;
      }

      const pnlValue = pnlMap.get(user.wallet_address.toLowerCase()) || 0;
      const pnlInDollars = pnlValue / 1e6; // Divide by 1e6 for 6 decimals (USDC format)
      console.log(`💰 ${user.username}: pnlValue=${pnlValue}, pnlInDollars=${pnlInDollars}`);
      const pnlFormatted = pnlInDollars >= 0 
        ? `+$${pnlInDollars.toFixed(2)}` 
        : `-$${Math.abs(pnlInDollars).toFixed(2)}`;

      // Get actual referral count from the map
      const actualReferralCount = referralCounts.get(user.wallet_address.toLowerCase()) || 0;

      return {
        position: 0, // Will be set after sorting
        username: user.username,
        wallet_address: user.wallet_address,
        pnl: pnlFormatted,
        pnlValue: pnlInDollars, // Keep numeric value for sorting
        referrals: actualReferralCount, // Use actual count instead of num_referral
        points: user.xp || 0,
        avatar: avatar,
      };
    })
  );

  // Sort by PnL (highest to lowest) and assign positions
  leaderboardWithData.sort((a, b) => b.pnlValue - a.pnlValue);
  
  return leaderboardWithData.map((entry, index) => {
    const { pnlValue, ...rest } = entry; // Remove pnlValue from final result
    return {
      ...rest,
      position: index + 1,
    };
  });
}

export function useLeaderboard({
  limit = 50,
  enabled = true,
}: UseLeaderboardOptions = {}) {
  const queryClient = useQueryClient();
  const subscriptionRef = useRef<any>(null);

  const queryKey = ['leaderboard', limit];

  // Main query with TanStack Query
  const {
    data: leaderboard = [],
    isLoading,
    error,
    refetch,
  } = useQuery<LeaderboardEntry[]>({
    queryKey,
    queryFn: () => fetchLeaderboard(limit),
    enabled,
    staleTime: 0, // Always refetch (changed from 10_000)
    gcTime: 5 * 60 * 1000, // Keep in cache for 5 minutes
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  // Set up Supabase Realtime subscription for instant updates
  useEffect(() => {
    if (!enabled) return;

    const channelName = `leaderboard-${Math.random().toString(36).substring(7)}`;

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes' as any,
        {
          event: '*', // Listen to all events (INSERT, UPDATE, DELETE)
          schema: 'public',
          table: 'users',
        },
        async (payload: any) => {
          console.log('📊 Leaderboard users update detected:', payload.eventType);
          // Refetch to ensure consistency
          setTimeout(() => {
            refetch();
          }, 100);
        }
      )
      .on(
        'postgres_changes' as any,
        {
          event: '*', // Listen to PnL updates
          schema: 'public',
          table: 'updated_pnl',
        },
        async (payload: any) => {
          console.log('💰 PnL update detected:', payload.eventType);
          // Refetch to get updated PnL values and re-sort
          setTimeout(() => {
            refetch();
          }, 100);
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('✅ Leaderboard realtime subscription active');
        } else if (status === 'CHANNEL_ERROR') {
          console.error('❌ Leaderboard subscription error');
        }
      });

    subscriptionRef.current = channel;

    return () => {
      if (subscriptionRef.current) {
        console.log('🔌 Unsubscribing from leaderboard realtime');
        supabase.removeChannel(subscriptionRef.current);
      }
    };
  }, [enabled, queryKey, queryClient, refetch, leaderboard?.length]);

  return {
    leaderboard,
    isLoading,
    error,
    refetch,
  };
}

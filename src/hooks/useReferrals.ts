import { useEffect, useRef } from 'react';
import { useAccount } from 'wagmi';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabaseClient';
import { assignReferralCode } from '../utils/generateReferralCode';

export interface ReferralUser {
  wallet_address: string;
  username: string;
  avatar_url: string | null;
  created_at: string;
  total_wagered: number;
  xp_earned: number; // XP points you earned from this referral
}

export interface ReferralStats {
  totalReferrals: number;
  totalVolume: number;
  totalReward: number;
  referralCode: string;
}

async function fetchReferralData(address: string): Promise<{ referrals: ReferralUser[]; stats: ReferralStats }> {
  console.log('🔍 [useReferrals] Fetching referral data for address:', address);
  
  // Get current user's profile to get their referral code
  const { data: currentUser, error: userError } = await supabase
    .from('users')
    .select('username, user_referral')
    .ilike('wallet_address', address)
    .single();

  console.log('👤 [useReferrals] Current user data:', currentUser);

  if (userError) {
    console.error('❌ [useReferrals] Error fetching current user:', userError);
    throw new Error('Failed to fetch user profile');
  }

  if (!currentUser) {
    console.warn('⚠️ [useReferrals] No user profile found');
    return {
      referrals: [],
      stats: {
        totalReferrals: 0,
        totalVolume: 0,
        totalReward: 0,
        referralCode: '',
      },
    };
  }

  // Get or generate referral code
  let referralCode = currentUser.user_referral;
  
  // If no referral code exists, log warning but don't auto-generate
  // (it should be generated during signup)
  if (!referralCode) {
    console.warn('⚠️ [useReferrals] User has no referral code. This should have been generated during signup.');
    return {
      referrals: [],
      stats: {
        totalReferrals: 0,
        totalVolume: 0,
        totalReward: 0,
        referralCode: '',
      },
    };
  }

  console.log('✅ [useReferrals] User referral code:', referralCode);

  // Get all users who used this referral code, including their trading_volume
  // Handle both formats: "14 00: MERCURY_AIAN01" and just "MERCURY_AIAN01"
  const { data: allUsers, error: referredError } = await supabase
    .from('users')
    .select('wallet_address, username, avatar_url, created_at, trading_volume, used_referral')
    .or(`used_referral.eq.${referralCode},used_referral.like.%${referralCode}%`);

  // Filter to only include users who actually used this referral code
  const referredUsers = allUsers?.filter(user => {
    if (!user.used_referral) return false;
    // Check if it matches exactly or contains the referral code
    return user.used_referral === referralCode || user.used_referral.includes(referralCode);
  });

  console.log('👥 [useReferrals] Referred users:', referredUsers?.length || 0);

  if (referredError) {
    console.error('❌ [useReferrals] Error fetching referred users:', referredError);
    throw new Error('Failed to fetch referred users');
  }

  if (!referredUsers || referredUsers.length === 0) {
    return {
      referrals: [],
      stats: {
        totalReferrals: 0,
        totalVolume: 0,
        totalReward: 0,
        referralCode,
      },
    };
  }

  // Map referred users with their trading_volume and calculate XP earned
  const referralsWithVolume: ReferralUser[] = (referredUsers || []).map((user) => {
    // trading_volume is already in USD (stored as NUMERIC), so use it directly
    const totalWagered = parseFloat(user.trading_volume?.toString() || '0') || 0;

    // Calculate XP points earned from this referral:
    // +10 points when they joined (used your referral)
    // +100 points for each $100 milestone they crossed
    const joinBonus = 10; // +10 for using your referral
    const milestoneBonus = Math.floor(totalWagered / 100) * 100; // +100 per $100 milestone
    const xpEarned = joinBonus + milestoneBonus;

    return {
      wallet_address: user.wallet_address,
      username: user.username,
      avatar_url: user.avatar_url,
      created_at: user.created_at,
      total_wagered: totalWagered,
      xp_earned: xpEarned,
    };
  });

  // Calculate stats
  const totalReferrals = referralsWithVolume.length;
  const totalVolume = referralsWithVolume.reduce((sum, r) => sum + r.total_wagered, 0);
  const totalReward = totalVolume * 0.1; // 10% of referral volume as reward

  return {
    referrals: referralsWithVolume,
    stats: {
      totalReferrals,
      totalVolume,
      totalReward,
      referralCode,
    },
  };
}

export function useReferrals() {
  const { address, isConnected } = useAccount();
  const queryClient = useQueryClient();
  const subscriptionRef = useRef<any>(null);

  const queryKey = ['referrals', address?.toLowerCase()];

  const {
    data = { referrals: [], stats: { totalReferrals: 0, totalVolume: 0, totalReward: 0, referralCode: '' } },
    isLoading,
    error,
    refetch,
  } = useQuery<{ referrals: ReferralUser[]; stats: ReferralStats }>({
    queryKey,
    queryFn: () => fetchReferralData(address!),
    enabled: !!isConnected && !!address,
    staleTime: 30_000, // Consider data fresh for 30 seconds
    gcTime: 5 * 60 * 1000, // Keep in cache for 5 minutes
    retry: 1,
    retryDelay: 1000,
  });

  // Set up Supabase Realtime subscription for instant updates
  useEffect(() => {
    if (!isConnected || !address || !data.stats.referralCode) return;

    const normalizedAddress = address.toLowerCase();
    const referralCode = data.stats.referralCode;
    
    console.log('🔔 [useReferrals] Setting up Supabase Realtime subscription for referrals...');
    console.log('  - Referral code:', referralCode);

    const channel = supabase
      .channel(`referrals_${normalizedAddress}`)
      .on(
        'postgres_changes' as any,
        {
          event: '*', // Listen to INSERT, UPDATE, DELETE
          schema: 'public',
          table: 'users',
        },
        async (payload: any) => {
          console.log('🔔 [useReferrals] Realtime event received:', payload.eventType, payload);
          
          const updatedUser = payload.new || payload.old;
          if (!updatedUser) return;
          
          // Check if this is a new referral (INSERT with our referral code)
          if (payload.eventType === 'INSERT' && updatedUser.used_referral) {
            const usedRef = updatedUser.used_referral.toString();
            if (usedRef === referralCode || usedRef.includes(referralCode)) {
              console.log('🎉 [useReferrals] New referral detected!', updatedUser.wallet_address);
              setTimeout(() => {
                console.log('🔄 [useReferrals] Refetching after new referral...');
                refetch();
              }, 500);
              return;
            }
          }
          
          // Check if this is an update to a referred user
          if (payload.eventType === 'UPDATE') {
            const currentData = queryClient.getQueryData<{ referrals: ReferralUser[]; stats: ReferralStats }>(queryKey);
            
            if (currentData) {
              const isReferredUser = currentData.referrals.some(
                r => r.wallet_address.toLowerCase() === updatedUser.wallet_address?.toLowerCase()
              );
              
              if (isReferredUser) {
                // Check if trading_volume changed
                const oldVolume = payload.old?.trading_volume;
                const newVolume = updatedUser.trading_volume;
                
                if (oldVolume !== newVolume) {
                  console.log('💰 [useReferrals] Trading volume updated for referred user:', {
                    address: updatedUser.wallet_address,
                    oldVolume,
                    newVolume,
                  });
                  // Refetch to get updated stats
                  setTimeout(() => {
                    refetch();
                  }, 500);
                }
              }
            }
          }
        }
      )
      .subscribe((status) => {
        console.log('🔔 [useReferrals] Realtime subscription status:', status);
      });

    subscriptionRef.current = channel;

    return () => {
      if (subscriptionRef.current) {
        console.log('🔔 [useReferrals] Cleaning up Realtime subscription');
        supabase.removeChannel(subscriptionRef.current);
        subscriptionRef.current = null;
      }
    };
  }, [isConnected, address, data.stats.referralCode, queryClient, queryKey, refetch]);

  return {
    referrals: data.referrals,
    stats: data.stats,
    isLoading,
    error: error ? (error as Error).message : null,
    refetch,
  };
}

import { useEffect } from 'react';
import { useAccount } from 'wagmi';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabaseClient';

export interface UserProfile {
  username: string;
  avatar_url: string | null;
  wallet_address: string;
  created_at: string;
  user_referral: string | null;
  trading_volume: number | null;
  xp: number | null;
}

const PROFILE_UPDATED_EVENT = 'mercury_profile_updated';
const getProfileCacheKey = (address: string) => `mercury_profile_cache_${address}`;

function getCachedProfile(address: string): UserProfile | null {
  if (typeof window === 'undefined') return null;
  try {
    const cached = localStorage.getItem(getProfileCacheKey(address));
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed.timestamp && Date.now() - parsed.timestamp < 5 * 60 * 1000) {
        return parsed.profile;
      }
    }
  } catch (e) {}
  return null;
}

function setCachedProfile(address: string, profile: UserProfile | null) {
  if (typeof window === 'undefined') return;
  try {
    if (profile) {
      localStorage.setItem(getProfileCacheKey(address), JSON.stringify({ profile, timestamp: Date.now() }));
    } else {
      localStorage.removeItem(getProfileCacheKey(address));
    }
  } catch (e) {}
}

export function useUserProfile() {
  const { address, isConnected } = useAccount();
  const queryClient = useQueryClient();

  const queryEnabled = !!address && isConnected;
  const isDev = process.env.NODE_ENV === 'development';
  // if (isDev) console.log('🔌 useUserProfile:', { address, isConnected, queryEnabled });

  const { data: profile, isLoading, isFetched, refetch } = useQuery({
    queryKey: ['userProfile', address],
    queryFn: async (): Promise<UserProfile | null> => {
      if (isDev) console.log(' queryFn EXECUTING for:', address);
      
      if (!address) return null;

      const { data, error } = await supabase
        .from('users')
        .select('username, avatar_url, wallet_address, created_at, user_referral, trading_volume, xp')
        .eq('wallet_address', address)
        .maybeSingle();

      if (isDev) console.log('📦 Supabase result:', { data, error });

      if (error) {
        console.error('❌ Supabase error:', error);
        return null;
      }

      if (data) {
        if (isDev) console.log('Profile found:', data.username);
        setCachedProfile(address, data);
        return data;
      }
      
      if (isDev) console.log('⚠️ No profile found');
      return null;
    },
    enabled: queryEnabled,
    staleTime: 60_000, // 1 minute - profile data is relatively static
    gcTime: 10 * 60 * 1000, // 10 minutes
    retry: 1,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });

  // Use cache as fallback
  const cachedProfile = address ? getCachedProfile(address) : null;
  const effectiveProfile = profile || cachedProfile;
  const effectiveIsLoading = !isFetched && isLoading && !cachedProfile;

  useEffect(() => {
    // if (process.env.NODE_ENV === 'development') {
    //   console.log('📊 Profile state:', { hasProfile: !!effectiveProfile, isLoading: effectiveIsLoading, isFetched });
    // }
  }, [effectiveProfile, effectiveIsLoading, isFetched]);

  // Realtime subscription
  useEffect(() => {
    if (!address || !isConnected) return;

    const channel = supabase
      .channel(`user_profile_${address}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'users',
        filter: `wallet_address=eq.${address}`,
      }, (payload) => {
        if (payload.eventType === 'UPDATE' || payload.eventType === 'INSERT') {
          queryClient.setQueryData(['userProfile', address], payload.new);
          setCachedProfile(address, payload.new as UserProfile);
        } else if (payload.eventType === 'DELETE') {
          queryClient.setQueryData(['userProfile', address], null);
          setCachedProfile(address, null);
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [address, isConnected, queryClient]);

  useEffect(() => {
    const handler = () => refetch();
    window.addEventListener(PROFILE_UPDATED_EVENT, handler);
    return () => window.removeEventListener(PROFILE_UPDATED_EVENT, handler);
  }, [refetch]);

  return { profile: effectiveProfile, isLoading: effectiveIsLoading, refetch };
}

export function triggerProfileRefresh() {
  window.dispatchEvent(new CustomEvent(PROFILE_UPDATED_EVENT));
}
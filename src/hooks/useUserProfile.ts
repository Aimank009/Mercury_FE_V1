import { useState, useEffect, useCallback } from 'react';
import { useAccount } from 'wagmi';
import { supabase } from '../lib/supabaseClient';

export interface UserProfile {
  username: string;
  avatar_url: string | null;
  wallet_address: string;
}

// Global event for profile updates
const PROFILE_UPDATED_EVENT = 'mercury_profile_updated';

export function useUserProfile() {
  const { address, isConnected } = useAccount();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetchProfile = useCallback(async () => {
    if (!isConnected || !address) {
      setProfile(null);
      return;
    }

    setIsLoading(true);
    try {
      console.log('🔍 Fetching user profile for:', address);
      
      const { data, error } = await supabase
        .from('users')
        .select('username, avatar_url, wallet_address')
        .ilike('wallet_address', address) // Case-insensitive match!
        .maybeSingle(); // Use maybeSingle to avoid error when no rows

      if (data && !error) {
        console.log('✅ Profile loaded:', data.username);
        setProfile(data);
      } else {
        console.log('⚠️ No profile found for:', address);
        setProfile(null);
      }
    } catch (err) {
      console.error('Error fetching user profile:', err);
      setProfile(null);
    } finally {
      setIsLoading(false);
    }
  }, [address, isConnected]);

  // Fetch on mount and when address changes
  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  // Listen for profile update events (triggered after profile creation)
  useEffect(() => {
    const handleProfileUpdate = () => {
      console.log('📢 Profile update event received, refetching...');
      fetchProfile();
    };

    window.addEventListener(PROFILE_UPDATED_EVENT, handleProfileUpdate);
    return () => {
      window.removeEventListener(PROFILE_UPDATED_EVENT, handleProfileUpdate);
    };
  }, [fetchProfile]);

  // Expose refetch function
  const refetch = useCallback(() => {
    fetchProfile();
  }, [fetchProfile]);

  return { profile, isLoading, refetch };
}

// Helper function to trigger profile refresh across all components
export function triggerProfileRefresh() {
  console.log('🔄 Triggering profile refresh event...');
  window.dispatchEvent(new CustomEvent(PROFILE_UPDATED_EVENT));
}

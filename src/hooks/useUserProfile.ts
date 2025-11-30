import { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { supabase } from '../lib/supabaseClient';

export interface UserProfile {
  username: string;
  avatar_url: string | null;
  wallet_address: string;
}

export function useUserProfile() {
  const { address, isConnected } = useAccount();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!isConnected || !address) {
      setProfile(null);
      return;
    }

    const fetchProfile = async () => {
      setIsLoading(true);
      try {
        const { data, error } = await supabase
          .from('users')
          .select('username, avatar_url, wallet_address')
          .eq('wallet_address', address)
          .single();

        if (data && !error) {
          setProfile(data);
        } else {
          setProfile(null);
        }
      } catch (err) {
        console.error('Error fetching user profile:', err);
        setProfile(null);
      } finally {
        setIsLoading(false);
      }
    };

    fetchProfile();
  }, [address, isConnected]);

  return { profile, isLoading };
}

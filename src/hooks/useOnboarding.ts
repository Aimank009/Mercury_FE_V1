import { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { useSessionTrading } from '../contexts/SessionTradingContext';
import { supabase } from '../lib/supabaseClient';

interface OnboardingState {
  hasAcceptedTerms: boolean;
  hasCreatedProfile: boolean;
  showTermsModal: boolean;
  showUserCreationModal: boolean;
  isLoadingProfile: boolean;
}

export function useOnboarding() {
  const { address, isConnected } = useAccount();
  const { sdk } = useSessionTrading();
  const [state, setState] = useState<OnboardingState>({
    hasAcceptedTerms: false,
    hasCreatedProfile: false,
    showTermsModal: false,
    showUserCreationModal: false,
    isLoadingProfile: false,
  });
  const [sessionStatus, setSessionStatus] = useState<{
    message: string;
    type: 'success' | 'error' | 'info';
  } | null>(null);

  useEffect(() => {
    if (!isConnected || !address) {
      // User disconnected, reset state
      setState({
        hasAcceptedTerms: false,
        hasCreatedProfile: false,
        showTermsModal: false,
        showUserCreationModal: false,
        isLoadingProfile: false,
      });
      return;
    }

    const checkOnboardingStatus = async () => {
      setState(prev => ({ ...prev, isLoadingProfile: true }));
      
      // 1. Check Access Code (Local Storage)
      const accessKey = `mercury_access_granted_${address.toLowerCase()}`;
      const hasAccess = localStorage.getItem(accessKey) === 'true';

      if (!hasAccess) {
        setState({
          hasAcceptedTerms: false,
          hasCreatedProfile: false,
          showTermsModal: true,
          showUserCreationModal: false,
          isLoadingProfile: false,
        });
        return;
      }

      // 2. Check User Profile (Supabase)
      try {
        const { data, error } = await supabase
          .from('users')
          .select('wallet_address')
          .eq('wallet_address', address)
          .single();
        
        const hasProfile = !!data && !error;

        if (hasProfile) {
          // User is fully onboarded
          setState({
            hasAcceptedTerms: true,
            hasCreatedProfile: true,
            showTermsModal: false,
            showUserCreationModal: false,
            isLoadingProfile: false,
          });
        } else {
          // User has access code but no profile -> Show Creation Modal
          setState({
            hasAcceptedTerms: true,
            hasCreatedProfile: false,
            showTermsModal: false,
            showUserCreationModal: true,
            isLoadingProfile: false,
          });
        }
      } catch (err) {
        console.error('Error checking user profile:', err);
        // Fallback: show creation modal if we can't verify
        setState({
          hasAcceptedTerms: true,
          hasCreatedProfile: false,
          showTermsModal: false,
          showUserCreationModal: true,
          isLoadingProfile: false,
        });
      }
    };

    checkOnboardingStatus();
  }, [address, isConnected]);

  const handleAcceptTerms = async () => {
    if (!address) return;

    // Store access grant in localStorage
    const storageKey = `mercury_access_granted_${address.toLowerCase()}`;
    localStorage.setItem(storageKey, 'true');

    // Move to User Creation
    setState(prev => ({
      ...prev,
      hasAcceptedTerms: true,
      showTermsModal: false,
      showUserCreationModal: true,
    }));
  };

  const handleProfileCreated = () => {
    if (!address) return;

    setState({
      hasAcceptedTerms: true,
      hasCreatedProfile: true,
      showTermsModal: false,
      showUserCreationModal: false,
      isLoadingProfile: false,
    });
  };

  const handleCloseModal = () => {
    setState(prev => ({
      ...prev,
      showTermsModal: false,
      showUserCreationModal: false,
    }));
  };

  const clearSessionStatus = () => setSessionStatus(null);

  const createTradingSession = async () => {
    if (!address || !sdk) return;
    
    try {
      setSessionStatus({ message: 'Creating session...', type: 'info' });
      const session = await sdk.createSession();
      setSessionStatus({ message: 'Session created successfully!', type: 'success' });
      return session;
    } catch (error: any) {
      console.error('Failed to create session:', error);
      setSessionStatus({ 
        message: error.message || 'Failed to create session', 
        type: 'error' 
      });
    }
  };

  return {
    canAccessApp: state.hasAcceptedTerms && state.hasCreatedProfile,
    showTermsModal: state.showTermsModal,
    showUserCreationModal: state.showUserCreationModal,
    isLoadingProfile: state.isLoadingProfile,
    handleAcceptTerms,
    handleProfileCreated,
    handleCloseModal,
    sessionStatus,
    clearSessionStatus,
    createTradingSession,
  };
}


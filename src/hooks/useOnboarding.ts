import { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { useSessionTrading } from '../contexts/SessionTradingContext';
import { useUserProfile } from './useUserProfile';

interface OnboardingState {
  hasAcceptedTerms: boolean;
  hasCreatedProfile: boolean;
  showTermsModal: boolean;
  showUserCreationModal: boolean;
  isLoadingProfile: boolean;
  usedReferralCode: string | null;
}

export function useOnboarding() {
  const { address, isConnected } = useAccount();
  const { sdk } = useSessionTrading();
  const { profile, isLoading: isProfileLoading } = useUserProfile();
  
  const [state, setState] = useState<OnboardingState>({
    hasAcceptedTerms: false,
    hasCreatedProfile: false,
    showTermsModal: false,
    showUserCreationModal: false,
    isLoadingProfile: true,
    usedReferralCode: null,
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
        usedReferralCode: null,
      });
      return;
    }

    const checkOnboardingStatus = async () => {
      // console.log('🔄 Checking onboarding status:', { isProfileLoading, hasProfile: !!profile, address });
      
      // OPTIMIZATION: If we have a profile (even from cache), use it immediately
      // Don't wait for loading state - this makes the UI instant for returning users
      if (profile) {
        // ✅ USER EXISTS - They are fully onboarded!
        // console.log('✅ Existing user found:', profile.username);
        
        if (typeof window !== 'undefined') {
          const accessKey = `mercury_access_granted_${address.toLowerCase()}`;
          // Ensure access key is set
          localStorage.setItem(accessKey, 'true');
        }
        
        setState(prev => ({
          ...prev,
          hasAcceptedTerms: true,
          hasCreatedProfile: true,
          showTermsModal: false,
          showUserCreationModal: false,
          isLoadingProfile: false,
        }));
        return;
      }
      
      // Only show loading if we don't have cached data and are still loading
      if (isProfileLoading) {
        console.log('⏳ Profile still loading, waiting...');
        setState(prev => ({ ...prev, isLoadingProfile: true }));
        return;
      }
      
      if (typeof window === 'undefined') {
        return;
      }
      
      const accessKey = `mercury_access_granted_${address.toLowerCase()}`;
      
      console.log('👋 User not found in profile cache, checking access code...');

      // 2. Check Access Code (Local Storage) - only for new users
      const hasAccess = localStorage.getItem(accessKey) === 'true';
      
      // Also check for stored referral code
      const storedReferralCode = localStorage.getItem(`mercury_used_referral_${address.toLowerCase()}`);

      if (!hasAccess) {
        // New user without access code - show terms modal (AccessCodeModal)
        console.log('🔑 No access code found, showing AccessCodeModal');
        setState(prev => ({
          ...prev,
          hasAcceptedTerms: false,
          hasCreatedProfile: false,
          showTermsModal: true,
          showUserCreationModal: false,
          isLoadingProfile: false,
        }));
        return;
      }

      // 3. Has access code but no profile -> Show Creation Modal
      console.log('📝 Has access code but no profile, showing UserCreationModal');
      setState(prev => ({
        ...prev,
        hasAcceptedTerms: true,
        hasCreatedProfile: false,
        showTermsModal: false,
        showUserCreationModal: true,
        isLoadingProfile: false,
        usedReferralCode: storedReferralCode,
      }));
    };

    checkOnboardingStatus();
  }, [address, isConnected, profile, isProfileLoading]);

  const handleAcceptTerms = async (accessCode: string) => {
    if (!address) return;

    if (typeof window !== 'undefined') {
      // Store access grant in localStorage
      const storageKey = `mercury_access_granted_${address.toLowerCase()}`;
      localStorage.setItem(storageKey, 'true');
      
      // Also store the used referral code for the UserCreationModal
      localStorage.setItem(`mercury_used_referral_${address.toLowerCase()}`, accessCode);
    }

    // Move to User Creation
    setState(prev => ({
      ...prev,
      hasAcceptedTerms: true,
      showTermsModal: false,
      showUserCreationModal: true,
      usedReferralCode: accessCode,
    }));
  };

  const handleProfileCreated = () => {
    if (!address) return;

    setState(prev => ({
      ...prev,
      hasAcceptedTerms: true,
      hasCreatedProfile: true,
      showTermsModal: false,
      showUserCreationModal: false,
      isLoadingProfile: false,
    }));
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
    canAccessApp: (!!profile) || (state.hasAcceptedTerms && state.hasCreatedProfile),
    showTermsModal: state.showTermsModal,
    showUserCreationModal: state.showUserCreationModal,
    isLoadingProfile: state.isLoadingProfile,
    usedReferralCode: state.usedReferralCode,
    handleAcceptTerms,
    handleProfileCreated,
    handleCloseModal,
    sessionStatus,
    clearSessionStatus,
    createTradingSession,
  };
}


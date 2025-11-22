import { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { useSessionTrading } from '../contexts/SessionTradingContext';

interface OnboardingState {
  hasAcceptedTerms: boolean;
  hasCompletedTutorial: boolean;
  showTermsModal: boolean;
  showTutorialModal: boolean;
}

export function useOnboarding() {
  const { address, isConnected } = useAccount();
  const { sdk } = useSessionTrading();
  const [state, setState] = useState<OnboardingState>({
    hasAcceptedTerms: false,
    hasCompletedTutorial: false,
    showTermsModal: false,
    showTutorialModal: false,
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
        hasCompletedTutorial: false,
        showTermsModal: false,
        showTutorialModal: false,
      });
      return;
    }

    // Check if this address has already accepted terms and completed tutorial
    const termsKey = `mercury_terms_accepted_${address.toLowerCase()}`;
    const tutorialKey = `mercury_tutorial_completed_${address.toLowerCase()}`;
    const hasAcceptedTerms = localStorage.getItem(termsKey) === 'true';
    const hasCompletedTutorial = localStorage.getItem(tutorialKey) === 'true';

    if (hasAcceptedTerms && hasCompletedTutorial) {
      // User has completed onboarding
      setState({
        hasAcceptedTerms: true,
        hasCompletedTutorial: true,
        showTermsModal: false,
        showTutorialModal: false,
      });
    } else if (hasAcceptedTerms && !hasCompletedTutorial) {
      // User accepted terms but hasn't completed tutorial
      setState({
        hasAcceptedTerms: true,
        hasCompletedTutorial: false,
        showTermsModal: false,
        showTutorialModal: true,
      });
    } else {
      // New user - show terms modal first
      setState({
        hasAcceptedTerms: false,
        hasCompletedTutorial: false,
        showTermsModal: true,
        showTutorialModal: false,
      });
    }
  }, [address, isConnected]);

  const handleAcceptTerms = async () => {
    if (!address) return;

    // Store acceptance in localStorage
    const storageKey = `mercury_terms_accepted_${address.toLowerCase()}`;
    localStorage.setItem(storageKey, 'true');

    // Move to tutorial
    setState({
      hasAcceptedTerms: true,
      hasCompletedTutorial: false,
      showTermsModal: false,
      showTutorialModal: true,
    });

    // Session creation moved to manual "Enable Trading" button
    // User must explicitly click to create session
  };

  const handleCompleteTutorial = () => {
    if (!address) return;

    // Store tutorial completion in localStorage
    const storageKey = `mercury_tutorial_completed_${address.toLowerCase()}`;
    localStorage.setItem(storageKey, 'true');

    setState({
      hasAcceptedTerms: true,
      hasCompletedTutorial: true,
      showTermsModal: false,
      showTutorialModal: false,
    });
  };

  const handleCloseModal = () => {
    // User can close the modal, but they won't be able to access the app
    setState((prev) => ({
      ...prev,
      showTermsModal: false,
      showTutorialModal: false,
    }));
  };

  const clearSessionStatus = () => {
    setSessionStatus(null);
  };

  // Manual session creation - called when user clicks "Enable Trading"
  const createTradingSession = async () => {
    if (!sdk) {
      setSessionStatus({
        message: 'SDK not initialized',
        type: 'error'
      });
      return false;
    }

    if (!address) {
      setSessionStatus({
        message: 'Wallet not connected',
        type: 'error'
      });
      return false;
    }

    try {
      console.log('🔑 Creating trading session for address:', address);
      await sdk.createSession();
      
      // Get the session info from SDK after creation
      const sessionInfo = sdk.getSessionInfo();
      console.log('✅ Trading session created successfully', sessionInfo);
      
      // Calculate time remaining
      const expiryDate = sessionInfo?.expiry;
      let timeRemainingText = '24 hours';
      
      if (expiryDate) {
        const now = new Date();
        const expiry = expiryDate instanceof Date ? expiryDate : new Date(expiryDate);
        const diffMs = expiry.getTime() - now.getTime();
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        
        if (diffHours > 0) {
          timeRemainingText = `${diffHours} hour${diffHours > 1 ? 's' : ''} ${diffMinutes} minute${diffMinutes !== 1 ? 's' : ''}`;
        } else {
          timeRemainingText = `${diffMinutes} minute${diffMinutes !== 1 ? 's' : ''}`;
        }
      }
      
      // Verify session was stored in localStorage
      setTimeout(() => {
        // Try multiple key formats (lowercase, original case)
        const keysToTry = [
          `tradingSession_${address}`, // Original case
          `tradingSession_${address.toLowerCase()}`, // Lowercase
        ];
        
        let storedSession = null;
        let foundKey = null;
        
        for (const key of keysToTry) {
          storedSession = localStorage.getItem(key);
          if (storedSession) {
            foundKey = key;
            break;
          }
        }
        
        if (storedSession && foundKey) {
          console.log('✅ Session successfully stored in localStorage with key:', foundKey);
          const parsed = JSON.parse(storedSession);
          console.log('📦 Stored session data:', {
            user: parsed.user,
            sessionKey: parsed.sessionKey,
            expiry: new Date(parsed.expiry * 1000).toISOString()
          });
        } else {
          console.error('⚠️ Session not found in localStorage!');
          console.error('Expected keys:', keysToTry);
          console.error('Available keys:', Object.keys(localStorage).filter(k => k.includes('session') || k.includes('trading')));
        }
      }, 500); // Increased timeout to give SDK time to save
      
      setSessionStatus({
        message: `Trading session enabled! Session valid for: ${timeRemainingText}`,
        type: 'success'
      });
      return true;
    } catch (error: any) {
      console.error('❌ Failed to create session:', error);
      
      let errorMessage = 'Failed to create trading session.';
      if (error.code === 4001) {
        errorMessage = 'Signature rejected. You need to sign to enable trading.';
      } else if (error.message) {
        errorMessage = `Failed to create session: ${error.message}`;
      }
      
      setSessionStatus({
        message: errorMessage,
        type: 'error'
      });
      return false;
    }
  };

  return {
    hasAcceptedTerms: state.hasAcceptedTerms,
    hasCompletedTutorial: state.hasCompletedTutorial,
    showTermsModal: state.showTermsModal,
    showTutorialModal: state.showTutorialModal,
    handleAcceptTerms,
    handleCompleteTutorial,
    handleCloseModal,
    canAccessApp: isConnected && state.hasAcceptedTerms && state.hasCompletedTutorial,
    sessionStatus,
    clearSessionStatus,
    createTradingSession, // Export manual session creation
  };
}


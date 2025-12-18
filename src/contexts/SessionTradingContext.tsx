import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useAccount } from 'wagmi';
import { CONTRACTS, DEFAULT_CHAIN_ID, API_URLS, SESSION_CONFIG } from '../config';

// 🔧 BACKEND CONFIGURATION:
// 
// REAL MODE: Connected to HyperEVM backend via ngrok
// - Using SessionTradingSDK for real transactions
// - Chain ID: 999 (HyperEVM)
// - Backend: https://snakily-frontoparietal-catarina.ngrok-free.dev
//
// To switch back to MOCK MODE for testing:
// Change import below to: '../lib/MockRelayerSDK'
//
// Current mode: REAL
import { SessionTradingSDK } from '../lib/SessionTradingSDK';

interface SessionTradingContextType {
  sdk: SessionTradingSDK | null;
  isReady: boolean;
}

const SessionTradingContext = createContext<SessionTradingContextType>({
  sdk: null,
  isReady: false,
});

export const useSessionTrading = () => useContext(SessionTradingContext);

interface SessionTradingProviderProps {
  children: ReactNode;
}

export function SessionTradingProvider({ children }: SessionTradingProviderProps) {
  const { isConnected } = useAccount();
  const [sdk, setSdk] = useState<SessionTradingSDK | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Initialize SDK with HyperEVM configuration
    const sdkInstance = new SessionTradingSDK({
      relayerUrl: API_URLS.RELAYER,
      wrapperContractAddress: CONTRACTS.WRAPPER,
      chainId: DEFAULT_CHAIN_ID,
      sessionDuration: SESSION_CONFIG.DURATION_MS,
    });

    setSdk(sdkInstance);

    // Connect wallet if already connected
    if (isConnected) {
      sdkInstance.connect()
        .then(() => {
          console.log('✅ SDK connected');
          setIsReady(true);
        })
        .catch((err) => {
          console.error('❌ Failed to connect SDK:', err);
          // Don't crash - just log the error and continue
          setIsReady(true); // Still mark as ready so app doesn't hang
        });
    } else {
      setIsReady(true);
    }

    // Listen for network changes in MetaMask
    const handleChainChanged = async (chainIdHex: string) => {
      const newChainId = parseInt(chainIdHex, 16);
      console.log(`🔄 Network changed to chain ${newChainId}`);
      
      const HYPE_CHAIN_ID = 999;
  
  // ✅ Only reconnect if switching TO HyperEVM
  // If switching AWAY from HyperEVM, skip reconnection to prevent crash
  if (newChainId !== HYPE_CHAIN_ID) {
    console.log(`⚠️ Switched to chain ${newChainId} (not HyperEVM). Skipping SDK reconnection.`);
    console.log('💡 Please switch back to HyperEVM (999) to use Mercury Trade.');
    return; // Don't try to reconnect - prevents crash
  }
      // Reconnect SDK to update provider
      if (sdkInstance && isConnected) {
        try {
          await sdkInstance.connect();
          console.log(`✅ SDK reconnected to chain ${newChainId}`);
        } catch (err) {
          console.error('❌ Failed to reconnect SDK after network change:', err);
        }
      }
    };

    if (typeof window !== 'undefined' && window.ethereum) {
      window.ethereum.on('chainChanged', handleChainChanged);
      
      return () => {
        window.ethereum?.removeListener('chainChanged', handleChainChanged);
      };
    }
  }, [isConnected]);

  return (
    <SessionTradingContext.Provider value={{ sdk, isReady }}>
      {children}
    </SessionTradingContext.Provider>
  );
}


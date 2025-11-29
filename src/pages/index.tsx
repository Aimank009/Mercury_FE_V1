import type { NextPage } from 'next';
import Head from 'next/head';
import { useState, useEffect } from 'react';
import { useAccount, useSwitchChain } from 'wagmi';
import Navbar from '../components/Navbar';
import TradingInfo from '../components/TradingInfo';
import TradingChart from '../components/TradingChart';
import Positions from '../components/Positions';
import TermsModal from '../components/TermsModal';
import TutorialModal from '../components/TutorialModal';
import DepositWithdrawModal from '../components/DepositWithdrawModal';
import SessionNotification from '../components/SessionNotification';
import OrderNotification from '../components/OrderNotification';
import { useOnboarding } from '../hooks/useOnboarding';
import { useOrderPlacement } from '../hooks/useOrderPlacement';
import { PRICE_STEP, PRICE_DECIMALS } from '../config';
import styles from '../styles/Home.module.css';

const Home: NextPage = () => {
  const { isConnected, address, chain } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [recenterTrigger, setRecenterTrigger] = useState(0);
  const [showSessionPrompt, setShowSessionPrompt] = useState(false);
  const [showTradingEnabledPopup, setShowTradingEnabledPopup] = useState(false);
  
  const {
    canAccessApp,
    showTermsModal,
    showTutorialModal,
    handleAcceptTerms,
    handleCompleteTutorial,
    handleCloseModal,
    sessionStatus,
    clearSessionStatus,
    createTradingSession,
  } = useOnboarding();
  
  const { placeOrderFromCell, isPlacingOrder, lastOrderResult, clearLastResult } = useOrderPlacement();

  // Auto-dismiss session prompt after 3 seconds
  useEffect(() => {
    if (showSessionPrompt) {
      const timer = setTimeout(() => {
        setShowSessionPrompt(false);
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [showSessionPrompt]);

  // Auto-dismiss trading enabled popup after 2 seconds
  useEffect(() => {
    if (showTradingEnabledPopup) {
      const timer = setTimeout(() => {
        setShowTradingEnabledPopup(false);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [showTradingEnabledPopup]);

  // Auto-switch to HyperEVM when wallet connects
  useEffect(() => {
    const switchToHype = async () => {
      // HyperEVM Mainnet chain ID is 999 (0x3e7)
      const HYPE_CHAIN_ID = 999;
      
      if (address && chain && chain.id !== HYPE_CHAIN_ID) {
        try {
          console.log('🔄 Auto-switching to HyperEVM network...');
          await switchChainAsync({ chainId: HYPE_CHAIN_ID });
          console.log('✅ Successfully switched to HyperEVM');
        } catch (error) {
          console.error('❌ Failed to switch network:', error);
          // Show user-friendly error message
          alert('⚠️ Please switch to HyperEVM network in your wallet to use this app.\n\nNetwork: HyperEVM\nChain ID: 999');
        }
      } else if (address && chain && chain.id === HYPE_CHAIN_ID) {
        console.log('✅ Already on HyperEVM network');
      }
    };
    
    // Only try to switch if wallet is connected
    if (address) {
      switchToHype();
    }
  }, [address, chain, switchChainAsync]);

  return (
    <div className={styles.container}>
      <Head>
        <title>Mercury Trade</title>
        <meta
          content="Mercury Trade - Advanced Trading Platform"
          name="description"
        />
        <link href="/favicon.ico" rel="icon" />
      </Head>

      <Navbar 
        onDepositClick={() => setShowDepositModal(true)}
        onEnableTrading={async () => {
          const success = await createTradingSession();
          if (success) {
            setShowTradingEnabledPopup(true);
          }
          return success;
        }}
      />
      
      {/* Order Result Notification */}
      {lastOrderResult &&  !lastOrderResult.success &&  (
         <OrderNotification
        message={lastOrderResult.error || 'Order failed'}
          type="error"
          duration={lastOrderResult.isSpecificError ? 0 : 8000} // Don't auto-close specific errors
          onClose={clearLastResult}
          isProminent={lastOrderResult.isSpecificError} // Make it prominent for specific errors
        />
      )}
      
      {/* Show terms modal when user connects but hasn't accepted terms */}
      <TermsModal
        isOpen={showTermsModal}
        onAccept={handleAcceptTerms}
        onClose={handleCloseModal}
      />

      {/* Show tutorial modal after user accepts terms */}
      <TutorialModal
        isOpen={showTutorialModal}
        onComplete={handleCompleteTutorial}
      />

      {/* Deposit/Withdraw Modal */}
      <DepositWithdrawModal
        isOpen={showDepositModal}
        onClose={() => setShowDepositModal(false)}
      />
      
      {/* Only show trading interface if user has completed onboarding OR is not connected */}
      {(!isConnected || canAccessApp) && (
        <>
          <div className={styles.tradingContainer}>
            <TradingInfo 
              isScrolled={isScrolled}
              onRecenter={() => setRecenterTrigger(prev => prev + 1)}
            />
            <main className={styles.main}>
              <div className={styles.chartSection}>
                <TradingChart 
                  priceStep={PRICE_STEP}
                  priceDecimals={PRICE_DECIMALS}
                  isPlacingOrder={isPlacingOrder}
                  onScrollStateChange={setIsScrolled}
                  recenterTrigger={recenterTrigger}
                  onCellSelect={async (timeOffset, priceLevel) => {
                    // if (isPlacingOrder) {
                    //   console.log('Order already in progress, please wait...');
                    //   return { success: false, error: 'Order already in progress' };
                    // }
                    
                    try {
                      console.log('🎯 Placing order for cell:', { timeOffset, priceLevel });
                      const result = await placeOrderFromCell(timeOffset, priceLevel, 1); // $1 default amount
                      
                      // Check if order failed due to no session
                      if (!result.success && result.isSessionError) {
                        console.log('📢 No session - showing prompt and deselecting cell');
                        setShowSessionPrompt(true); // Show the popup
                        
                        // Deselect the cell by dispatching a custom event
                        window.dispatchEvent(new CustomEvent('deselectCell', {
                          detail: { timeOffset, priceLevel }
                        }));
                      }
                      
                      return { 
                        success: result.success, 
                        orderId: result.txHash, 
                        error: result.error 
                      };
                    } catch (error) {
                      console.error('❌ Error placing order:', error);
                      return { 
                        success: false, 
                        error: error instanceof Error ? error.message : 'Unknown error' 
                      };
                    }
                  }}
                />
              </div>
            </main>
          </div>
          <Positions />
        </>
      )}

      {/* Show a placeholder message if user is connected but hasn't completed onboarding */}
      {isConnected && !canAccessApp && !showTermsModal && !showTutorialModal && (
        <div className={styles.placeholderMessage}>
          <h2>Welcome to Mercury Trade</h2>
          <p>Please complete the onboarding to start trading.</p>
        </div>
      )}

      {/* Session Prompt Notification */}
      {showSessionPrompt && (
        <div
          style={{
            position: 'absolute',
            top: '5%',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 1001,
            animation: 'slideDown 0.3s ease-out',
          }}
        >
          <div
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',                
              padding: '12px 12px',    
              borderRadius: '24px',        
              background: '#000',      
              overflow: 'hidden',
              boxShadow:
                '0 4px 7.1px rgba(0,0,0,0.25), inset 0 0 0 1px rgba(255,218,0,0.30)',
            }}
          >
            {/* Top thin yellow sheen */}
            <div
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: 'inherit',
                pointerEvents: 'none',
                background:
                  'linear-gradient(180deg,rgba(0,0,0,0) 55%,  rgba(255,218,0,0.20) 22%,rgba(255,218,0,0.55) 0%, )',
              }}
            />

            {/* Soft center highlight band with yellow */}
            <div
              style={{
                position: 'absolute',
                left: 6,
                right: 6,
                top: '42%',
                height: '36%',
                borderRadius: 999,
                pointerEvents: 'none',
                background:
                  'radial-gradient(100% 220% at 50% 50%, rgba(255,218,0,0.28) 0%, rgba(255,218,0,0.18) 35%, rgba(255,218,0,0) 70%)',
                filter: 'blur(4px)',
                opacity: 0.9,
              }}
            />

            {/* Warning icon */}
            <svg width="15" height="13" viewBox="0 0 15 13" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M7.5 0.5L0.5 12.5H14.5L7.5 0.5Z" stroke="#FFDA00" strokeLinejoin="round"/>
              <path d="M7.5 10.1668V10.5002M7.5 4.8335L7.50267 8.16683" stroke="#FFDA00" strokeLinecap="round"/>
            </svg>

            <span
              style={{
                position: 'relative',
                zIndex: 1,
                color: '#fff',
                fontSize: 14,
                fontWeight: 300,
                fontFamily: 'Geist Mono',
                lineHeight: 1,
                textTransform: 'lowercase',
                transform: 'translateY(-0.5px)',
              }}
            >
              Enable Trading
            </span>
          </div>
        </div>
      )}

      {/* Trading Enabled Success Popup */}
      {showTradingEnabledPopup && (
        <div
          style={{
            position: 'absolute',
            top: '5%',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 1001,
            animation: 'slideDown 0.3s ease-out',
          }}
        >
          <div
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',                
              padding: '12px 12px',    
              borderRadius: '24px',        
              background: '#000',      
              overflow: 'hidden',
              boxShadow:
                '0 4px 7.1px rgba(0,0,0,0.25), inset 0 0 0 1px rgba(0,255,36,0.30)',
            }}
          >
            {/* Top thin green sheen */}
            <div
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: 'inherit',
                pointerEvents: 'none',
                background:
                  'linear-gradient(180deg,rgba(0,0,0,0) 55%,  rgba(0,255,36,0.20) 22%,rgba(0,255,36,0.55) 0%, )',
              }}
            />

            {/* Soft center highlight band */}
            <div
              style={{
                position: 'absolute',
                left: 6,
                right: 6,
                top: '42%',
                height: '36%',
                borderRadius: 999,
                pointerEvents: 'none',
                background:
                  'radial-gradient(100% 220% at 50% 50%, rgba(0,255,36,0.28) 0%, rgba(0,255,36,0.18) 35%, rgba(0,255,36,0) 70%)',
                filter: 'blur(4px)',
                opacity: 0.9,
              }}
            />

            {/* Check icon (SVG) */}
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <g clipPath="url(#clip0_55_10048)">
                <path d="M6.82867 10.876L4 8.04668L4.94267 7.10402L6.82867 8.98935L10.5993 5.21802L11.5427 6.16135L6.82867 10.876Z" fill="#00FF24"/>
                <path fillRule="evenodd" clipRule="evenodd" d="M0.666992 8.00008C0.666992 3.95008 3.95033 0.666748 8.00033 0.666748C12.0503 0.666748 15.3337 3.95008 15.3337 8.00008C15.3337 12.0501 12.0503 15.3334 8.00033 15.3334C3.95033 15.3334 0.666992 12.0501 0.666992 8.00008ZM8.00033 14.0001C7.21239 14.0001 6.43218 13.8449 5.70423 13.5434C4.97627 13.2418 4.31484 12.7999 3.75768 12.2427C3.20053 11.6856 2.75858 11.0241 2.45705 10.2962C2.15552 9.56823 2.00033 8.78801 2.00033 8.00008C2.00033 7.21215 2.15552 6.43193 2.45705 5.70398C2.75858 4.97603 3.20053 4.31459 3.75768 3.75744C4.31484 3.20029 4.97627 2.75833 5.70423 2.4568C6.43218 2.15528 7.21239 2.00008 8.00033 2.00008C9.59162 2.00008 11.1177 2.63222 12.243 3.75744C13.3682 4.88266 14.0003 6.40878 14.0003 8.00008C14.0003 9.59138 13.3682 11.1175 12.243 12.2427C11.1177 13.3679 9.59162 14.0001 8.00033 14.0001Z" fill="#00FF24"/>
              </g>
              <defs>
                <clipPath id="clip0_55_10048">
                  <rect width="16" height="16" fill="white"/>
                </clipPath>
              </defs>
            </svg>

            <span
              style={{
                position: 'relative',
                zIndex: 1,
                color: '#fff',
                fontSize: 14,
                fontWeight: 300,
                fontFamily: 'Geist Mono',
                lineHeight: 1,
                transform: 'translateY(-0.5px)',
              }}
            >
              Trading Enabled
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export default Home;

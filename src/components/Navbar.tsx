'use client';

import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useBalance, useDisconnect } from 'wagmi';
import { useState, useEffect,useRef } from 'react';
import { useSessionTrading } from '../contexts/SessionTradingContext';
import { useWrapperBalance } from '../hooks/useWrapperBalance';
import { useUserProfile } from '../hooks/useUserProfile';

interface NavbarProps {
  onDepositClick?: () => void;
  onEnableTrading?: () => Promise<boolean>;
}

export default function Navbar({ onDepositClick, onEnableTrading }: NavbarProps) {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { sdk } = useSessionTrading();
  const { data: balance } = useBalance({ address });
  const { balanceUSD: wrapperBalanceUSD, isLoading: isLoadingWrapper, error: balanceError } = useWrapperBalance(address);
  const { profile } = useUserProfile();

  // Debug logging for balance
  useEffect(() => {
    console.log('🎯 [Navbar] Balance debug:', {
      address,
      isConnected,
      wrapperBalanceUSD,
      isLoadingWrapper,
      balanceError
    });
  }, [address, isConnected, wrapperBalanceUSD, isLoadingWrapper, balanceError]);

  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [hasActiveSession, setHasActiveSession] = useState(false);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [activeNavItem, setActiveNavItem] = useState('Trade');
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);


  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      
      if (accountMenuRef.current && !accountMenuRef.current.contains(target)) {
        setShowAccountMenu(false);
      }
      
      // Don't close mobile menu if clicking the hamburger button
      const hamburgerButton = document.querySelector('[aria-label="Menu"]');
      if (mobileMenuRef.current && 
          !mobileMenuRef.current.contains(target) && 
          hamburgerButton && 
          !hamburgerButton.contains(target)) {
        setShowMobileMenu(false);
      }
    };

    if (showAccountMenu || showMobileMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showAccountMenu, showMobileMenu]);

  // Prevent body scroll when mobile menu is open
  useEffect(() => {
    if (showMobileMenu) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [showMobileMenu]);

  useEffect(() => {
    if (sdk && isConnected) {
      const checkSession = () => {
        const sessionInfo = sdk.getSessionInfo();
        const localStorageHasSession = Object.keys(localStorage).some((k) => k.startsWith('tradingSession_'));
        const sdkHasSession = sessionInfo ? !sessionInfo.isExpired : false;
        const isActive = sdkHasSession && localStorageHasSession;
        setHasActiveSession(isActive);
      };

      checkSession();
      const interval = setInterval(checkSession, 1000);

      const handleStorageChange = () => checkSession();
      if (typeof window !== 'undefined') {
        window.addEventListener('storage', handleStorageChange);
      }

      return () => {
        clearInterval(interval);
        if (typeof window !== 'undefined') {
          window.removeEventListener('storage', handleStorageChange);
        }
      };
    } else {
      setHasActiveSession(false);
    }
  }, [sdk, isConnected]);

  const handleEnableTrading = async () => {
    if (!sdk) return;

    setIsCreatingSession(true);
    try {
      if (onEnableTrading) {
        const success = await onEnableTrading();
        if (success) setHasActiveSession(true);
        return;
      }

      const isCorrectNetwork = await sdk.isOnCorrectNetwork();
      if (!isCorrectNetwork) {
        const switched = await sdk.switchToCorrectNetwork();
        if (!switched) {
          alert(
            'HyperEVM network not found in MetaMask!\n\n' +
              'Please add it manually:\n' +
              '1. Open MetaMask → Settings → Networks → Add Network\n' +
              '2. Network Name: HyperEVM\n' +
              '3. Chain ID: 999\n' +
              '4. RPC URL: (your HyperEVM RPC endpoint)\n' +
              '5. Currency Symbol: ETH\n\n' +
              'Then try again.'
          );
          return;
        }
      }

      await sdk.createSession();
      setHasActiveSession(true);
    } catch (error: any) {
      console.error('Failed to create session:', error);

      if (error.code === -32602) {
        alert('Wrong network! Please switch to HyperEVM (Chain ID: 999) in MetaMask.');
      } else if (error.code === 4001) {
        // user rejected signature
      } else if (error.code === 'NETWORK_ERROR' || error.message?.includes('network changed')) {
        alert('Network changed while creating session. Please try again.');
        try {
          await sdk.connect();
        } catch (e) {
          console.error('Failed to reconnect:', e);
        }
      } else {
        alert(`Failed to create session: ${error.message || 'Unknown error'}`);
      }
    } finally {
      setIsCreatingSession(false);
    }
  };

  const formatAddress = (addr: string) => `${addr.slice(0, 5)}.....${addr.slice(-4)}`;

  const formatBalance = (bal: number | undefined) => {
    if (bal === undefined || bal === null) return '$0.00';
    return `$${bal.toFixed(2)}`;
  };

  return (
    <>
      <style>{`
       [data-testid="rk-connect-button"] {
          background: #00FF24 !important;
          color: #000 !important;
          border: none !important;
          font-family: 'Geist', sans-serif !important;
          border-radius: 24px !important;
          padding: 6px 16px !important;
          font-weight: 500 !important;
          font-size: 16px !important;
          cursor: pointer !important;
          transition: all 0.3s ease !important;
          position: relative !important;
          box-shadow: 0 4px 14.6px 0 rgba(0, 255, 36, 0.3) !important;
        }
        [data-testid="rk-connect-button"]:hover {
          background-color: black !important;
           border: 0.5px solid white !important;
          color: white !important;
        }
        [data-testid="rk-connect-button"]:active {
          transform: translateY(0) !important;
        }
        [data-testid="rk-connect-button"]:disabled {
          opacity: 0.6 !important;
          cursor: not-allowed !important;
        }
      `}</style>

      <nav className="flex items-center justify-between px-1 md:px-2 py-1.5 h-[60px] border-b border-[rgba(214,213,212,0.1)] bg-[#011b04]">
        {/* Logo */}
        <div className="flex items-center gap-0 md:gap-2 lg:gap-4 xl:gap-6">
          <img className="w-[140px] md:w-[160px] lg:w-[179px] h-[28px] md:h-[32px] lg:h-[36px] flex-shrink-0  md:ml-1" src="./image copy.png" alt="Mercury Logo" />
          
          {/* Desktop Navigation - Hidden on mobile, visible on md+ */}
          <div className="hidden md:flex items-center gap-0">
            <div 
              className={`px-[10px] lg:px-[12px] xl:px-[15px] py-[15px] text-[18px] font-[500] cursor-pointer transition-colors duration-300 hover:bg-white/10 whitespace-nowrap ${
                activeNavItem === 'Trade' ? 'border-b-2 border-[#00ff24] text-white' : 'border-b-2 border-transparent text-gray-500'
              }`}
              onClick={() => setActiveNavItem('Trade')}
            >
              Trade
            </div>
            <div 
              className={`px-[10px] lg:px-[12px] xl:px-[15px] py-[15px] text-[18px] font-[500] cursor-pointer transition-colors duration-300 hover:bg-white/10 whitespace-nowrap ${
                activeNavItem === 'Leaderboard' ? 'border-b-2 border-[#00ff24] text-white' : 'border-b-2 border-transparent text-gray-500'
              }`}
              onClick={() => setActiveNavItem('Leaderboard')}
            >
              Leaderboard
            </div>
            <div 
              className={`px-[10px] lg:px-[12px] xl:px-[15px] py-[15px] text-[18px] font-[500] cursor-pointer transition-colors duration-300 hover:bg-white/10 whitespace-nowrap ${
                activeNavItem === 'Refferal' ? 'border-b-2 border-[#00ff24] text-white' : 'border-b-2 border-transparent text-gray-500'
              }`}
              onClick={() => setActiveNavItem('Refferal')}
            >
              Refferal
            </div>
            <div 
              className={`px-[10px] lg:px-[12px] xl:px-[15px] py-[15px] text-[18px] font-[500] cursor-pointer transition-colors duration-300 hover:bg-white/10 whitespace-nowrap ${
                activeNavItem === 'Portfolio' ? 'border-b-2 border-[#00ff24] text-white' : 'border-b-2 border-transparent text-gray-500'
              }`}
              onClick={() => setActiveNavItem('Portfolio')}
            >
              Portfolio
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 md:gap-3 lg:gap-4 xl:gap-5 flex-shrink-0">

          {/* Hamburger Menu Button - Visible only on mobile */}
          <button
            className="md:hidden flex items-center justify-center w-10 h-10 text-white"
            onClick={() => setShowMobileMenu(!showMobileMenu)}
            aria-label="Menu"
          >
            {showMobileMenu ? (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            ) : (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M3 12H21M3 6H21M3 18H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </button>

          {isConnected && address ? (
            <div className="flex items-center gap-2 md:gap-2.5 lg:gap-3 xl:gap-4">
              {!hasActiveSession && (
               <button
               className="hidden md:flex items-center justify-center px-4 lg:px-5 xl:px-6 bg-[#00FF24] h-[40px] rounded-full text-black border-[0.5px] border-transparent font-[Geist Mono] text-[16px] font-500 whitespace-nowrap transition-all duration-300 hover:bg-black hover:text-white hover:border-white disabled:opacity-60 disabled:cursor-not-allowed"
               onClick={handleEnableTrading}
               disabled={isCreatingSession}
               style={{
                 boxShadow: '0 4px 14.6px 0 rgba(0, 255, 36, 0.3)'
               }}
             >
               {isCreatingSession ? '⏳ Enabling...' : 'Enable Trading'}
             </button>
              )}

                <div 
                  onClick={onDepositClick}
                  className="hidden md:flex items-center bg-transparent border border-[rgba(238,237,236,0.4)] rounded-full h-[40px] px-3 lg:px-3.5 xl:px-4 gap-2.5 cursor-pointer transition-all duration-200 hover:opacity-90"
                >
                <span className="font-[Geist Mono] text-[15px] font-500 text-white whitespace-nowrap">
                  {isLoadingWrapper ? '...' : formatBalance(wrapperBalanceUSD)}
                </span>
                <div
                  className="w-[26px] h-[26px] rounded-full bg-[#00ff24] flex items-center justify-center text-black text-base font-medium flex-shrink-0"
                  style={{
                    boxShadow: '0 0 10px rgba(0, 255, 36, 0.5)'
                  }}
                >
                  +
                </div>
              </div>

              <div 
                ref={accountMenuRef}
                onClick={() => setShowAccountMenu((prev) => !prev)}
                className="hidden md:flex relative items-center bg-transparent border border-white/30 rounded-full h-[40px] px-3 lg:px-4 xl:px-5 py-2 gap-2 lg:gap-[10px] cursor-pointer transition-all duration-200 z-50"
                style={{
                  boxShadow: '0 4px 14.6px rgba(0, 0, 0, 0.1)'
                }}
              >
                {profile?.avatar_url ? (
                  <img 
                    src={profile.avatar_url} 
                    alt="Avatar" 
                    className="w-6 h-6 rounded-full object-cover flex-shrink-0 border border-white/20"
                  />
                ) : (
                  <div className="w-6 h-6 rounded-full bg-red-500 flex items-center justify-center flex-shrink-0"></div>
                )}
                <span className="font-[Geist Mono] text-[11px] md:text-[12px] text-white whitespace-nowrap">
                  {profile?.username ? `@${profile.username}` : formatAddress(address)}
                </span>
                <div
                  className="flex items-center justify-center text-white flex-shrink-0"
                >
                 <svg width="11" height="6" viewBox="0 0 11 6" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M5.5 6L0 0H11L5.5 6Z" fill="#CCD1CD"/>
                </svg>
                </div>

                {showAccountMenu && (
                  <div className="absolute top-[calc(100%+8px)] -right-7 w-[234px] bg-[#001704] border-[1.5px] border-[#162A19] shadow-[0_0_23.6px_6px_rgba(0,0,0,0.5)] z-[10000] rounded-[12px] px-[24px] py-[26px] flex flex-col items-center gap-[10px]">
                    {/* Avatar */}
                    <div className="w-[59px] h-[59px] rounded-full overflow-hidden border-[1.5px] border-[#162A19]">
                       {profile?.avatar_url ? (
                          <img src={profile.avatar_url} alt="Profile" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full bg-gradient-to-br from-[#FFD700] to-[#FFA500]" />
                        )}
                    </div>
                    
                    {/* Username */}
                    <div className="font-geist font-medium text-[16px] text-white mb-[6px]">
                      {profile?.username || formatAddress(address)}
                    </div>

                    {/* Contact Support Button */}
                    <button
                      className="w-full h-[30px] flex items-center justify-center gap-2 bg-white/10 rounded-[12px] text-[#888888] text-[12px] hover:text-white transition-colors duration-200"
                      onClick={(e) => {
                        e.stopPropagation();
                      }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 18v-6a9 9 0 0 1 18 0v6"></path>
                        <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"></path>
                      </svg>
                      Contact Support
                    </button>

                    {/* Logout Button */}
                    <button
                      className="w-full h-[30px] flex items-center justify-center gap-2 bg-white/10 rounded-[12px] text-[#FF4444] text-[12px] hover:text-[#f0b7c0] transition-colors duration-200"
                      onClick={(e) => {
                        e.stopPropagation();
                        disconnect();
                        setShowAccountMenu(false);
                      }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path>
                        <line x1="12" y1="2" x2="12" y2="12"></line>
                      </svg>
                      Logout
                    </button>
                  </div>
                )}
              </div>
              
              <button
                className="hidden lg:flex items-center justify-center text-white/40 transition-colors duration-200 hover:text-white hover:opacity-100"
                aria-label="Settings"
              >
                <svg width="21" height="20" viewBox="0 0 21 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M7.3 20L6.9 16.8C6.68333 16.7167 6.47933 16.6167 6.288 16.5C6.09667 16.3833 5.909 16.2583 5.725 16.125L2.75 17.375L0 12.625L2.575 10.675C2.55833 10.5583 2.55 10.446 2.55 10.338V9.663C2.55 9.55433 2.55833 9.44167 2.575 9.325L0 7.375L2.75 2.625L5.725 3.875C5.90833 3.74167 6.1 3.61667 6.3 3.5C6.5 3.38333 6.7 3.28333 6.9 3.2L7.3 0H12.8L13.2 3.2C13.4167 3.28333 13.621 3.38333 13.813 3.5C14.005 3.61667 14.1923 3.74167 14.375 3.875L17.35 2.625L20.1 7.375L17.525 9.325C17.5417 9.44167 17.55 9.55433 17.55 9.663V10.337C17.55 10.4457 17.5333 10.5583 17.5 10.675L20.075 12.625L17.325 17.375L14.375 16.125C14.1917 16.2583 14 16.3833 13.8 16.5C13.6 16.6167 13.4 16.7167 13.2 16.8L12.8 20H7.3ZM10.1 13.5C11.0667 13.5 11.8917 13.1583 12.575 12.475C13.2583 11.7917 13.6 10.9667 13.6 10C13.6 9.03333 13.2583 8.20833 12.575 7.525C11.8917 6.84167 11.0667 6.5 10.1 6.5C9.11667 6.5 8.28733 6.84167 7.612 7.525C6.93667 8.20833 6.59933 9.03333 6.6 10C6.60067 10.9667 6.93833 11.7917 7.613 12.475C8.28767 13.1583 9.11667 13.5 10.1 13.5Z" fill="white" fillOpacity="0.4"/>
                </svg>
              </button>
            </div>
          ) : (
            <ConnectButton label="Connect" />
          )}
        </div>

        {/* Mobile Menu Dropdown */}
        {showMobileMenu && (
          <div 
            ref={mobileMenuRef}
            className="md:hidden fixed top-[60px] left-0 right-0 bg-[#011b04] border-b border-[rgba(214,213,212,0.1)] shadow-lg z-50 max-h-[calc(100vh-60px)] overflow-y-auto overflow-x-hidden"
          >
            <div className="flex flex-col p-4 gap-2 pb-6 w-full overflow-x-hidden">
              {/* Mobile Navigation */}
              <div 
                className={`px-4 py-3 text-[16px] font-[500] cursor-pointer transition-colors duration-300 hover:bg-white/10 rounded-lg ${
                  activeNavItem === 'Trade' ? 'bg-[#00ff24]/10 text-[#00ff24]' : 'text-gray-400'
                }`}
                onClick={() => {
                  setActiveNavItem('Trade');
                  setShowMobileMenu(false);
                }}
              >
                Trade
              </div>
              <div 
                className={`px-4 py-3 text-[16px] font-[500] cursor-pointer transition-colors duration-300 hover:bg-white/10 rounded-lg ${
                  activeNavItem === 'Leaderboard' ? 'bg-[#00ff24]/10 text-[#00ff24]' : 'text-gray-400'
                }`}
                onClick={() => {
                  setActiveNavItem('Leaderboard');
                  setShowMobileMenu(false);
                }}
              >
                Leaderboard
              </div>
              <div 
                className={`px-4 py-3 text-[16px] font-[500] cursor-pointer transition-colors duration-300 hover:bg-white/10 rounded-lg ${
                  activeNavItem === 'Refferal' ? 'bg-[#00ff24]/10 text-[#00ff24]' : 'text-gray-400'
                }`}
                onClick={() => {
                  setActiveNavItem('Refferal');
                  setShowMobileMenu(false);
                }}
              >
                Refferal
              </div>
              <div 
                className={`px-4 py-3 text-[16px] font-[500] cursor-pointer transition-colors duration-300 hover:bg-white/10 rounded-lg ${
                  activeNavItem === 'Portfolio' ? 'bg-[#00ff24]/10 text-[#00ff24]' : 'text-gray-400'
                }`}
                onClick={() => {
                  setActiveNavItem('Portfolio');
                  setShowMobileMenu(false);
                }}
              >
                Portfolio
              </div>

              {/* Mobile Account Section */}
              {isConnected && address && (
                <>
                  <div className="border-t border-white/10 my-2"></div>
                  
                  {/* Balance & Deposit */}
                  <div 
                    onClick={() => {
                      onDepositClick?.();
                      setShowMobileMenu(false);
                    }}
                    className="flex items-center justify-between bg-white/5 rounded-lg p-3 cursor-pointer transition-all duration-200 hover:opacity-90"
                  >
                    <span className="font-[Geist Mono] text-[14px] text-white">
                      {isLoadingWrapper ? '...' : formatBalance(wrapperBalanceUSD)}
                    </span>
                    <div
                      className="w-[32px] h-[32px] rounded-full bg-[#00ff24] flex items-center justify-center text-black text-lg font-medium"
                    >
                      +
                    </div>
                  </div>

                  {/* Enable Trading */}
                  {!hasActiveSession && (
                    <button
                      className="w-full px-4 py-3 bg-[#00FF24] rounded-lg text-black font-[Geist Mono] text-[14px] font-500 transition-all duration-300 hover:bg-black hover:text-white"
                      onClick={() => {
                        handleEnableTrading();
                        setShowMobileMenu(false);
                      }}
                      disabled={isCreatingSession}
                    >
                      {isCreatingSession ? '⏳ Enabling...' : 'Enable Trading'}
                    </button>
                  )}

                  {/* Address & Disconnect */}
                  <div className="flex items-center justify-between bg-white/5 rounded-lg p-3 w-full min-w-0">
                    <span className="font-[Geist Mono] text-[12px] text-white truncate flex-1 min-w-0">
                      {formatAddress(address)}
                    </span>
                    <button
                      className="text-[12px] text-red-400 hover:text-red-300 flex-shrink-0 ml-2"
                      onClick={() => {
                        disconnect();
                        setShowMobileMenu(false);
                      }}
                    >
                      Disconnect
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </nav>
    </>
  );
}
'use client';

import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useBalance, useDisconnect } from 'wagmi';
import { useState, useEffect } from 'react';
import { useSessionTrading } from '../contexts/SessionTradingContext';
import { useWrapperBalance } from '../hooks/useWrapperBalance';

interface NavbarProps {
  onDepositClick?: () => void;
  onEnableTrading?: () => Promise<boolean>;
}

export default function Navbar({ onDepositClick, onEnableTrading }: NavbarProps) {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { sdk } = useSessionTrading();
  const { data: balance } = useBalance({ address });
  const { balanceUSD: wrapperBalanceUSD, isLoading: isLoadingWrapper } = useWrapperBalance(address);

  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [hasActiveSession, setHasActiveSession] = useState(false);
  const [isCreatingSession, setIsCreatingSession] = useState(false);

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
          background: white !important;
          color: #000 !important;
          border: none !important;
          font-family: 'Geist', sans-serif !important;
          border-radius: 0px !important;
          padding: 6px 16px !important;
          font-weight: 300 !important;
          font-size: 14px !important;
          cursor: pointer !important;
          transition: all 0.3s ease !important;
        }
        [data-testid="rk-connect-button"]:hover {
          background-color: black !important;
          color: white !important;
          border: 1px solid white !important;
        }
        [data-testid="rk-connect-button"]:active {
          transform: translateY(0) !important;
        }
        [data-testid="rk-connect-button"]:disabled {
          opacity: 0.6 !important;
          cursor: not-allowed !important;
        }
      `}</style>

      <nav className="flex items-center justify-between px-4 py-1.5 h-[60px] border-b border-[rgba(214,213,212,0.1)] bg-[#0a0a0a]">
        <div className="flex items-center gap-4">
          <img className="w-[156px] h-[29px]" src="./image copy.png" alt="Mercury Logo" />
          <div className="bg-white/5 border-b-2 border-[#00ff24] px-[18px] py-[13px] text-sm font-medium cursor-pointer transition-colors duration-300 hover:bg-white/10">
            Trade
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex gap-0">
            {[0, 1, 2].map((idx) => (
              <div
                key={idx}
                className="p-2 cursor-pointer opacity-70 transition-opacity duration-300 hover:opacity-100 text-base"
              >
                {idx === 0 && (
                  <svg width="20" height="21" viewBox="0 0 24 25" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path
                      d="M6 22.5H21V20.5H6.012C5.55 20.488 5 20.305 5 19.5C5 18.695 5.55 18.512 6.012 18.5H21V4.5C21 3.397 20.103 2.5 19 2.5H6C4.794 2.5 3 3.299 3 5.5V19.5C3 21.701 4.794 22.5 6 22.5ZM5 8.5V5.5C5 4.695 5.55 4.512 6 4.5H19V16.5H5V8.5Z"
                      fill="#6F7681"
                    />
                    <path d="M8 6.5H17V8.5H8V6.5Z" fill="#6F7681" />
                  </svg>
                )}
                {idx === 1 && (
                  <svg width="20" height="21" viewBox="0 0 24 25" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path
                      fillRule="evenodd"
                      clipRule="evenodd"
                      d="M19.7767 4.92997C20.0238 4.82596 20.2943 4.79008 20.5599 4.82608C20.8256 4.86208 21.0768 4.96863 21.2873 5.13465C21.4979 5.30067 21.6601 5.52008 21.757 5.77005C21.854 6.02002 21.8822 6.29141 21.8387 6.55597L19.5707 20.313C19.3507 21.64 17.8947 22.401 16.6777 21.74C15.6597 21.187 14.1477 20.335 12.7877 19.446C12.1077 19.001 10.0247 17.576 10.2807 16.562C10.5007 15.695 14.0007 12.437 16.0007 10.5C16.7857 9.73897 16.4277 9.29997 15.5007 9.99997C13.1987 11.738 9.50265 14.381 8.28065 15.125C7.20265 15.781 6.64065 15.893 5.96865 15.781C4.74265 15.577 3.60565 15.261 2.67765 14.876C1.42365 14.356 1.48465 12.632 2.67665 12.13L19.7767 4.92997Z"
                      fill="#6F7681"
                    />
                  </svg>
                )}
                {idx === 2 && (
                  <svg width="19" height="19" viewBox="0 0 23 23" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <mask id="mask0_40_16050" maskUnits="userSpaceOnUse" x="0" y="0" width="23" height="23">
                      <path d="M0 0H23V23H0V0Z" fill="white" />
                    </mask>
                    <g mask="url(#mask0_40_16050)">
                      <path
                        d="M18.1125 1.07764H21.6397L13.9347 9.90635L23 21.9222H15.9029L10.3401 14.6361L3.98229 21.9222H0.451786L8.69236 12.4758L0 1.07928H7.27786L12.2984 7.73778L18.1125 1.07764ZM16.8721 19.8062H18.8271L6.21 3.08357H4.11371L16.8721 19.8062Z"
                        fill="#6F7681"
                      />
                    </g>
                  </svg>
                )}
              </div>
            ))}
          </div>

          {isConnected && address ? (
            <div className="flex items-center gap-3">
              {!hasActiveSession && (
                <button
                  className="px-4 py-1.5 bg-white/10 text-white border border-[#7e7e7e] font-[Geist Mono] text-sm font-light whitespace-nowrap transition-colors duration-300 hover:bg-white hover:text-black hover:border-white disabled:opacity-60 disabled:cursor-not-allowed"
                  onClick={handleEnableTrading}
                  disabled={isCreatingSession}
                >
                  {isCreatingSession ? '⏳ Enabling...' : '🔑 Enable Trading'}
                </button>
              )}

              <div className="flex items-center bg-white/10 border border-[rgba(238,237,236,0.4)] h-[28px]">
                <span className="px-2 font-[Geist Mono] text-[13px] text-white leading-[28px]">
                  {isLoadingWrapper ? '...' : formatBalance(wrapperBalanceUSD)}
                </span>
                <button
                  className="h-full w-[28px] flex items-center justify-center border-l border-[#7e7e7e] text-white text-lg transition-colors duration-200 hover:bg-[rgba(0,255,36,0.1)] hover:text-[#00ff24]"
                  onClick={onDepositClick}
                >
                  +
                </button>
              </div>

              <div className="relative flex items-center bg-white/10 border border-[rgba(238,237,236,0.4)] h-[28px]">
                <span className="px-2 font-[Geist Mono] text-[12px] text-white leading-[28px]">
                  {formatAddress(address)}
                </span>
                <button
                  className="h-full w-[28px] flex items-center justify-center border-l border-[#7e7e7e] text-white transition-colors duration-200 hover:bg-white/10"
                  onClick={() => setShowAccountMenu((prev) => !prev)}
                >
                  <svg width="19" height="19" viewBox="0 0 19 19" fill="none">
                    <path
                      d="M4.75 7.125L9.5 11.875L14.25 7.125"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>

                {showAccountMenu && (
                  <div className="absolute top-[calc(100%+8px)] left-0 right-0 bg-[#1d1d1f] border border-[#605d5d] shadow-[0_4px_12px_rgba(0,0,0,0.5)] z-[1000]">
                    <button
                      className="w-full h-[28px] px-4 flex items-center justify-center text-sm text-[#e0e0e0] transition-colors duration-200 hover:bg-white/10 hover:text-[#ff4444]"
                      onClick={() => {
                        disconnect();
                        setShowAccountMenu(false);
                      }}
                    >
                      Disconnect
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <ConnectButton />
          )}
        </div>
      </nav>
    </>
  );
}
'use client';

import { useState, useEffect, useRef } from 'react';
// @ts-ignore - createPortal is available in react-dom
import { createPortal } from 'react-dom';
import { useAccount, useSwitchChain } from 'wagmi';
import { usePriceFeed } from '../contexts/PriceFeedContext';
import { useGlobalLiquidity } from '../hooks/useGlobalLiquidity';
import { useTVL } from '../hooks/useTVL';
import { STORAGE_KEYS } from '../config';

interface TradingInfoProps {
  isScrolled?: boolean;
  onRecenter?: () => void;
  onAmountSet?: (amount: number) => void;
}

const HYPE_CHAIN_ID = 999;

export default function TradingInfo({ isScrolled = false, onRecenter, onAmountSet }: TradingInfoProps) {
  const { currentPrice, isConnected } = usePriceFeed();
  const { liquidityPool, isLoading } = useGlobalLiquidity();
  const { data: tvl, isLoading: tvlLoading } = useTVL();
  const { chain } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const [isSwitching, setIsSwitching] = useState(false);
  const [amount, setAmount] = useState<number>(1.0);
  const [inputValue, setInputValue] = useState<string>('1.0');
  const [showTradingPairDropdown, setShowTradingPairDropdown] = useState(false);
  const [showAmountModal, setShowAmountModal] = useState(false);
  const [error, setError] = useState<string>('');
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });
  const [amountModalPosition, setAmountModalPosition] = useState({ top: 0, left: 0 });
  const amountModalRef = useRef<HTMLDivElement>(null);
  const amountButtonRef = useRef<HTMLDivElement>(null);
  const tradingPairDropdownRef = useRef<HTMLDivElement>(null);
  const tradingPairButtonRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (tradingPairDropdownRef.current && !tradingPairDropdownRef.current.contains(event.target as Node)) {
        setShowTradingPairDropdown(false);
      }
    };

    if (showTradingPairDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showTradingPairDropdown]);


  useEffect(() => {
    if (typeof window === 'undefined') return;
    const savedAmount = localStorage.getItem(STORAGE_KEYS.USER_AMOUNT);
    if (savedAmount) {
      const parsedAmount = parseFloat(savedAmount);
      if (parsedAmount >= 0.1) {
        setAmount(parsedAmount);
        setInputValue(savedAmount);
      }
    }
  }, []);

  // Close modal when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (amountModalRef.current && !amountModalRef.current.contains(event.target as Node)) {
        setShowAmountModal(false);
      }
    };

    if (showAmountModal) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showAmountModal]);

  const handleInputChange = (value: string) => {
    if (value === '' || /^\d*\.?\d*$/.test(value)) {
      setInputValue(value);
      setError('');
      const numValue = parseFloat(value);
      if (!isNaN(numValue) && numValue >= 0) {
        setAmount(numValue);
      }
    }
  };

  const handleSetAmount = () => {
    const numValue = parseFloat(inputValue);
    if (inputValue === '' || isNaN(numValue)) {
      setError('Please enter a valid number');
      return;
    }
    if (numValue < 0.1) {
      setError('Amount must be at least $1');
      return;
    }
    setAmount(numValue);
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEYS.USER_AMOUNT, numValue.toString());
    }
    onAmountSet?.(numValue);
    window.dispatchEvent(new Event('amountUpdated'));
    setError('');
    setShowAmountModal(false);
  };

  const handleQuickAmount = (amt: number) => {
    setAmount(amt);
    setInputValue(amt.toString());
    setError('');
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEYS.USER_AMOUNT, amt.toString());
    }
    onAmountSet?.(amt);
    window.dispatchEvent(new Event('amountUpdated'));
    setShowAmountModal(false);
  };

  const quickAmounts = [0.2, 0.5, 0.5, 1.5 , 2 ,5 ];

  const handleNetworkSwitch = async () => {
    if (!chain || chain.id === HYPE_CHAIN_ID || isSwitching) return;
    
    setIsSwitching(true);
    try {
      await switchChainAsync({ chainId: HYPE_CHAIN_ID });
    } catch (error) {
      console.log('Network switch cancelled or failed');
    } finally {
      setIsSwitching(false);
    }
  };

  const isOnHyperEVM = chain?.id === HYPE_CHAIN_ID;

  // Format the liquidity value with proper decimals and commas
  const formatLiquidity = (value: string) => {
    const num = parseFloat(value);
    if (isNaN(num)) return '0.000';
    return num.toLocaleString('en-US', { 
      minimumFractionDigits: 3, 
      maximumFractionDigits: 3 
    });
  };

  return (
    <div className="flex justify-between items-center px-2 sm:px-3 h-[64px] border-[0.08rem] border-[#162D19] bg-transparent relative z-[100010]">
      <div className="flex items-center gap-1.5 sm:gap-2 md:gap-3 h-full min-w-0 flex-shrink">
        <div className='border-r-2  border-[#162D19] h-full pr-1.5 sm:pr-2 md:pr-3 flex items-center flex-shrink-0 relative z-[100004]'>
          <div 
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (tradingPairButtonRef.current) {
                const rect = tradingPairButtonRef.current.getBoundingClientRect();
                setDropdownPosition({
                  top: rect.bottom + 8,
                  left: rect.left
                });
              }
              setShowTradingPairDropdown(!showTradingPairDropdown);
            }}
            className="flex items-center gap-1 sm:gap-1.5 md:gap-2 px-1 py-1.5 border-t border-[#FFFFFF33] rounded-[12px] bg-[#1b301f] cursor-pointer transition-all duration-200 relative"
            style={{
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
            }}
            ref={tradingPairButtonRef}
          >
            <div className="w-6 h-6 sm:w-7 sm:h-7 md:w-8 md:h-8 rounded-full bg-[#0f0f0f] flex items-center justify-center flex-shrink-0"
                 style={{
                   boxShadow: 'inset 0 0 4px rgba(0, 255, 255, 0.1)'
                 }}
            >
              <img src="/image.png" alt="" className="w-4 h-4 sm:w-5 sm:h-5 md:w-6 md:h-6" />
            </div>
            <span className="font-['Geist',sans-serif] text-[12px] sm:text-[14px] md:text-[16px] font-normal text-white whitespace-nowrap">HYPE / USDT</span>
            <div className="mx-1 sm:mx-1.5 md:mx-2 flex items-center justify-center">
              <svg className="w-3 h-1.5 sm:w-3.5 sm:h-2 md:w-[15px] md:h-[8px]" viewBox="0 0 15 8" fill="none" xmlns="http://www.w3.org/2000/svg">
                <g filter="url(#filter0_i_597_35381)">
                  <path d="M7.5 8L0 0H15L7.5 8Z" fill="#00FF24"/>
                </g>
                <defs>
                  <filter id="filter0_i_597_35381" x="0" y="0" width="15" height="8" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
                    <feFlood floodOpacity="0" result="BackgroundImageFix"/>
                    <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape"/>
                    <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha"/>
                    <feOffset dy="1"/>
                    <feComposite in2="hardAlpha" operator="arithmetic" k2="-1" k3="1"/>
                    <feColorMatrix type="matrix" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.4 0"/>
                    <feBlend mode="normal" in2="shape" result="effect1_innerShadow_597_35381"/>
                  </filter>
                </defs>
              </svg>
            </div>

            {showTradingPairDropdown && typeof window !== 'undefined' && createPortal(
              <div 
                className="fixed z-[999999] w-[180px] border border-white/20 bg-[#354639] rounded-lg shadow-lg"
                style={{
                  top: `${dropdownPosition.top}px`,
                  left: `${dropdownPosition.left}px`
                }}
                ref={tradingPairDropdownRef}
              >
                <div className=" flex justify-center px-2 py-3 text-sm text-white/60 font-['Geist',sans-serif]">
                  Coming soon
                </div>
              </div>,
              document.body
            )}

          </div>
        </div>
       <div className="flex flex-col gap-1">
          <div className="text-[10px] sm:text-[11px] md:text-[12px] text-white/40 font-normal font-['Geist',sans-serif]">Price</div>
          <div className="font-['Geist',sans-serif] flex justify-center text-[14px] sm:text-[16px] md:text-[18px] font-medium text-[#eeedec]">
            ${currentPrice > 0 ? (currentPrice).toFixed(3) : '38.120'}
          </div>
        </div>
        <div className="flex flex-col gap-1 px-1 sm:px-2">
          <div className="text-[10px] sm:text-[11px] md:text-[12px] text-white/40 font-normal font-['Geist',sans-serif]">TVL</div>
          <div className="font-['Geist',sans-serif] flex justify-center text-[14px] sm:text-[16px] md:text-[18px] font-medium text-[#eeedec]">
            ${tvlLoading ? '...' : tvl ? tvl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}
          </div>
        </div>
      </div>

      {/* Network Switcher Button - Centered */}
      {isConnected && (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <button
            onClick={handleNetworkSwitch}
            disabled={isOnHyperEVM || isSwitching}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              padding: 'clamp(6px, 1%, 8px)',
              background: isOnHyperEVM ? 'transparent' : '#091c0d',
              border: isOnHyperEVM ? '1px solid #00FF241F' : '1px solid #00FF241F',
              fontFamily: "'Geist', sans-serif",
              fontSize: 'clamp(10px, 1vw, 12px)',
              fontWeight: 300,
              color: isOnHyperEVM ? '#4a4a4a' : '#ffffff',
              cursor: isOnHyperEVM ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s ease',
              opacity: isOnHyperEVM ? 0.5 : 1,
              borderRadius: '8px',
              whiteSpace: 'nowrap',
            }}
            onMouseEnter={(e) => {
              if (!isOnHyperEVM && !isSwitching) {
                e.currentTarget.style.background = 'white';
                e.currentTarget.style.color = '#141414';
                e.currentTarget.style.transform = 'translateY(-1px)';
              }
            }}
            onMouseLeave={(e) => {
              if (!isOnHyperEVM && !isSwitching) {
                e.currentTarget.style.background = '#141414';
                e.currentTarget.style.color = '#ffffff';
                e.currentTarget.style.transform = 'translateY(0)';
              }
            }}
            onMouseDown={(e) => {
              if (!isOnHyperEVM && !isSwitching) {
                e.currentTarget.style.transform = 'translateY(0)';
              }
            }}
          >
            {!isOnHyperEVM && (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M5.25009 9.43241L2.81759 6.99991L1.98926 7.82241L5.25009 11.0832L12.2501 4.08324L11.4276 3.26074L5.25009 9.43241Z" fill="#00FF24"/>
              </svg>
            )}
            {isOnHyperEVM ? 'On HyperEVM' : isSwitching ? 'Switching...' : 'Switch to HyperEVM'}
          </button>
        </div>
      )}
     
      <div className="flex items-center gap-0.5 sm:gap-1 border-l-2 border-[#162D19] h-full min-w-0 flex-shrink">
        {/* Amount Display */}
        <div className="relative border-r-2 border-[#162D19] h-full flex items-center px-1 sm:px-1.5 md:px-2 flex-shrink-0">
          <div 
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (amountButtonRef.current) {
                const rect = amountButtonRef.current.getBoundingClientRect();
                setAmountModalPosition({
                  top: rect.bottom + 16,
                  left: rect.right - 220 // 322px is the width of the modal
                });
              }
              setShowAmountModal(!showAmountModal);
            }}
            className="flex items-center gap-1 sm:gap-1.5 md:gap-2 px-1.5 sm:px-2 md:px-3 py-1.5 border-t border-[#FFFFFF33] rounded-[12px] bg-[#1b301f]  cursor-pointer transition-all duration-200 hover:opacity-90"
            ref={amountButtonRef}
          >
            <span className="font-['Geist',sans-serif] text-[12px] sm:text-[14px] md:text-base font-semibold text-white whitespace-nowrap">
              ${amount.toFixed(2)}
            </span>
            <div 
              className="w-5 h-5 sm:w-5 sm:h-5 md:w-6 md:h-6 rounded-full bg-[#00ff24] flex items-center justify-center flex-shrink-0"
              style={{
                boxShadow: '0 0 8px rgba(0, 255, 36, 0.4)'
              }}
            >
             <svg className="w-3 h-3 sm:w-3 sm:h-3 md:w-[12px] md:h-[12px]" viewBox="0 0 9 9" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M6.125 0.81066C6.22349 0.712169 6.34042 0.634041 6.4691 0.580738C6.59779 0.527435 6.73571 0.5 6.875 0.5C7.01429 0.5 7.15221 0.527435 7.2809 0.580738C7.40958 0.634041 7.52651 0.712169 7.625 0.81066C7.72349 0.909152 7.80162 1.02608 7.85492 1.15476C7.90823 1.28345 7.93566 1.42137 7.93566 1.56066C7.93566 1.69995 7.90823 1.83787 7.85492 1.96656C7.80162 2.09524 7.72349 2.21217 7.625 2.31066L2.5625 7.37316L0.5 7.93566L1.0625 5.87316L6.125 0.81066Z" stroke="black" strokeLinecap="round" strokeLinejoin="round"/>
</svg>

            </div>
          </div>

          {/* Amount Modal Dropdown */}
          {showAmountModal && typeof window !== 'undefined' && createPortal(
            <div 
              className="fixed z-[999999] w-[322px] border border-[#162A19] bg-[#001704] rounded-xl shadow-lg"
              style={{
                top: `${amountModalPosition.top}px`,
                left: `${amountModalPosition.left}px`
              }}
              ref={amountModalRef}
            >
              <div className="space-y-3 p-3">
                <div className="flex flex-col gap-2.5">
                  <input
                    type="text"
                    inputMode="decimal"
                    className="w-full border border-[#162D19] bg-white/5 px-3.5 py-2.5 text-base text-white placeholder:text-white/30 outline-none transition focus:border-[#00ff24] focus:text-white rounded"
                    value={inputValue}
                    onChange={(e) => handleInputChange(e.target.value)}
                    onBlur={() => {
                      const numValue = parseFloat(inputValue);
                      if (inputValue === '' || isNaN(numValue) || numValue < 0.2) {
                        setInputValue(amount.toString());
                      }
                    }}
                    placeholder="1"
                  />
                  <div className="flex gap-3">
                    {quickAmounts.slice(0, 3).map((amt) => (
                      <button
                        key={amt}
                        onClick={() => handleQuickAmount(amt)}
                        className={`flex-1 border border-[#EEEDEC33] px-4 py-2 text-base font-['Geist',sans-serif] tracking-tight transition rounded-lg ${
                          amount === amt
                            ? 'bg-mercury-box text-white'
                            : 'bg-mercury-box text-white/60 hover:bg-mercury-box/90 hover:text-white/80'
                        }`}
                      >
                        ${amt}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-3">
                    {quickAmounts.slice(3).map((amt) => (
                      <button
                        key={amt}
                        onClick={() => handleQuickAmount(amt)}
                        className={`flex-1 border border-[#EEEDEC33] px-4 py-2 text-base font-['Geist',sans-serif] tracking-tight transition rounded-lg ${
                          amount === amt
                            ? 'bg-mercury-box text-white'
                            : 'bg-mercury-box text-white/60 hover:bg-mercury-box/90 hover:text-white/80'
                        }`}
                      >
                        ${amt}
                      </button>
                    ))}
                  </div>
                </div>

                {error && (
                  <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-500">
                    ⚠️ {error}
                  </div>
                )}

                <div className="pt-3">
                  <button
                    className="w-full border border-[#EEEDEC4D] bg-[#00FF24] px-4 py-2 text-[16px] font-400 text-[#000] tracking-tight transition hover:bg-[#000000] hover:border-white-2 hover:text-[#fff] hover:font-400 active:scale-95 rounded-lg"
                    onClick={handleSetAmount}
                  >
                    Set Amount
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )}
        </div>

        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <div className="text-[10px] sm:text-[11px] md:text-[12px] text-white/40 font-normal font-['Geist',sans-serif] px-1 sm:px-2 md:px-3">Market Liquidity</div>
          <div className="font-['Geist',sans-serif] flex justify-center text-[14px] sm:text-[16px] md:text-[18px] font-medium text-[#eeedec] truncate">
            ${isLoading ? '...' : formatLiquidity(liquidityPool)}
          </div>
        </div>
      </div>
    </div>
  );
}
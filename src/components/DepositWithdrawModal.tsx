'use client';

import { useState, useEffect } from 'react';
import { useAccount, useWalletClient } from 'wagmi';
import { useDepositWithdraw } from '../contexts/DepositWithdrawContext';
import { LiFiSDK, SUPPORTED_CHAINS, ChainOption } from '../lib/LiFiSDK';
import { getChainBalance } from '../lib/chainBalances';
import { LiFiWidget, WidgetConfig } from '@lifi/widget';
import type { Route } from '@lifi/types';

interface DepositWithdrawModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function DepositWithdrawModal({ isOpen, onClose }: DepositWithdrawModalProps) {
  const [activeTab, setActiveTab] = useState<'deposit' | 'withdraw'>('deposit');
  const [amount, setAmount] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [currentStep, setCurrentStep] = useState<'idle' | 'approving' | 'depositing' | 'bridging'>('idle');
  const [selectedChain, setSelectedChain] = useState<ChainOption>(SUPPORTED_CHAINS[3]); // Default to HYPE
  const [showChainDropdown, setShowChainDropdown] = useState(false);
  const [bridgeQuote, setBridgeQuote] = useState<Route | null>(null);
  const [lifiSDK] = useState(() => new LiFiSDK());
  const [selectedChainBalance, setSelectedChainBalance] = useState<string>('');
  const [isFetchingBalance, setIsFetchingBalance] = useState(false);
  const [showLiFiWidget, setShowLiFiWidget] = useState(false);
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const {
    sdk,
    isConnected,
    balance,
    walletBalance,
    isLoading,
    error,
    isApproved,
    approvalAmount,
    connect,
    deposit,
    withdraw,
    approve,
    checkApproval,
    refreshBalance,
    clearError,
  } = useDepositWithdraw();

  useEffect(() => {
    if (isOpen && address) {
      if (!isConnected) {
        connect();
      } else {
        refreshBalance();
        checkApproval();
      }
    }
  }, [isOpen, address, isConnected, connect, refreshBalance, checkApproval]);

  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(''), 3000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  // Fetch balance for selected chain
  useEffect(() => {
    const fetchChainBalance = async () => {
      if (!address) {
        setSelectedChainBalance('');
        return;
      }

      if (selectedChain.id === 999) {
        // For HyperEVM, use the existing wallet balance
        setSelectedChainBalance(walletBalance?.balanceFormatted || '');
        return;
      }

      setIsFetchingBalance(true);
      try {
        const balance = await getChainBalance(selectedChain.id, address as `0x${string}`);
        setSelectedChainBalance(balance);
      } catch (error) {
        console.error('Failed to fetch chain balance:', error);
        setSelectedChainBalance('0.00');
      } finally {
        setIsFetchingBalance(false);
      }
    };

    if (activeTab === 'deposit') {
      fetchChainBalance();
    } else {
      setSelectedChainBalance('');
    }
  }, [selectedChain, address, activeTab, walletBalance]);

  // Fetch bridge quote when amount and chain changes
  useEffect(() => {
    // Disable automatic quote fetching for now
    // LiFi integration requires proper configuration
    setBridgeQuote(null);
  }, [amount, selectedChain, activeTab, address]);

  if (!isOpen) return null;

  const handleBridgeDeposit = async () => {
    if (!walletClient || !address) {
      alert('Please connect your wallet first');
      return;
    }

    if (!amount || parseFloat(amount) <= 0) {
      alert('Please enter a valid amount');
      return;
    }
    
    // Open Li.Fi Widget for cross-chain bridge
    setShowLiFiWidget(true);
  };

  const handleDeposit = async () => {
    if (!isConnected) {
      await connect();
      return;
    }

    if (!amount || parseFloat(amount) <= 0) {
      alert('Please enter a valid amount');
      return;
    }

    // If not on HyperEVM, use bridge
    if (selectedChain.id !== 999) {
      await handleBridgeDeposit();
      return;
    }

    setIsProcessing(true);
    clearError();

    try {
      // Auto-approve if not already approved
      if (!isApproved) {
        setCurrentStep('approving');
        await approve();
        // Wait a moment for approval to be mined
        await new Promise(resolve => setTimeout(resolve, 2000));
        await checkApproval();
      }

      // Proceed with deposit
      setCurrentStep('depositing');
      const result = await deposit(amount);
      setSuccessMessage(`✅ Successfully deposited ${amount} USDTO!`);
      setAmount('');
      setCurrentStep('idle');
      setTimeout(() => onClose(), 2000);
    } catch (err: any) {
      console.error('Deposit error:', err);
      setCurrentStep('idle');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleWithdraw = async () => {
    if (!isConnected) {
      await connect();
      return;
    }

    if (!amount || parseFloat(amount) <= 0) {
      alert('Please enter a valid amount');
      return;
    }

    setIsProcessing(true);
    clearError();

    try {
      const result = await withdraw(amount);
      setSuccessMessage(`✅ Successfully withdrew ${amount} USDTO!`);
      setAmount('');
      setTimeout(() => onClose(), 2000);
    } catch (err: any) {
      console.error('Withdraw error:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSubmit = () => {
    activeTab === 'deposit' ? handleDeposit() : handleWithdraw();
  };

  const setMaxAmount = () => {
    let maxBalance = '0';
    if (activeTab === 'deposit') {
      // Use selected chain balance if not on HyperEVM
      if (selectedChain.id !== 999) {
        maxBalance = selectedChainBalance && selectedChainBalance !== '' ? selectedChainBalance : '0';
      } else {
        maxBalance = walletBalance?.balanceFormatted || '0';
      }
    } else {
      maxBalance = balance?.balanceFormatted || '0';
    }
    // Only set if we have a valid balance
    if (maxBalance && maxBalance !== '0' && maxBalance !== '') {
      setAmount(maxBalance);
    }
  };

  const getBalanceToShow = () =>
    activeTab === 'deposit' ? walletBalance?.balanceFormatted || '0.00' : balance?.balanceFormatted || '0.00';

  const handleTabChange = (tab: 'deposit' | 'withdraw') => {
    setActiveTab(tab);
    setAmount('');
    setCurrentStep('idle');
    clearError();
    if (isConnected) {
      refreshBalance();
      if (tab === 'deposit') {
        checkApproval();
      }
    }
  };

  const getButtonText = () => {
    if (isProcessing) {
      if (currentStep === 'approving') return 'Approving...';
      if (currentStep === 'bridging') return 'Bridging...';
      if (currentStep === 'depositing') return 'Depositing...';
      return 'Processing...';
    }
    if (activeTab === 'deposit' && selectedChain.id !== 999) {
      return 'Bridge & Deposit';
    }
    return activeTab === 'deposit' ? 'Deposit' : 'Withdraw';
  };

  return (
    <div
      className="fixed inset-0 bg-black/30 backdrop-blur-[12px] flex items-center justify-center z-[10002] animate-fade-in"
      onClick={onClose}
    >
      <div className="relative overflow-visible">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute -top-4 -right-4 w-8 h-8 rounded-full bg-[#000E02] hover:bg-[#2a2a2a] border border-[#162A19] flex items-center justify-center transition-all duration-200 group z-[10003]"
        >
          <svg className="w-5 h-5 text-gray-400 group-hover:text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <div
          className="bg-[#000E02] border-2 border-[#162A19] rounded-2xl w-[322px] h-[409px] shadow-2xl shadow-green-900/20 relative flex flex-col overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >

        {/* Tab Headers */}
        <div className="flex justify-center p-4 gap-2 flex-shrink-0">
          <button
            onClick={() => handleTabChange('deposit')}
            disabled={isProcessing}
            className={`rounded-[24px] w-[147px] h-[36px] transition-all duration-200  ${
              activeTab === 'deposit'
                ? 'bg-[#00570C] border border-[#00ff41]/50'
                : ''
            }`}
          >
            Deposit
          </button>
         <button
            onClick={() => handleTabChange('withdraw')}
            disabled={isProcessing}
            className={`rounded-[24px] w-[147px] h-[36px] transition-all duration-200  ${
              activeTab === 'withdraw'
                ? 'bg-[#00570C] border border-[#00ff41]/50'
                : ''
            }`}
          >
            Withdraw
          </button>
        </div>

        {/* Tab Content */}
        <div className="p-6 flex flex-col gap-4 flex-1 overflow-y-auto min-h-0">
          {/* Chain Selector - Only show for Deposit */}
          {activeTab === 'deposit' && (
            <div className="relative flex justify-center gap-2 align-items">
              <div>
                <label className=" text-white text-[12px] leading-6 font-400 font-geist ">Chain:</label>
              </div>
              <div>
              <button
                onClick={() => setShowChainDropdown(!showChainDropdown)}
                className="w-[249px] h-[31px] bg-white/5 border border-white/20 rounded-[8px] py-1.5 px-3.5 flex items-center justify-between hover:border-[#00ff41]/50 transition-all duration-200"
                disabled={isProcessing}
              >
                <div className="flex items-center gap-3">
                  <div className="w-6 h-6 rounded-full bg-gradient-to-br from-[#00ff41] to-[#00cc33] flex items-center justify-center">
                    <span className="text-black text-xs font-bold">{selectedChain.key.substring(0, 2)}</span>
                  </div>
                  <span className="text-white font-medium">{selectedChain.name}</span>
                </div>
                <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              </div>
              
              
              {/* Chain Dropdown */}
              {showChainDropdown && (
                <div className="absolute top-full left-0 right-0 mt-2 bg-[#0d0d0d] border border-[#2a2a2a] rounded-xl shadow-2xl max-h-60 overflow-y-auto z-50">
                  {SUPPORTED_CHAINS.map((chain) => (
                    <button
                      key={chain.id}
                      onClick={() => {
                        setSelectedChain(chain);
                        setShowChainDropdown(false);
                      }}
                      className="w-full px-4 py-3 flex items-center gap-3 hover:bg-[#1a1a1a] transition-all duration-200 text-left"
                    >
                      <div className="w-6 h-6 rounded-full bg-gradient-to-br from-[#00ff41] to-[#00cc33] flex items-center justify-center">
                        <span className="text-black text-xs font-bold">{chain.key.substring(0, 2)}</span>
                      </div>
                      <span className="text-white">{chain.name}</span>
                      {chain.id === selectedChain.id && (
                        <svg className="w-5 h-5 text-[#00ff41] ml-auto" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Chain Display - Only show for Withdraw (HyperEVM only, static) */}
          {activeTab === 'withdraw' && (
            <div className="flex justify-center gap-2 align-items">
              <div>
                <label className=" text-white text-[12px] leading-6 font-400 font-geist ">Chain:</label>
              </div>
              <div>
                <div className="w-[249px] h-[31px] bg-white/5 border border-white/20 rounded-[8px] py-1.5 px-3.5 flex items-center gap-3">
                  <div className="w-6 h-6 rounded-full bg-gradient-to-br from-[#00ff41] to-[#00cc33] flex items-center justify-center overflow-hidden">
                   <img src="/image.png" alt="HyperEVM" className="w-full h-full object-cover" />
                  </div>
                  <span className="text-white font-medium">HyperEVM</span>
                </div>
              </div>
            </div>
          )}

          {/* Amount Input Section */}
          
            <div className="flex justify-between ">
              <div className=' -ml-3'>
                  <label className="text-white text-[12px] font-400  font-geist">{activeTab === 'deposit' ? 'Deposit' : 'Withdraw'}</label>
              </div>
            
              <div className="flex items-center  -mr-3">
                <span className="text-[#828892] text-[12px]">
                  Available:{''}
                  {(activeTab === 'deposit' && selectedChain.id !== 999) ? (
                    <span className="text-[#fff] font-400">
                      {isFetchingBalance ? '...' : `${parseFloat(selectedChainBalance || '0').toFixed(4)} ${selectedChain.key}`}
                    </span>
                  ) : (
                    <span className="text-[#fff] font-400">
                      {isLoading ? '...' : `${parseFloat(getBalanceToShow() || '0').toFixed(2)}`}
                    </span>
                  )}
                </span>
                <button
                  onClick={setMaxAmount}
                  disabled={isProcessing || isFetchingBalance}
                  className="px-2 py-1  hover:text-[#fff] text-[#00ff41] text-xs rounded font-semibold transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Max
                </button>
            </div>
          </div>

          <div className="flex justify-between gap-2 ">
            <div className=''>
            <input
                type="number"
                className="-ml-3 flex-1 h-[30px] w-[212px] bg-white/5 border border-white/20 rounded-[8px] py-1.5 px-3.5 text-white text-base outline-none transition-all duration-200 focus:border-[#00ff41]/50 placeholder:text-gray-600"
                placeholder="10"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                min="0"
                step="0.01"
                disabled={isProcessing}
              />

            </div>
            <div className=''>
             <button className="mr-1  h-[31px] w-[82px] bg-transparent/5 border border-white/20 rounded-[8px] px-2 flex items-center justify-between hover:border-[#00ff41]/50 transition-all duration-200 cursor-pointer">
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <div className="w-[16px] h-[16px] rounded-full overflow-hidden flex-shrink-0">
                    <img
                      src="/image.png"
                      alt="HYPE"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <span className="text-white font-400 text-[12px] whitespace-nowrap">HYPE</span>
                </div>
                <svg className="ml-1 w-[12px] h-[12px] text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
             </div>
              {/* Token Selector */}
             
            </div>


          {/* Processing Steps Indicator */}
          {isProcessing && currentStep !== 'idle' && (
            <div className="bg-[#1a3d2a]/20 border border-[#1a3d2a] rounded-xl p-4">
              <div className="flex items-center gap-2 text-[#00ff41] text-[12px]">
                <div className="w-4 h-4 border-2 border-[#00ff41] border-t-transparent rounded-full animate-spin" />
                <span>
                  {currentStep === 'approving' && 'Approving token access...'}
                  {currentStep === 'bridging' && 'Bridging tokens to HyperEVM...'}
                  {currentStep === 'depositing' && ' Processing deposit...'}
                </span>
              </div>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 py-3 px-4 rounded-xl text-sm animate-slide-down">
              {error}
            </div>
          )}

          {/* Success Message */}
          {successMessage && (
            <div className="bg-green-500/10 border border-green-500/30 text-[#00ff41] py-3 px-4 rounded-xl text-sm animate-slide-down">
              {successMessage}
            </div>
          )}

          {/* Action Button */}
          <button
            onClick={handleSubmit}
            disabled={isProcessing || isLoading || !amount || parseFloat(amount) <= 0}
            className="w-full h-[44px] bg-[#00FF24] hover:bg-[#000] hover:border hover:text-[#fff] cursor-pointer text-black font-400 text-[16px] py-1 px-3 rounded-lg transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] flex items-center justify-center gap-[10px] font-geistMono mt-auto"
          >
            {isProcessing ? (
              <>
                <div className="w-5 h-5 border-2 border-black border-t-transparent rounded-full animate-spin" />
                {getButtonText()}
              </>
            ) : (
              getButtonText()
            )}
          </button>

          {/* Powered by LiFi */}
          <div className="text-center text-gray-500 text-sm">
            Powered By Lifi
          </div>
        </div>
      </div>
      </div>

      {/* Li.Fi Widget Modal */}
      {showLiFiWidget && (
        <div 
          className="fixed inset-0 bg-black/95 z-[10003] flex items-center justify-center"
          onClick={() => setShowLiFiWidget(false)}
        >
          <div 
            className="relative w-full max-w-[440px] h-[680px]"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setShowLiFiWidget(false)}
              className="absolute -top-12 right-0 text-white hover:text-gray-300 text-sm flex items-center gap-2 z-10"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              Close Bridge
            </button>
            <LiFiWidget
              config={{
                appearance: 'dark',
                theme: {
                  palette: {
                    primary: { main: '#00ff24' },
                    secondary: { main: '#1a3d2a' },
                    background: { default: '#0a1810', paper: '#0d1f16' },
                  },
                },
                chains: {
                  allow: [1, 42161], // Ethereum and Arbitrum for now
                },
                toChain: 999, // HyperEVM as destination
                toToken: '0x0E08C8B9654eeB89E116B11F0Bd3d79ccdfF2883', // USDTO
                fromAmount: amount,
              }}
              integrator="Mercury Trading"
            />
          </div>
        </div>
      )}
    </div>
  );
}
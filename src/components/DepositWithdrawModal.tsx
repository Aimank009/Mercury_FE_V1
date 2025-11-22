'use client';

import { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { useDepositWithdraw } from '../contexts/DepositWithdrawContext';

interface DepositWithdrawModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function DepositWithdrawModal({ isOpen, onClose }: DepositWithdrawModalProps) {
  const [activeTab, setActiveTab] = useState<'deposit' | 'withdraw'>('deposit');
  const [amount, setAmount] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [debugInfo, setDebugInfo] = useState<any>(null);
  const [networkInfo, setNetworkInfo] = useState<{ chainId: number; name: string } | null>(null);
  const { address } = useAccount();
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
      }
    }
  }, [isOpen, address, isConnected, connect, refreshBalance]);

  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(''), 3000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  if (!isOpen) return null;

  const handleApprove = async () => {
    if (!isConnected) {
      await connect();
      return;
    }

    setIsProcessing(true);
    clearError();

    try {
      const result = await approve();
      setSuccessMessage(`Successfully approved USDTO! Transaction: ${result.txHash.slice(0, 10)}...`);
      await checkApproval();
    } catch (err: any) {
      console.error('Approval error:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeposit = async () => {
    if (!isConnected) {
      await connect();
      return;
    }

    setIsProcessing(true);
    clearError();

    try {
      const result = await deposit(amount);
      setSuccessMessage(`Successfully deposited ${amount} USDTO! Transaction: ${result.txHash.slice(0, 10)}...`);
      setAmount('');
      setTimeout(() => onClose(), 2000);
    } catch (err: any) {
      console.error('Deposit error:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleWithdraw = async () => {
    if (!isConnected) {
      await connect();
      return;
    }

    setIsProcessing(true);
    clearError();

    try {
      const result = await withdraw(amount);
      setSuccessMessage(`Successfully withdrew ${amount} USDTO! Transaction: ${result.txHash.slice(0, 10)}...`);
      setAmount('');
      setTimeout(() => onClose(), 2000);
    } catch (err: any) {
      console.error('Withdraw error:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSubmit = () => {
    if (!amount || parseFloat(amount) <= 0) {
      alert('Please enter a valid amount');
      return;
    }
    activeTab === 'deposit' ? handleDeposit() : handleWithdraw();
  };

  const getBalanceToShow = () =>
    activeTab === 'deposit' ? walletBalance?.balanceFormatted || '0.00' : balance?.balanceFormatted || '0.00';

  const handleTabChange = (tab: 'deposit' | 'withdraw') => {
    setActiveTab(tab);
    if (isConnected) {
      refreshBalance();
    }
  };

  const handleDebugTest = async () => {
    if (!sdk || !isConnected) return;
    setIsProcessing(true);
    try {
      const debug = await sdk.testContractInteraction();
      setDebugInfo(debug);
      console.log('Debug info:', debug);
    } catch (err: any) {
      console.error('Debug test failed:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div
      className="fixed top-0 left-0 right-0 bottom-0 bg-black/85 backdrop-blur-md flex items-center justify-center z-[10002] animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-[#1d1d1f] border border-[#605d5d] w-[452px] max-w-[90%] flex flex-col animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Tab Headers */}
        <div className="flex w-full">
          <button
            className={`flex-1 py-2 px-4 text-base font-medium tracking-[-0.8px] cursor-pointer transition-all duration-200 border-b border-[#605d5d] ${
              activeTab === 'deposit'
                ? 'bg-white text-[#1b273a] border-b-0'
                : 'bg-white/10 text-white/60 hover:bg-white/15'
            } border-r-[0.5px] border-r-[#605d5d]`}
            onClick={() => handleTabChange('deposit')}
          >
            Deposit
          </button>
          <button
            className={`flex-1 py-2 px-4 text-base font-medium tracking-[-0.8px] cursor-pointer transition-all duration-200 border-b border-[#605d5d] ${
              activeTab === 'withdraw'
                ? 'bg-white text-[#1b273a] border-b-0'
                : 'bg-white/10 text-white/60 hover:bg-white/15'
            } border-l-[0.5px] border-l-[#605d5d]`}
            onClick={() => handleTabChange('withdraw')}
          >
            Withdraw
          </button>
        </div>

        {/* Tab Content */}
        <div className="pt-[68px] flex flex-col gap-6 min-h-[363px]">
          {/* Amount Input Section */}
          <div className="flex flex-col gap-1 px-4">
            <div className="flex gap-1 h-11">
              <input
                type="number"
                className="flex-1 bg-black border border-[rgba(213,215,218,0.2)] py-2.5 px-3.5 text-[#717680] text-base outline-none transition-all duration-200 focus:border-[rgba(0,255,36,0.5)] focus:text-white placeholder:text-[#717680]"
                placeholder="0.2"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                min="0"
                step="0.01"
              />
              <div className="flex items-center gap-2 bg-black border border-[#2b2b2c] pl-2 pr-0 cursor-pointer transition-all duration-200 hover:border-[#3b3b3c]">
                <div className="w-6 h-6 shrink-0">
                  <img
                    src="/SQISVYwX_400x400.jpg"
                    alt="USDTO"
                    className="w-full h-full object-cover rounded-full"
                  />
                </div>
                <span className="text-[#eeedec] text-base whitespace-nowrap pr-2">USDTO</span>
                {/* <svg width="19" height="19" viewBox="0 0 19 19" fill="none" className="text-[#828892] mr-2">
                  <path
                    d="M4.75 7.125L9.5 11.875L14.25 7.125"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg> */}
              </div>
            </div>

            {/* Network Status */}
            {networkInfo && (
              <div className="px-4 mb-2">
                <div className="text-xs py-1.5 px-2.5 rounded bg-black/30 border border-white/10 text-[#ccc] text-center">
                  Network: {networkInfo.name} (Chain ID: {networkInfo.chainId})
                  {networkInfo.chainId === 999 ? (
                    <span className="text-[#00ff24] font-semibold"> ✅ HyperEVM</span>
                  ) : (
                    <span className="text-[#ff4444] font-semibold"> ❌ Wrong Network</span>
                  )}
                </div>
              </div>
            )}

            {/* Available Balance */}
            <div className="pr-4 pl-0 text-[#828892] text-sm text-right leading-6">
              {isLoading ? (
                <>Loading balance...</>
              ) : (
                <>
                  {activeTab === 'deposit' ? 'Wallet' : 'Contract'} Balance:{' '}
                  <span className="text-white">{parseFloat(getBalanceToShow()).toFixed(4)} USDTO</span>
                </>
              )}
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="bg-[rgba(255,68,68,0.1)] border border-[rgba(255,68,68,0.3)] text-[#ff4444] py-3 px-4 mx-4 rounded-lg text-sm text-center animate-slide-down">
              {error}
            </div>
          )}

          {/* Success Message */}
          {successMessage && (
            <div className="bg-[rgba(0,255,36,0.1)] border border-[rgba(0,255,36,0.3)] text-[#00ff24] py-3 px-4 mx-4 rounded-lg text-sm text-center animate-slide-down">
              {successMessage}
            </div>
          )}

          {/* Debug Info */}
          {debugInfo && (
            <div className="bg-black/30 border border-white/10 rounded-lg py-3 px-4 mx-4 text-xs">
              <h4 className="m-0 mb-2 text-[#00ff24] text-sm">Debug Information:</h4>
              <div className="grid grid-cols-2 gap-1 text-[#ccc]">
                <div className="py-0.5">Wrapper Contract Exists: {debugInfo.wrapperContractExists ? '✅' : '❌'}</div>
                <div className="py-0.5">Token Contract Exists: {debugInfo.tokenContractExists ? '✅' : '❌'}</div>
                <div className="py-0.5">
                  Supports depositToken: {debugInfo.wrapperSupportsDepositToken ? '✅' : '❌'}
                </div>
                <div className="py-0.5">Token Symbol: {debugInfo.tokenSymbol}</div>
                <div className="py-0.5">Token Decimals: {debugInfo.tokenDecimals}</div>
                <div className="py-0.5">Your USDTO Balance: {debugInfo.userTokenBalance}</div>
                <div className="py-0.5">Approval Amount: {debugInfo.userApproval}</div>
                <div className="py-0.5">Token Address: {debugInfo.tokenAddress}</div>
                <div className="py-0.5">Wrapper Address: {debugInfo.wrapperAddress}</div>
                <div className="py-0.5">RPC URL: {debugInfo.rpcUrl}</div>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-col gap-3 w-full">
            <button
              className={`w-full border-none py-5 px-4 text-xl font-normal cursor-pointer flex items-center justify-center gap-2.5 tracking-[-0.8px] transition-all duration-200 mt-[30%] ${
                activeTab === 'deposit' && !isApproved
                  ? 'bg-[#00ff24] text-[#1b273a] font-semibold animate-pulse hover:bg-[#00e020] hover:-translate-y-0.5'
                  : 'bg-white text-[#1b273a] hover:bg-[#00ff24] hover:text-[#605d5d] hover:border-t hover:border-t-[#605d5d]'
              } active:translate-y-0 disabled:bg-white/30 disabled:text-[rgba(27,39,58,0.5)] disabled:cursor-not-allowed`}
              onClick={activeTab === 'deposit' && !isApproved ? handleApprove : handleSubmit}
              disabled={
                isProcessing ||
                isLoading ||
                (activeTab === 'deposit' && isApproved && (!amount || parseFloat(amount) <= 0)) ||
                (activeTab === 'withdraw' && (!amount || parseFloat(amount) <= 0))
              }
            >
              {isProcessing
                ? activeTab === 'deposit' && !isApproved
                  ? 'Approving...'
                  : 'Processing...'
                : activeTab === 'deposit'
                ? isApproved
                  ? 'Deposit'
                  : 'Approve USDTO'
                : 'Withdraw'}
              {!isProcessing && (
                <svg width="19" height="16" viewBox="0 0 19 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path
                    fillRule="evenodd"
                    clipRule="evenodd"
                    d="M9.5 8L3.58507 14L2.5 12.8993L7.32986 8L2.5 3.10223L3.58507 2L9.5 8Z"
                    fill="#1B273A"
                  />
                  <path
                    fillRule="evenodd"
                    clipRule="evenodd"
                    d="M16.5 8L10.5851 14L9.5 12.8993L14.3299 8L9.5 3.10223L10.5851 2L16.5 8Z"
                    fill="#1B273A"
                  />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
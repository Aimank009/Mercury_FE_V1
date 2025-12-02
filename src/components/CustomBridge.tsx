/**
 * Custom LiFi Bridge Component
 * Uses LiFi SDK directly to support custom recipient address (wrapper contract)
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAccount, useWalletClient, useSwitchChain } from 'wagmi';
import { ethers } from 'ethers';
import {
  getBridgeQuote,
  getSwapQuote,
  executeBridgeRoute,
  formatTokenAmount,
  formatDuration,
  BridgeQuoteResult,
} from '../lib/LiFiBridgeService';
import { CONTRACTS } from '../config/contracts';

interface CustomBridgeProps {
  isOpen: boolean;
  onClose: () => void;
  fromChainId: number;
  fromTokenAddress: string;
  fromTokenSymbol: string;
  fromTokenDecimals: number;
  fromAmount: string;
  onBridgeComplete: (toAmount: string) => void;
  onError: (error: string) => void;
  mode?: 'bridge' | 'swap'; // New prop to determine mode
}

type BridgeStep = 'idle' | 'quoting' | 'reviewing' | 'executing' | 'waiting' | 'depositing' | 'complete' | 'error';

// Wrapper contract and USDTO on HyperEVM
const WRAPPER_CONTRACT = CONTRACTS.WRAPPER;
const USDTO_ADDRESS = '0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb';
const HYPEREVM_CHAIN_ID = 999;

// ABI for depositForUser
const WRAPPER_ABI = [
  'function depositForUser(uint256 _amount, address _user) external'
];

export default function CustomBridge({
  isOpen,
  onClose,
  fromChainId,
  fromTokenAddress,
  fromTokenSymbol,
  fromTokenDecimals,
  fromAmount,
  onBridgeComplete,
  onError,
  mode = 'bridge', // Default to bridge mode
}: CustomBridgeProps) {
  const [step, setStep] = useState<BridgeStep>('idle');
  
  // Determine if this is a swap (same chain) or bridge (cross-chain)
  const isSwap = mode === 'swap' || fromChainId === HYPEREVM_CHAIN_ID;
  const [quote, setQuote] = useState<BridgeQuoteResult | null>(null);
  const [error, setError] = useState<string>('');
  const [txHash, setTxHash] = useState<string>('');
  const [statusMessage, setStatusMessage] = useState<string>('');

  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();

  // Get quote when modal opens
  useEffect(() => {
    if (isOpen && address && fromAmount && parseFloat(fromAmount) > 0) {
      fetchQuote();
    }
  }, [isOpen, address, fromAmount, fromChainId, fromTokenAddress]);

  const fetchQuote = async () => {
    if (!address) return;
    
    setStep('quoting');
    setError('');
    setQuote(null);

    try {
      // Convert amount to smallest unit
      const amountInWei = ethers.utils.parseUnits(fromAmount, fromTokenDecimals).toString();
      
      const quoteParams = {
        fromChainId,
        toChainId: HYPEREVM_CHAIN_ID,
        fromTokenAddress,
        toTokenAddress: USDTO_ADDRESS,
        fromAmount: amountInWei,
        fromAddress: address,
        toAddress: WRAPPER_CONTRACT, // KEY: Send directly to wrapper!
      };

      // Use swap quote for same-chain, bridge quote for cross-chain
      const quoteResult = isSwap 
        ? await getSwapQuote(quoteParams)
        : await getBridgeQuote(quoteParams);

      setQuote(quoteResult);
      setStep('reviewing');
    } catch (err: any) {
      console.error('Quote error:', err);
      setError(err?.message || `Failed to get ${isSwap ? 'swap' : 'bridge'} quote`);
      setStep('error');
    }
  };

  const executeBridge = async () => {
    if (!quote || !walletClient || !address) return;

    setStep('executing');
    setStatusMessage('Preparing transaction...');
    setError('');

    try {
      setStatusMessage('Please confirm the transaction in your wallet...');

      // Execute the bridge route - pass walletClient directly (LiFi SDK v3 uses viem)
      const executedRoute = await executeBridgeRoute(quote.route, walletClient, {
        onTransactionSent: (hash) => {
          console.log('TX sent:', hash);
          setTxHash(hash);
          setStatusMessage('Transaction submitted, waiting for confirmation...');
        },
        onStepCompleted: (completedStep) => {
          console.log('Step completed:', completedStep);
          setStatusMessage('Bridge step completed, waiting for destination...');
        },
        onError: (err) => {
          throw err;
        },
      });

      console.log('Route executed:', executedRoute);
      
      if (isSwap) {
        // For swaps, we can proceed directly to deposit since it's same-chain
        setStep('depositing');
        setStatusMessage('Swap complete! Crediting your account...');
      } else {
        // For bridges, wait for cross-chain transfer
        setStep('waiting');
        setStatusMessage('Bridge transaction confirmed! Waiting for tokens on HyperEVM...');
        // Wait a bit for the bridge to complete (cross-chain takes time)
        await new Promise(resolve => setTimeout(resolve, 5000));
        setStep('depositing');
        setStatusMessage('Tokens received! Crediting your account...');
      }

      // Switch to HyperEVM if not already there
      if (fromChainId !== HYPEREVM_CHAIN_ID) {
        try {
          await switchChainAsync({ chainId: HYPEREVM_CHAIN_ID });
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (switchErr) {
          console.log('Chain switch may have failed, trying anyway...');
        }
      }

      // Get fresh provider/signer on HyperEVM for the deposit call
      const hyperProvider = new ethers.providers.Web3Provider(
        {
          request: async ({ method, params }: { method: string; params?: any[] }) => {
            return await walletClient.request({ method: method as any, params: params as any });
          },
        },
        HYPEREVM_CHAIN_ID
      );
      const hyperSigner = hyperProvider.getSigner();
      
      const wrapperContract = new ethers.Contract(WRAPPER_CONTRACT, WRAPPER_ABI, hyperSigner);
      
      // Get the bridged amount from the route - with safe access
      // Use the route's toAmount or toAmountMin as fallback
      let bridgedAmount = quote.toAmountMin || quote.toAmount;
      
      // Try to get more accurate amount from executed route if available
      if (executedRoute?.toAmount) {
        bridgedAmount = executedRoute.toAmount;
      }
      
      console.log('Calling depositForUser with amount:', bridgedAmount, 'for user:', address);
      setStatusMessage('Please confirm deposit transaction...');
      
      const depositTx = await wrapperContract.depositForUser(bridgedAmount, address);
      console.log('depositForUser tx:', depositTx.hash);
      
      setStatusMessage('Confirming deposit...');
      await depositTx.wait();
      
      console.log('✅ depositForUser confirmed!');
      setStep('complete');
      setStatusMessage(`✅ ${isSwap ? 'Swap' : 'Bridge'} & Deposit complete!`);
      
      onBridgeComplete(bridgedAmount);
      
      // Auto-close after a delay
      setTimeout(() => {
        onClose();
      }, 2000);

    } catch (err: any) {
      console.error('Execution error:', err);
      setError(err?.message || `${isSwap ? 'Swap' : 'Bridge'} failed`);
      setStep('error');
      onError(err?.message || `${isSwap ? 'Swap' : 'Bridge'} failed`);
    }
  };

  const actionLabel = isSwap ? 'Swap' : 'Bridge';

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 bg-black/30 backdrop-blur-[12px] z-[10003] flex items-center justify-center"
      onClick={onClose}
    >
      <div 
        className="relative w-full max-w-[400px] bg-[#0a1810] border border-[#1a3d2a] rounded-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-white font-geist">{actionLabel} & Deposit</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Loading State */}
        {step === 'quoting' && (
          <div className="text-center py-8">
            <div className="w-8 h-8 border-2 border-[#00ff41] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-gray-400 font-geist">Getting best {isSwap ? 'swap' : 'bridge'} route...</p>
          </div>
        )}

        {/* Quote Review */}
        {step === 'reviewing' && quote && (
          <div className="space-y-4">
            {/* From/To Summary */}
            <div className="bg-[#0d1f16] rounded-xl p-4 space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-gray-400 text-sm font-geist">You {isSwap ? 'swap' : 'send'}</span>
                <span className="text-white font-medium font-geist">
                  {fromAmount} {fromTokenSymbol}
                </span>
              </div>
              <div className="flex justify-center">
                <svg className="w-5 h-5 text-[#00ff41]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                </svg>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400 text-sm font-geist">You receive (min)</span>
                <span className="text-[#00ff41] font-medium font-geist">
                  {formatTokenAmount(quote.toAmountMin, 6)} USDTO
                </span>
              </div>
            </div>

            {/* Destination */}
            <div className="bg-[#0d1f16] rounded-xl p-4">
              <div className="flex justify-between items-center">
                <span className="text-gray-400 text-sm font-geist">Destination</span>
                <span className="text-white text-sm font-geist">
                  Wrapper Contract
                </span>
              </div>
              <div className="text-xs text-gray-500 mt-1 font-mono truncate">
                {WRAPPER_CONTRACT}
              </div>
            </div>

            {/* Fees & Time */}
            <div className="bg-[#0d1f16] rounded-xl p-4 space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-gray-400 text-sm font-geist">Estimated time</span>
                <span className="text-white text-sm font-geist">
                  ~{formatDuration(quote.estimatedTime)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400 text-sm font-geist">Network fees</span>
                <span className="text-white text-sm font-geist">${quote.fees.network}</span>
              </div>
              {parseFloat(quote.fees.protocol) > 0 && (
                <div className="flex justify-between items-center">
                  <span className="text-gray-400 text-sm">Protocol fees</span>
                  <span className="text-white text-sm">${quote.fees.protocol}</span>
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 pt-2">
              <button
                onClick={fetchQuote}
                className="flex-1 py-3 rounded-xl border border-[#1a3d2a] text-gray-400 hover:text-white hover:border-[#00ff41]/50 transition-all font-geist"
              >
                Refresh Quote
              </button>
              <button
                onClick={executeBridge}
                className="flex-1 py-3 rounded-xl bg-[#00ff41] text-black font-semibold hover:bg-[#00dd38] transition-all font-geist"
              >
                {actionLabel} Now
              </button>
            </div>

            <p className="text-xs text-gray-500 text-center font-geist">
              Tokens will be {isSwap ? 'swapped' : 'bridged'} and deposited to your Mercury account
            </p>
          </div>
        )}

        {/* Executing State */}
        {(step === 'executing' || step === 'waiting' || step === 'depositing') && (
          <div className="text-center py-8">
            <div className="w-12 h-12 border-2 border-[#00ff41] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-white mb-2 font-geist">{statusMessage}</p>
            {txHash && (
              <p className="text-xs text-gray-500 font-mono truncate px-4">
                TX: {txHash}
              </p>
            )}
            <div className="mt-6 space-y-2">
              <div className={`flex items-center gap-2 ${step === 'executing' ? 'text-[#00ff41]' : 'text-gray-500'}`}>
                <div className={`w-4 h-4 rounded-full border-2 ${step === 'executing' ? 'border-[#00ff41] bg-[#00ff41]/20' : 'border-gray-500'}`} />
                <span className="text-sm font-geist">{isSwap ? 'Swap' : 'Bridge'} transaction</span>
              </div>
              {!isSwap && (
                <div className={`flex items-center gap-2 ${step === 'waiting' ? 'text-[#00ff41]' : 'text-gray-500'}`}>
                  <div className={`w-4 h-4 rounded-full border-2 ${step === 'waiting' ? 'border-[#00ff41] bg-[#00ff41]/20' : 'border-gray-500'}`} />
                  <span className="text-sm">Cross-chain transfer</span>
                </div>
              )}
              <div className={`flex items-center gap-2 ${step === 'depositing' ? 'text-[#00ff41]' : 'text-gray-500'}`}>
                <div className={`w-4 h-4 rounded-full border-2 ${step === 'depositing' ? 'border-[#00ff41] bg-[#00ff41]/20' : 'border-gray-500'}`} />
                <span className="text-sm">Deposit to account</span>
              </div>
            </div>
          </div>
        )}

        {/* Complete State */}
        {step === 'complete' && (
          <div className="text-center py-8">
            <div className="w-16 h-16 rounded-full bg-[#00ff41]/20 flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-[#00ff41]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-[#00ff41] text-lg font-semibold mb-2 font-geist">Success!</p>
            <p className="text-gray-400 text-sm font-geist">
              Your tokens have been {isSwap ? 'swapped' : 'bridged'} and deposited to your Mercury account.
            </p>
          </div>
        )}

        {/* Error State */}
        {step === 'error' && (
          <div className="text-center py-8">
            <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <p className="text-red-500 text-lg font-semibold mb-2 font-geist">{actionLabel} Failed</p>
            <p className="text-gray-400 text-sm mb-4 font-geist">{error}</p>
            <button
              onClick={fetchQuote}
              className="px-6 py-2 rounded-xl bg-[#1a3d2a] text-white hover:bg-[#2a4d3a] transition-all font-geist"
            >
              Try Again
            </button>
          </div>
        )}

        {/* Powered by LiFi */}
        <div className="text-center text-gray-600 text-xs mt-4 font-geist">
          Powered by LI.FI
        </div>
      </div>
    </div>
  );
}

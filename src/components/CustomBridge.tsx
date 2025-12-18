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
  checkHasEnoughGas,
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
  
  // Use the mode prop directly - parent passes locked-in mode that doesn't change during execution
  // Store it in state so it doesn't change when chain switches
  const [bridgeMode] = useState<'bridge' | 'swap'>(mode);
  const isSwap = bridgeMode === 'swap';
  const [quote, setQuote] = useState<BridgeQuoteResult | null>(null);
  const [gasQuote, setGasQuote] = useState<BridgeQuoteResult | null>(null);
  const [needsGas, setNeedsGas] = useState<boolean>(false);
  const [refuelAmount, setRefuelAmount] = useState<string>('0.002'); // Amount of HYPE gas
  const [error, setError] = useState<string>('');
  const [txHash, setTxHash] = useState<string>('');
  const [statusMessage, setStatusMessage] = useState<string>('');

  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setStep('idle');
      setQuote(null);
      setGasQuote(null);
      setNeedsGas(false);
      setRefuelAmount('0.002');
      setError('');
      setTxHash('');
      setStatusMessage('');
    }
  }, [isOpen]);

  // Get quote when modal opens
  useEffect(() => {
    if (isOpen && address && fromAmount && parseFloat(fromAmount) > 0 && step === 'idle') {
      fetchQuote();
    }
  }, [isOpen, address, fromAmount, fromChainId, fromTokenAddress]);

  const fetchQuote = async () => {
    if (!address) return;
    
    setStep('quoting');
    setError('');
    setQuote(null);
    setGasQuote(null);
    setNeedsGas(false);

    try {
      // Convert amount to smallest unit
      const amountInWei = ethers.utils.parseUnits(fromAmount, fromTokenDecimals).toString();
      
      // Check if user needs gas on HyperEVM (only for cross-chain bridges)
      let userNeedsGas = false;
      if (!isSwap) {
        const gasCheck = await checkHasEnoughGas(address);
        console.log('⛽ Gas check result:', gasCheck);
        userNeedsGas = !gasCheck.hasEnough;
        setNeedsGas(userNeedsGas);
      }

      // IMPORTANT: Always send USDT0 to wrapper contract
      // When refuel is enabled, LiFi automatically sends HYPE gas to user's wallet (fromAddress)
      // This way: USDT0 → Wrapper, HYPE gas → User's wallet
      console.log(`📍 Bridge: USDT0 → Wrapper | ${userNeedsGas ? 'HYPE gas → User wallet (refuel)' : 'User has gas'}`);

      const quoteParams = {
        fromChainId,
        toChainId: HYPEREVM_CHAIN_ID,
        fromTokenAddress,
        toTokenAddress: USDTO_ADDRESS,
        fromAmount: amountInWei,
        fromAddress: address,
        toAddress: WRAPPER_CONTRACT, // ALWAYS send to wrapper!
        enableRefuel: userNeedsGas, // Refuel sends HYPE gas to fromAddress (user's wallet)
        refuelAmount: userNeedsGas ? '2000000000000000' : undefined, // 0.002 HYPE in wei
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

    setError('');

    try {
      // Single bridge transaction - if user needs gas, it goes to their address with refuel
      // If user has gas, it goes directly to wrapper
      setStep('executing');
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
        } catch (switchErr: any) {
          // Suppress chain switch errors - wallet may handle it differently
          if (!switchErr?.message?.includes('does not support programmatic')) {
            console.log('Chain switch may have failed, trying anyway...');
          }
        }
      }

      // Get fresh provider/signer on HyperEVM for the deposit call
      const hyperProvider = new ethers.providers.Web3Provider(
        {
          request: async ({ method, params }: { method: string; params?: any[] }) => {
            return await walletClient.request({ method: method as any, params: params as any });
          },
        },
        {
          name: 'hyperevm',
          chainId: HYPEREVM_CHAIN_ID,
        }
      );
      const hyperSigner = hyperProvider.getSigner();

      // Get the bridged amount from the route - with safe access
      // Use the route's toAmount or toAmountMin as fallback
      let bridgedAmount = quote.toAmountMin || quote.toAmount;
      
      // Try to get more accurate amount from executed route if available
      if (executedRoute?.toAmount) {
        bridgedAmount = executedRoute.toAmount;
      }

      // IMPORTANT: Tokens already went to wrapper contract directly!
      // If user needed gas, they received HYPE via refuel automatically
      // Now we just need to call depositForUser to credit their account
      
      const wrapperContract = new ethers.Contract(WRAPPER_CONTRACT, WRAPPER_ABI, hyperSigner);
      
      console.log('Calling depositForUser with amount:', bridgedAmount, 'for user:', address);
      setStatusMessage(needsGas ? 'Using refuel gas to deposit...' : 'Please confirm deposit transaction...');
      
      const depositTx = await wrapperContract.depositForUser(bridgedAmount, address);
      console.log('depositForUser tx:', depositTx.hash);
      
      setStatusMessage('Confirming deposit...');
      await depositTx.wait();
      
      console.log('✅ depositForUser confirmed!');
      setStep('complete');
      setStatusMessage(`✅ ${bridgeMode === 'bridge' ? 'Bridge' : 'Swap'} & Deposit complete!`);
      
      onBridgeComplete(bridgedAmount);
      
      // Auto-close after a delay
      setTimeout(() => {
        onClose();
      }, 2000);

    } catch (err: any) {
      console.error('Execution error:', err);
      setError(err?.message || `${bridgeMode === 'bridge' ? 'Bridge' : 'Swap'} failed`);
      setStep('error');
      onError(err?.message || `${bridgeMode === 'bridge' ? 'Bridge' : 'Swap'} failed`);
    }
  };

  const actionLabel = bridgeMode === 'bridge' ? 'Bridge' : 'Swap';

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
          <h2 className="text-xl font-semibold text-white font-geist">
            {bridgeMode === 'bridge' ? 'Bridge' : 'Swap'} & Deposit
          </h2>
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
            {/* Gas Info Notice */}
            {needsGas && (
              <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-3">
                <div className="flex items-start gap-2">
                  <svg className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div>
                    <p className="text-blue-400 text-sm font-medium font-geist">Gas Refuel Included</p>
                    <p className="text-blue-400/70 text-xs font-geist mt-1">
                      Bridge includes HYPE gas automatically. Tokens go directly to wrapper, gas goes to your wallet.
                    </p>
                  </div>
                </div>
              </div>
            )}

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
              {needsGas && (
                <div className="flex justify-between items-center text-xs pt-2 border-t border-gray-700/30">
                  <span className="text-blue-400 font-geist">+ HYPE gas (refuel)</span>
                  <span className="text-blue-400 font-geist font-medium">{refuelAmount} HYPE</span>
                </div>
              )}
            </div>

            {/* Destination */}
            <div className="bg-[#0d1f16] rounded-xl p-4">
              <div className="flex justify-between items-center">
                <span className="text-gray-400 text-sm font-geist">Tokens Destination</span>
                <span className="text-white text-sm font-geist">Wrapper Contract</span>
              </div>
              <div className="text-xs text-gray-500 mt-1 font-mono truncate">
                {WRAPPER_CONTRACT}
              </div>
              {needsGas && (
                <div className="mt-2 pt-2 border-t border-gray-700/50">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-400 text-xs font-geist">Gas Destination</span>
                    <span className="text-blue-400 text-xs font-geist">Your Wallet</span>
                  </div>
                </div>
              )}
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
              {needsGas 
                ? `Tokens → Wrapper, ${refuelAmount} HYPE gas → Your wallet. Then deposit to credit your account.`
                : `Tokens will be ${bridgeMode === 'bridge' ? 'bridged' : 'swapped'} directly to wrapper and credited to your account`
              }
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
              <div className={`flex items-center gap-2 ${step === 'executing' ? 'text-[#00ff41]' : ['waiting', 'depositing'].includes(step) ? 'text-green-600' : 'text-gray-500'}`}>
                <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${step === 'executing' ? 'border-[#00ff41] bg-[#00ff41]/20' : ['waiting', 'depositing'].includes(step) ? 'border-green-600 bg-green-600' : 'border-gray-500'}`}>
                  {['waiting', 'depositing'].includes(step) && (
                    <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                </div>
                <span className="text-sm font-geist">
                  {bridgeMode === 'bridge' ? 'Bridge' : 'Swap'} {needsGas ? '(with gas refuel)' : ''}
                </span>
              </div>
              {!isSwap && (
                <div className={`flex items-center gap-2 ${step === 'waiting' ? 'text-[#00ff41]' : step === 'depositing' ? 'text-green-600' : 'text-gray-500'}`}>
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${step === 'waiting' ? 'border-[#00ff41] bg-[#00ff41]/20' : step === 'depositing' ? 'border-green-600 bg-green-600' : 'border-gray-500'}`}>
                    {step === 'depositing' && (
                      <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </div>
                  <span className="text-sm font-geist">Cross-chain transfer</span>
                </div>
              )}
              <div className={`flex items-center gap-2 ${step === 'depositing' ? 'text-[#00ff41]' : 'text-gray-500'}`}>
                <div className={`w-4 h-4 rounded-full border-2 ${step === 'depositing' ? 'border-[#00ff41] bg-[#00ff41]/20' : 'border-gray-500'}`} />
                <span className="text-sm font-geist">Credit to account</span>
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
              Your tokens have been {bridgeMode === 'bridge' ? 'bridged' : 'swapped'} and deposited to your Mercury account.
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
            <p className="text-red-500 text-lg font-semibold mb-2 font-geist">
              {bridgeMode === 'bridge' ? 'Bridge' : 'Swap'} Failed
            </p>
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

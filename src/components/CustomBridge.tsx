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
  getGasBridgeQuote,
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

type BridgeStep = 'idle' | 'quoting' | 'reviewing' | 'gas-bridging' | 'executing' | 'waiting' | 'depositing' | 'complete' | 'error';

// Wrapper contract and USDTO on HyperEVM
const WRAPPER_CONTRACT = CONTRACTS.WRAPPER;
const USDTO_ADDRESS = '0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb';
const HYPEREVM_CHAIN_ID = 999;

// ABI for depositForUser and USDTO
const WRAPPER_ABI = [
  'function depositForUser(uint256 _amount, address _user) external'
];

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function transfer(address to, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function balanceOf(address account) external view returns (uint256)'
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
  const [refuelAmount, setRefuelAmount] = useState<string>('0.01'); // Amount of HYPE gas (increased from 0.002)
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
      setRefuelAmount('0.01');
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
        
        // If user needs gas, get a separate gas bridge quote first
        if (userNeedsGas) {
          console.log('⛽ User needs gas, getting gas bridge quote...');
          const gasBridgeQuote = await getGasBridgeQuote({
            fromChainId,
            fromTokenAddress, // Not used, always bridges native ETH
            fromAddress: address,
            gasAmount: '0.0005', // ~$1.5 worth of ETH for gas
          });
          
          if (gasBridgeQuote) {
            setGasQuote(gasBridgeQuote);
            console.log('⛽ Gas bridge quote:', gasBridgeQuote);
          } else {
            console.warn('⚠️ No gas bridge route available');
          }
        }
      }

      // Main bridge quote - always to user's wallet
      console.log(`📍 Bridge: USDTO → User wallet`);

      const quoteParams = {
        fromChainId,
        toChainId: HYPEREVM_CHAIN_ID,
        fromTokenAddress,
        toTokenAddress: USDTO_ADDRESS,
        fromAmount: amountInWei,
        fromAddress: address,
        toAddress: address, // ✅ Send USDTO to USER's wallet!
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
      // STEP 1: Bridge gas if needed (SIGNATURE 1)
      if (needsGas && gasQuote) {
        setStep('gas-bridging');
        setStatusMessage('Step 1/4: Bridging ETH for gas...');
        console.log('⛽ Executing gas bridge...');
        
        const gasExecutedRoute = await executeBridgeRoute(gasQuote.route, walletClient, {
          onTransactionSent: (hash) => {
            console.log('Gas bridge TX sent:', hash);
            setStatusMessage('Gas bridge submitted, waiting for confirmation...');
          },
          onError: (err) => {
            throw err;
          },
        });
        
        console.log('⛽ Gas bridge completed:', gasExecutedRoute);
        setStatusMessage('Gas bridge complete! Waiting for HYPE to arrive...');
        
        // Wait for gas to arrive on HyperEVM (cross-chain takes time)
        await new Promise(resolve => setTimeout(resolve, 15000)); // 15 seconds
        
        // Verify gas arrived
        const gasCheck = await checkHasEnoughGas(address);
        if (!gasCheck.hasEnough) {
          console.warn('⚠️ Gas may not have arrived yet, but continuing...');
        } else {
          console.log('✅ Gas confirmed on HyperEVM:', gasCheck.balance, 'HYPE');
        }
      }
      
      // STEP 2: Execute main bridge (SIGNATURE 2 or SIGNATURE 1 if no gas bridge)
      const stepNumber = needsGas && gasQuote ? '2/4' : '1/3';
      setStep('executing');
      setStatusMessage(`Step ${stepNumber}: Please confirm ${actionLabel.toLowerCase()} transaction...`);

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
        // For swaps, we can proceed directly to approve since it's same-chain
        setStep('depositing');
        setStatusMessage('Swap complete! Approving & depositing...');
      } else {
        // For bridges, wait for cross-chain transfer
        setStep('waiting');
        setStatusMessage('Bridge transaction confirmed! Waiting for tokens on HyperEVM...');
        // Wait a bit for the bridge to complete (cross-chain takes time)
        await new Promise(resolve => setTimeout(resolve, 5000));
        setStep('depositing');
        setStatusMessage('Tokens received! Approving & depositing...');
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

      console.log('📦 Bridged amount:', bridgedAmount, 'USDTO');

      // ✅ STEP 3 (or STEP 2): Approve wrapper to spend USDTO
      const approveStepNumber = needsGas && gasQuote ? '3/4' : '2/3';
      setStatusMessage(`Step ${approveStepNumber}: Approving USDTO...`);
      
      const usdtoContract = new ethers.Contract(USDTO_ADDRESS, ERC20_ABI, hyperSigner);
      
      // Check current allowance
      const currentAllowance = await usdtoContract.allowance(address, WRAPPER_CONTRACT);
      console.log('Current allowance:', currentAllowance.toString());
      
      if (currentAllowance.lt(bridgedAmount)) {
        console.log('Approving wrapper to spend USDTO...');
        const approveTx = await usdtoContract.approve(WRAPPER_CONTRACT, bridgedAmount);
        console.log('Approve tx:', approveTx.hash);
        
        setStatusMessage('Confirming approval...');
        await approveTx.wait();
        console.log('✅ Approval confirmed!');
      } else {
        console.log('✅ Already approved!');
      }

      // ✅ STEP 4 (or STEP 3): Transfer USDTO to wrapper & call depositForUser
      const depositStepNumber = needsGas && gasQuote ? '4/4' : '3/3';
      setStatusMessage(`Step ${depositStepNumber}: Depositing to your account...`);
      
      const wrapperContract = new ethers.Contract(WRAPPER_CONTRACT, WRAPPER_ABI, hyperSigner);
      
      // Transfer USDTO from user to wrapper
      console.log('Transferring USDTO to wrapper...');
      const transferTx = await usdtoContract.transfer(WRAPPER_CONTRACT, bridgedAmount);
      console.log('Transfer tx:', transferTx.hash);
      
      setStatusMessage('Confirming transfer...');
      await transferTx.wait();
      console.log('✅ USDTO transferred to wrapper!');
      
      // Now credit user's balance
      console.log('Calling depositForUser with amount:', bridgedAmount, 'for user:', address);
      setStatusMessage('Crediting your balance...');
      
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
            {/* Gas Bridge Notice */}
            {needsGas && gasQuote && (
              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-3">
                <div className="flex items-start gap-2">
                  <svg className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div>
                    <p className="text-yellow-400 text-sm font-medium font-geist">Gas Bridge Required</p>
                    <p className="text-yellow-400/70 text-xs font-geist mt-1">
                      You'll bridge {formatTokenAmount(gasQuote.fromAmount, 18, 4)} ETH first to get HYPE gas (~15s wait), then proceed with main bridge.
                    </p>
                  </div>
                </div>
              </div>
            )}
            
            {needsGas && !gasQuote && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3">
                <div className="flex items-start gap-2">
                  <svg className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <div>
                    <p className="text-red-400 text-sm font-medium font-geist">No Gas Route Available</p>
                    <p className="text-red-400/70 text-xs font-geist mt-1">
                      You'll need to get HYPE gas manually after bridging (faucet or another bridge).
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
              {needsGas && gasQuote && (
                <div className="flex justify-between items-center text-xs pt-2 border-t border-gray-700/30">
                  <span className="text-yellow-400 font-geist">+ Gas bridge (ETH)</span>
                  <span className="text-yellow-400 font-geist font-medium">{formatTokenAmount(gasQuote.fromAmount, 18, 4)} ETH</span>
                </div>
              )}
            </div>

            {/* Destination */}
            <div className="bg-[#0d1f16] rounded-xl p-4">
              <div className="flex justify-between items-center">
                <span className="text-gray-400 text-sm font-geist">USDTO Destination</span>
                <span className="text-white text-sm font-geist">Your Wallet → Wrapper</span>
              </div>
              <div className="text-xs text-gray-500 mt-1 font-mono truncate">
                {address}
              </div>
              {needsGas && gasQuote && (
                <div className="mt-2 pt-2 border-t border-gray-700/50">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-400 text-xs font-geist">HYPE Gas → Your Wallet</span>
                    <span className="text-yellow-400 text-xs font-geist">{formatTokenAmount(gasQuote.toAmountMin, 18, 4)} HYPE</span>
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
              {needsGas && gasQuote
                ? `Will bridge ETH for gas first, then ${fromTokenSymbol} → USDTO, then approve & deposit.`
                : `Tokens will be ${bridgeMode === 'bridge' ? 'bridged' : 'swapped'} to your wallet, then approved and deposited to wrapper.`
              }
            </p>
          </div>
        )}

        {/* Executing State */}
        {(step === 'gas-bridging' || step === 'executing' || step === 'waiting' || step === 'depositing') && (
          <div className="text-center py-8">
            <div className="w-12 h-12 border-2 border-[#00ff41] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-white mb-2 font-geist">{statusMessage}</p>
            {txHash && (
              <p className="text-xs text-gray-500 font-mono truncate px-4">
                TX: {txHash}
              </p>
            )}
            <div className="mt-6 space-y-2">
              {/* Gas Bridge Step */}
              {needsGas && gasQuote && (
                <div className={`flex items-center gap-2 ${step === 'gas-bridging' ? 'text-[#00ff41]' : ['executing', 'waiting', 'depositing'].includes(step) ? 'text-green-600' : 'text-gray-500'}`}>
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${step === 'gas-bridging' ? 'border-[#00ff41] bg-[#00ff41]/20' : ['executing', 'waiting', 'depositing'].includes(step) ? 'border-green-600 bg-green-600' : 'border-gray-500'}`}>
                    {['executing', 'waiting', 'depositing'].includes(step) && (
                      <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </div>
                  <span className="text-sm font-geist">Bridge ETH → HYPE gas</span>
                </div>
              )}
              {/* Main Bridge Step */}
              <div className={`flex items-center gap-2 ${step === 'executing' ? 'text-[#00ff41]' : ['waiting', 'depositing'].includes(step) ? 'text-green-600' : 'text-gray-500'}`}>
                <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${step === 'executing' ? 'border-[#00ff41] bg-[#00ff41]/20' : ['waiting', 'depositing'].includes(step) ? 'border-green-600 bg-green-600' : 'border-gray-500'}`}>
                  {['waiting', 'depositing'].includes(step) && (
                    <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                </div>
                <span className="text-sm font-geist">
                  {bridgeMode === 'bridge' ? 'Bridge' : 'Swap'} {fromTokenSymbol} → USDTO
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

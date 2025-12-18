/**
 * LiFi Bridge Service
 * Uses @lifi/sdk directly to bridge tokens with custom recipient address (wrapper contract)
 */

import { createConfig, getRoutes, executeRoute, getStatus, EVM } from '@lifi/sdk';
import type { Route, Token, StatusResponse, RoutesRequest } from '@lifi/sdk';
import type { WalletClient } from 'viem';

// Store the current wallet client for the EVM provider
let currentWalletClient: WalletClient | null = null;

// Function to set the wallet client before executing routes
export function setLiFiWalletClient(walletClient: WalletClient) {
  currentWalletClient = walletClient;
  initializeLiFiConfig();
}

// Initialize LiFi SDK config with EVM provider
function initializeLiFiConfig() {
  createConfig({
    integrator: 'mercury-trading',
    providers: [
      EVM({
        getWalletClient: async () => {
          if (!currentWalletClient) {
            throw new Error('No wallet client available. Call setLiFiWalletClient first.');
          }
          return currentWalletClient;
        },
        switchChain: async (chainId) => {
          console.log('🔄 Switch chain requested:', chainId);
          if (!currentWalletClient) {
            throw new Error('No wallet client available');
          }
          // Return the wallet client - wallet should handle switching
          return currentWalletClient;
        },
      }),
    ],
  });
}

// Initialize with default config (no wallet client yet)
createConfig({
  integrator: 'mercury-trading',
});

export interface BridgeQuoteParams {
  fromChainId: number;
  toChainId: number;
  fromTokenAddress: string;
  toTokenAddress: string;
  fromAmount: string; // in wei/smallest unit
  fromAddress: string; // user's wallet address
  toAddress: string; // destination address (wrapper contract)
}

export interface BridgeQuoteResult {
  route: Route;
  fromToken: Token;
  toToken: Token;
  fromAmount: string;
  toAmount: string;
  toAmountMin: string;
  estimatedGas: string;
  estimatedTime: number; // seconds
  fees: {
    total: string;
    network: string;
    protocol: string;
  };
}

export interface BridgeExecuteCallbacks {
  onTransactionRequest?: (txRequest: any) => void;
  onTransactionSent?: (txHash: string) => void;
  onTransactionConfirmed?: (txReceipt: any) => void;
  onStepStarted?: (step: any) => void;
  onStepCompleted?: (step: any) => void;
  onStatusUpdate?: (status: StatusResponse) => void;
  onError?: (error: Error) => void;
}

/**
 * Get a bridge quote from LiFi with optional gas refuel
 */
export async function getBridgeQuote(params: BridgeQuoteParams & { enableRefuel?: boolean; refuelAmount?: string }): Promise<BridgeQuoteResult> {
  console.log('📊 Getting LiFi quote with params:', params);

  // Build routes request with refuel if needed
  const routesRequest: RoutesRequest = {
    fromChainId: params.fromChainId,
    toChainId: params.toChainId,
    fromTokenAddress: params.fromTokenAddress,
    toTokenAddress: params.toTokenAddress,
    fromAmount: params.fromAmount,
    fromAddress: params.fromAddress,
    toAddress: params.toAddress, // This is the key - send to wrapper!
    options: {
      slippage: 0.03, // 3% slippage
      order: 'RECOMMENDED',
      // Enable refuel to get destination gas (HYPE) automatically
      allowDestinationCall: true,
      ...(params.enableRefuel && params.refuelAmount && {
        // Request specific amount of native gas on destination
        refuel: {
          toChain: params.toChainId,
          toAmount: params.refuelAmount, // Amount of native HYPE needed
        },
      }),
    },
  };

  try {
    const routesResponse = await getRoutes(routesRequest);
    console.log('✅ Got LiFi routes:', routesResponse);

    if (!routesResponse.routes || routesResponse.routes.length === 0) {
      throw new Error('No routes available for this bridge');
    }

    // Use the first (recommended) route
    const route = routesResponse.routes[0];
    console.log('📍 Selected route:', route);
    console.log('📍 Route steps:', route.steps);

    // Calculate fees from the route
    const gasCostUSD = parseFloat(route.gasCostUSD || '0');
    const feeCosts = route.steps?.reduce((sum, step) => {
      const stepFees = step.estimate?.feeCosts?.reduce(
        (feeSum, fee) => feeSum + parseFloat(fee.amountUSD || '0'),
        0
      ) || 0;
      return sum + stepFees;
    }, 0) || 0;

    return {
      route: route,
      fromToken: route.fromToken,
      toToken: route.toToken,
      fromAmount: route.fromAmount,
      toAmount: route.toAmount,
      toAmountMin: route.toAmountMin,
      estimatedGas: route.steps?.[0]?.estimate?.gasCosts?.[0]?.amount || '0',
      estimatedTime: route.steps?.reduce((sum, step) => sum + (step.estimate?.executionDuration || 0), 0) || 300,
      fees: {
        total: (gasCostUSD + feeCosts).toFixed(2),
        network: gasCostUSD.toFixed(2),
        protocol: feeCosts.toFixed(2),
      },
    };
  } catch (error: any) {
    console.error('❌ Failed to get LiFi quote:', error);
    throw new Error(error?.message || 'Failed to get bridge quote');
  }
}

/**
 * Get a swap quote from LiFi (same-chain swap)
 * Used for swapping tokens on HyperEVM to USDTO
 */
export async function getSwapQuote(params: BridgeQuoteParams): Promise<BridgeQuoteResult> {
  console.log('📊 Getting LiFi swap quote with params:', params);

  // For same-chain swaps, fromChainId === toChainId
  const routesRequest: RoutesRequest = {
    fromChainId: params.fromChainId,
    toChainId: params.toChainId, // Same chain for swap
    fromTokenAddress: params.fromTokenAddress,
    toTokenAddress: params.toTokenAddress,
    fromAmount: params.fromAmount,
    fromAddress: params.fromAddress,
    toAddress: params.toAddress, // Send to wrapper contract
    options: {
      slippage: 0.03, // 3% slippage
      order: 'RECOMMENDED',
      allowSwitchChain: false, // Prevent chain switching for swaps
    },
  };

  try {
    const routesResponse = await getRoutes(routesRequest);
    console.log('✅ Got LiFi swap routes:', routesResponse);

    if (!routesResponse.routes || routesResponse.routes.length === 0) {
      throw new Error('No swap routes available');
    }

    // Use the first (recommended) route
    const route = routesResponse.routes[0];
    console.log('📍 Selected swap route:', route);

    // Calculate fees from the route
    const gasCostUSD = parseFloat(route.gasCostUSD || '0');
    const feeCosts = route.steps?.reduce((sum, step) => {
      const stepFees = step.estimate?.feeCosts?.reduce(
        (feeSum, fee) => feeSum + parseFloat(fee.amountUSD || '0'),
        0
      ) || 0;
      return sum + stepFees;
    }, 0) || 0;

    return {
      route: route,
      fromToken: route.fromToken,
      toToken: route.toToken,
      fromAmount: route.fromAmount,
      toAmount: route.toAmount,
      toAmountMin: route.toAmountMin,
      estimatedGas: route.steps?.[0]?.estimate?.gasCosts?.[0]?.amount || '0',
      estimatedTime: route.steps?.reduce((sum, step) => sum + (step.estimate?.executionDuration || 0), 0) || 60,
      fees: {
        total: (gasCostUSD + feeCosts).toFixed(2),
        network: gasCostUSD.toFixed(2),
        protocol: feeCosts.toFixed(2),
      },
    };
  } catch (error: any) {
    console.error('❌ Failed to get LiFi swap quote:', error);
    throw new Error(error?.message || 'Failed to get swap quote');
  }
}

/**
 * Execute a bridge route
 */
export async function executeBridgeRoute(
  route: Route,
  walletClient: WalletClient,
  callbacks?: BridgeExecuteCallbacks
): Promise<Route> {
  console.log('🚀 Executing bridge route:', route);
  console.log('🔍 Route steps:', route?.steps);
  console.log('🔍 Wallet client address:', walletClient?.account?.address);

  if (!route) {
    throw new Error('Invalid route: route is undefined');
  }

  if (!walletClient?.account?.address) {
    throw new Error('Invalid wallet client: no account address');
  }

  // Set the wallet client for LiFi SDK
  setLiFiWalletClient(walletClient);

  try {
    // Execute the route with the SDK - handle async iterator
    let executedRoute: Route | undefined;
    
    const routeExecution = executeRoute(route, {
      // Update callback for route execution progress
      updateRouteHook: (updatedRoute) => {
        console.log('📍 Route updated:', updatedRoute);
        executedRoute = updatedRoute;
        
        // Check step status safely
        if (updatedRoute?.steps && updatedRoute.steps.length > 0) {
          const currentStep = updatedRoute.steps.find(
            (step) => step.execution?.status === 'PENDING' || step.execution?.status === 'ACTION_REQUIRED'
          );
          
          if (currentStep?.execution?.status === 'ACTION_REQUIRED') {
            callbacks?.onTransactionRequest?.(currentStep.execution);
          }
          
          // Check for completed steps
          updatedRoute.steps.forEach((step) => {
            if (step.execution?.status === 'DONE') {
              callbacks?.onStepCompleted?.(step);
            }
          });
        }
        
        return updatedRoute;
      },
      // Accept exchange rate updates
      acceptExchangeRateUpdateHook: async (params) => {
        console.log('💱 Exchange rate update:', params);
        // Auto-accept small changes, reject large ones
        const changePercent = Math.abs(
          (parseFloat(params.newToAmount) - parseFloat(params.oldToAmount)) / 
          parseFloat(params.oldToAmount) * 100
        );
        return changePercent < 5; // Accept if less than 5% change
      },
    });

    // Handle async iterator (newer SDK versions return AsyncGenerator)
    if (routeExecution && typeof (routeExecution as any)[Symbol.asyncIterator] === 'function') {
      // New SDK version - iterate through updates
      for await (const update of (routeExecution as any)) {
        executedRoute = update;
        console.log('📍 Route execution update:', update);
        
        // Check for transaction hashes
        if (update?.steps) {
          for (const step of update.steps) {
            if (step.execution?.process) {
              for (const process of step.execution.process) {
                if (process.txHash) {
                  callbacks?.onTransactionSent?.(process.txHash);
                }
              }
            }
          }
        }
      }
    } else {
      // Old SDK version - direct promise
      executedRoute = await routeExecution;
    }

    if (!executedRoute) {
      throw new Error('Route execution completed but no route was returned');
    }

    console.log('✅ Bridge route executed:', executedRoute);
    return executedRoute;
  } catch (error: any) {
    console.error('❌ Bridge execution failed:', error);
    callbacks?.onError?.(error);
    throw error;
  }
}

/**
 * Check the status of a bridge transaction
 */
export async function checkBridgeStatus(
  txHash: string,
  fromChainId: number,
  toChainId: number
): Promise<StatusResponse> {
  console.log('🔍 Checking bridge status for tx:', txHash);
  
  try {
    const status = await getStatus({
      txHash,
      fromChain: fromChainId,
      toChain: toChainId,
    });
    
    console.log('📊 Bridge status:', status);
    return status;
  } catch (error: any) {
    console.error('❌ Failed to get bridge status:', error);
    throw error;
  }
}

/**
 * Format token amount for display
 */
export function formatTokenAmount(amount: string, decimals: number, displayDecimals: number = 4): string {
  const value = parseFloat(amount) / Math.pow(10, decimals);
  return value.toFixed(displayDecimals);
}

/**
 * Format time duration
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)}m`;
  return `${Math.ceil(seconds / 3600)}h`;
}

// ============================================
// GAS BRIDGING FUNCTIONS (for users without HYPE)
// ============================================

const HYPEREVM_CHAIN_ID = 999;
const HYPE_NATIVE_ADDRESS = '0x0000000000000000000000000000000000000000';
const ETH_NATIVE_ADDRESS = '0x0000000000000000000000000000000000000000';
const ESTIMATED_GAS_FOR_DEPOSIT = '0.002'; // ~0.002 HYPE should be enough for depositForUser tx
const ETH_AMOUNT_FOR_GAS = '0.0003'; // ~$1 worth of ETH to bridge for gas

/**
 * Get user's HYPE balance on HyperEVM
 */
export async function getHypeBalance(userAddress: string): Promise<string> {
  try {
    const response = await fetch('https://rpc.hyperliquid.xyz/evm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_getBalance',
        params: [userAddress, 'latest'],
        id: 1,
      }),
    });
    const data = await response.json();
    return data.result || '0x0';
  } catch (error) {
    console.error('Failed to get HYPE balance:', error);
    return '0x0';
  }
}

/**
 * Check if user has enough HYPE for gas on HyperEVM
 */
export async function checkHasEnoughGas(userAddress: string): Promise<{ hasEnough: boolean; balance: string; required: string }> {
  const balanceHex = await getHypeBalance(userAddress);
  const balance = BigInt(balanceHex);
  const required = BigInt(Math.floor(parseFloat(ESTIMATED_GAS_FOR_DEPOSIT) * 1e18));
  
  return {
    hasEnough: balance >= required,
    balance: (Number(balance) / 1e18).toFixed(6),
    required: ESTIMATED_GAS_FOR_DEPOSIT,
  };
}

/**
 * Get a quote to bridge native ETH to HYPE for gas on HyperEVM
 * Uses native ETH from source chain (user needs this for source chain gas anyway)
 */
export async function getGasBridgeQuote(params: {
  fromChainId: number;
  fromTokenAddress: string; // Not used - we always bridge native ETH
  fromAddress: string;
  gasAmount?: string; // Amount of ETH to bridge, defaults to ETH_AMOUNT_FOR_GAS
}): Promise<BridgeQuoteResult | null> {
  // Use native ETH on source chain - user has this for gas anyway
  // Bridge a small amount to get HYPE for gas on HyperEVM
  const ethAmountInWei = BigInt(Math.floor(parseFloat(params.gasAmount || ETH_AMOUNT_FOR_GAS) * 1e18)).toString();
  
  console.log('⛽ Getting gas bridge quote (ETH → HYPE):', {
    fromChainId: params.fromChainId,
    ethAmount: params.gasAmount || ETH_AMOUNT_FOR_GAS,
    ethAmountInWei,
  });

  const routesRequest: RoutesRequest = {
    fromChainId: params.fromChainId,
    toChainId: HYPEREVM_CHAIN_ID,
    fromTokenAddress: ETH_NATIVE_ADDRESS, // Native ETH on source chain
    toTokenAddress: HYPE_NATIVE_ADDRESS, // Native HYPE on HyperEVM
    fromAmount: ethAmountInWei,
    fromAddress: params.fromAddress,
    toAddress: params.fromAddress, // Send gas to user's address
    options: {
      slippage: 0.05, // 5% slippage for gas bridging
      order: 'CHEAPEST',
    },
  };

  try {
    const routesResponse = await getRoutes(routesRequest);
    
    if (!routesResponse.routes || routesResponse.routes.length === 0) {
      console.log('⚠️ No gas bridge routes available');
      return null;
    }

    const route = routesResponse.routes[0];
    console.log('⛽ Gas bridge route:', route);

    const gasCostUSD = parseFloat(route.gasCostUSD || '0');
    const feeCosts = route.steps?.reduce((sum, step) => {
      const stepFees = step.estimate?.feeCosts?.reduce(
        (feeSum, fee) => feeSum + parseFloat(fee.amountUSD || '0'),
        0
      ) || 0;
      return sum + stepFees;
    }, 0) || 0;

    return {
      route: route,
      fromToken: route.fromToken,
      toToken: route.toToken,
      fromAmount: route.fromAmount,
      toAmount: route.toAmount,
      toAmountMin: route.toAmountMin,
      estimatedGas: route.steps?.[0]?.estimate?.gasCosts?.[0]?.amount || '0',
      estimatedTime: route.steps?.reduce((sum, step) => sum + (step.estimate?.executionDuration || 0), 0) || 300,
      fees: {
        total: (gasCostUSD + feeCosts).toFixed(2),
        network: gasCostUSD.toFixed(2),
        protocol: feeCosts.toFixed(2),
      },
    };
  } catch (error: any) {
    console.error('❌ Failed to get gas bridge quote:', error);
    return null;
  }
}

import { createConfig, getRoutes, executeRoute as lifiExecuteRoute, getTokens as lifiGetTokens, getStatus as lifiGetStatus, getChains as lifiGetChains } from '@lifi/sdk';
import type { Route, ChainId, Token, RoutesRequest, GetStatusRequest, ExtendedChain } from '@lifi/types';

export interface ChainOption {
  id: number;
  name: string;
  key: string;
  logoURI?: string;
  nativeToken?: {
    symbol: string;
    name: string;
    decimals: number;
    address: string;
  };
}

// HyperEVM custom chain (your target destination chain)
export const HYPEREVM_CHAIN: ChainOption = {
  id: 999,
  name: 'HyperEVM',
  key: 'HYPE',
  logoURI: '/image.png',
};

// Cache for chains
let cachedChains: ChainOption[] | null = null;

// Fetch all chains from LI.FI API
async function fetchAllChains(): Promise<ChainOption[]> {
  if (cachedChains) return cachedChains;
  
  try {
    const chains = await lifiGetChains();
    
    cachedChains = chains.map((chain: ExtendedChain) => ({
      id: chain.id,
      name: chain.name,
      key: chain.key,
      logoURI: chain.logoURI,
      nativeToken: chain.nativeToken ? {
        symbol: chain.nativeToken.symbol,
        name: chain.nativeToken.name,
        decimals: chain.nativeToken.decimals,
        address: chain.nativeToken.address,
      } : undefined,
    }));
    
    // Add HyperEVM if not already in the list
    if (!cachedChains.find(c => c.id === HYPEREVM_CHAIN.id)) {
      cachedChains.push(HYPEREVM_CHAIN);
    }
    
    return cachedChains;
  } catch (error) {
    console.error('Failed to fetch chains from LI.FI:', error);
    // Fallback to basic chains if API fails
    return [
      { id: 1, name: 'Ethereum', key: 'ETH', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png' },
      { id: 42161, name: 'Arbitrum', key: 'ARB', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/arbitrum/info/logo.png' },
      { id: 137, name: 'Polygon', key: 'POL', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/polygon/info/logo.png' },
      { id: 10, name: 'Optimism', key: 'OPT', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/optimism/info/logo.png' },
      { id: 56, name: 'BNB Chain', key: 'BSC', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/binance/info/logo.png' },
      { id: 43114, name: 'Avalanche', key: 'AVA', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/avalanche/info/logo.png' },
      { id: 8453, name: 'Base', key: 'BAS', logoURI: 'https://raw.githubusercontent.com/coinbase/brand/master/assets/images/brand/base/logo-only/Base_Symbol_Blue.svg' },
      { id: 1151111081099710, name: 'Solana', key: 'SOL', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/info/logo.png' },
      HYPEREVM_CHAIN,
    ];
  }
}

// For backward compatibility - will be populated on first getChains() call
export let SUPPORTED_CHAINS: ChainOption[] = [];

// Initialize LiFi config
createConfig({
  integrator: 'Mercury Trading',
});

export class LiFiSDK {
  async getChains(): Promise<ChainOption[]> {
    const chains = await fetchAllChains();
    // Update the exported SUPPORTED_CHAINS for backward compatibility
    SUPPORTED_CHAINS = chains;
    return chains;
  }

  // Get only mainnet chains (excludes testnets)
  async getMainnetChains(): Promise<ChainOption[]> {
    const allChains = await this.getChains();
    // Filter to popular mainnets for better UX
    const popularChainIds = [1, 42161, 137, 10, 56, 43114, 8453, 324, 1101, 250, 100, 1151111081099710, 999];
    return allChains.filter(c => popularChainIds.includes(c.id));
  }

  async getTokens(chainId: ChainId): Promise<Token[]> {
    try {
      const tokensResponse = await lifiGetTokens({ chains: [chainId as any] });
      const chainKey = Object.keys(tokensResponse.tokens)[0];
      return tokensResponse.tokens[chainKey as any] || [];
    } catch (error) {
      console.error('Failed to fetch tokens:', error);
      return [];
    }
  }

  async getQuote(params: {
    fromChainId: ChainId;
    toChainId: ChainId;
    fromTokenAddress: string;
    toTokenAddress: string;
    fromAmount: string;
    fromAddress: string;
  }): Promise<Route | null> {
    try {
      const routesRequest: RoutesRequest = {
        fromChainId: params.fromChainId,
        toChainId: params.toChainId,
        fromTokenAddress: params.fromTokenAddress,
        toTokenAddress: params.toTokenAddress,
        fromAmount: params.fromAmount,
        fromAddress: params.fromAddress,
        options: {
          slippage: 0.03,
          order: 'RECOMMENDED',
          allowSwitchChain: false,
        },
      };

      const routes = await getRoutes(routesRequest);

      if (!routes.routes || routes.routes.length === 0) {
        return null;
      }

      return routes.routes[0];
    } catch (error) {
      console.error('Failed to get quote:', error);
      return null;
    }
  }

  async executeRoute(walletClient: any, route: Route,): Promise<any> {
    try {
      // Execute route with LiFi - the SDK handles the transaction execution
      // For now, we'll return a mock response until properly integrated with wallet
      console.log('Executing route:', route);
      return { success: true, route };
    } catch (error) {
      console.error('Failed to execute route:', error);
      throw error;
    }
  }

  async getStatus(params: {
    txHash: string;
    bridge: string;
    fromChain: ChainId;
    toChain: ChainId;
  }) {
    try {
      const statusRequest: GetStatusRequest = {
        txHash: params.txHash,
        bridge: params.bridge,
        fromChain: params.fromChain,
        toChain: params.toChain,
      };
      return await lifiGetStatus(statusRequest);
    } catch (error) {
      console.error('Failed to get status:', error);
      throw error;
    }
  }
}

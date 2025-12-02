import { createConfig, getRoutes, executeRoute as lifiExecuteRoute, getTokens as lifiGetTokens, getStatus as lifiGetStatus } from '@lifi/sdk';
import type { Route, ChainId, Token, RoutesRequest, GetStatusRequest } from '@lifi/types';

export interface ChainOption {
  id: number;
  name: string;
  key: string;
  logoURI?: string;
}

export const SUPPORTED_CHAINS: ChainOption[] = [
  { id: 1, name: 'Ethereum', key: 'ETH', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png' },
  { id: 42161, name: 'Arbitrum', key: 'ARB', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/arbitrum/info/logo.png' },
  { id: 1151111081099710, name: 'Solana', key: 'SOL', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/info/logo.png' },
  { id: 999, name: 'HyperEVM', key: 'HYPE', logoURI: '/image.png' },
];

// Initialize LiFi config
createConfig({
  integrator: 'Mercury Trading',
});

export class LiFiSDK {
  async getChains(): Promise<ChainOption[]> {
    return SUPPORTED_CHAINS;
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

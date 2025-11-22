// ========================================
// NETWORK CONFIGURATION
// ========================================

/**
 * Supported blockchain networks
 */
export const NETWORKS = {
  HYPEREVM: {
    chainId: 998,
    name: 'HyperEVM Testnet',
    rpcUrl: 'https://api.hyperliquid-testnet.xyz/evm',
    nativeCurrency: {
      name: 'ETH',
      symbol: 'ETH',
      decimals: 18,
    },
    blockExplorer: 'https://explorer.hyperliquid-testnet.xyz',
  },
  HYPEREVM_MAINNET: {
    chainId: 999,
    name: 'HyperEVM Mainnet',
    rpcUrl: process.env.NEXT_PUBLIC_RPC_URL || 'https://rpc.hyperliquid.xyz/evm',
    nativeCurrency: {
      name: 'ETH',
      symbol: 'ETH',
      decimals: 18,
    },
    blockExplorer: 'https://explorer.hyperliquid.xyz',
  },
  MAINNET: {
    chainId: 1,
    name: 'Ethereum Mainnet',
    rpcUrl: 'https://eth-mainnet.g.alchemy.com/v2/your-api-key',
    nativeCurrency: {
      name: 'ETH',
      symbol: 'ETH',
      decimals: 18,
    },
    blockExplorer: 'https://etherscan.io',
  },
  SEPOLIA: {
    chainId: 11155111,
    name: 'Sepolia Testnet',
    rpcUrl: 'https://sepolia.infura.io/v3/your-api-key',
    nativeCurrency: {
      name: 'SepoliaETH',
      symbol: 'ETH',
      decimals: 18,
    },
    blockExplorer: 'https://sepolia.etherscan.io',
  },
} as const;

/**
 * Default network for the application
 */
export const DEFAULT_CHAIN_ID = parseInt(process.env.NEXT_PUBLIC_CHAIN_ID || '999');

/**
 * Get network configuration by chain ID
 */
export function getNetworkByChainId(chainId: number) {
  return Object.values(NETWORKS).find(network => network.chainId === chainId);
}

/**
 * Check if chain ID is supported
 */
export function isSupportedChain(chainId: number): boolean {
  return Object.values(NETWORKS).some(network => network.chainId === chainId);
}

/**
 * Get current network configuration
 */
export function getCurrentNetwork() {
  return getNetworkByChainId(DEFAULT_CHAIN_ID) || NETWORKS.HYPEREVM_MAINNET;
}

import { createPublicClient, http, formatEther, type Address } from 'viem';
import { mainnet, arbitrum } from 'viem/chains';

// Define Solana chain (not in viem by default)
const solana = {
  id: 1151111081099710,
  name: 'Solana',
  nativeCurrency: {
    decimals: 9,
    name: 'SOL',
    symbol: 'SOL',
  },
  rpcUrls: {
    default: {
      http: ['https://api.mainnet-beta.solana.com'],
    },
    public: {
      http: ['https://api.mainnet-beta.solana.com'],
    },
  },
};

// Chain configurations
const chainConfigs = {
  1: {
    chain: mainnet,
    rpcUrl: 'https://eth.llamarpc.com',
  },
  42161: {
    chain: arbitrum,
    rpcUrl: 'https://arb1.arbitrum.io/rpc',
  },
};

export async function getChainBalance(chainId: number, address: Address): Promise<string> {
  try {
    // Special handling for Solana
    if (chainId === 1151111081099710) {
      // For Solana, we'd need to use Solana Web3.js
      // For now, return a placeholder
      return '0.00';
    }

    // Get chain config
    const config = chainConfigs[chainId as keyof typeof chainConfigs];
    if (!config) {
      console.warn(`No config for chain ${chainId}`);
      return '0.00';
    }

    // Create public client for the chain
    const client = createPublicClient({
      chain: config.chain,
      transport: http(config.rpcUrl),
    });

    // Fetch balance
    const balance = await client.getBalance({ address });
    const formatted = formatEther(balance);
    
    return parseFloat(formatted).toFixed(4);
  } catch (error) {
    console.error(`Failed to fetch balance for chain ${chainId}:`, error);
    return '0.00';
  }
}
